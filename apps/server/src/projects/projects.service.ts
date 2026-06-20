import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ProjectRole } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";

/**
 * Projects = the tenancy boundary, and their member roster. Replaces the
 * `project_members` subtree + the Firebase "first user claims owner" rule
 * (firebase.rules.json:11-19) with explicit, server-enforced ownership.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Lazily ensure a User row exists for a Clerk id (FK target for memberships). */
  private async ensureUser(userId: string, email?: string): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: userId },
      update: email ? { email } : {},
      create: { id: userId, email: email ?? null },
    });
  }

  /** Create a project; the caller becomes its `owner`. */
  async create(userId: string, name: string) {
    await this.ensureUser(userId);
    return this.prisma.project.create({
      data: {
        name,
        ownerId: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: { id: true, name: true, ownerId: true, createdAt: true },
    });
  }

  /** Every project the user can see (is a member of). */
  async listForUser(userId: string) {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      select: {
        role: true,
        project: { select: { id: true, name: true, ownerId: true, createdAt: true } },
      },
      orderBy: { addedAt: "desc" },
    });
    return memberships.map((m) => ({ ...m.project, role: m.role }));
  }

  /** The member roster for a project (caller already proven a member by the guard). */
  async listMembers(projectId: string) {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: {
        userId: true,
        role: true,
        addedAt: true,
        user: { select: { email: true } },
      },
      orderBy: { addedAt: "asc" },
    });
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      role: m.role,
      addedAt: m.addedAt.toISOString(),
    }));
  }

  /** Enrol another user (owner-only — enforced by @RequireOwner on the route). */
  async addMember(
    projectId: string,
    userId: string,
    role: ProjectRole,
    actor: string,
  ) {
    await this.ensureUser(userId);
    await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      update: { role },
      create: { projectId, userId, role },
    });
    await this.realtime.publish(projectId, {
      resource: "members",
      op: "upsert",
      ids: [userId],
      actor,
      at: Date.now(),
    });
  }

  /** Change a member's role (owner-only). The last owner cannot be demoted. */
  async updateMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
    actor: string,
  ) {
    await this.withProjectLock(projectId, async (tx) => {
      const target = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
      });
      if (!target) throw new Error("No such member on this project");
      if (target.role === "owner" && role !== "owner") {
        await this.assertNotLastOwner(tx, projectId, "demote");
      }
      await tx.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { role },
      });
    });
    await this.realtime.publish(projectId, {
      resource: "members",
      op: "upsert",
      ids: [userId],
      actor,
      at: Date.now(),
    });
  }

  /** Remove a member. The last owner cannot be removed (would orphan the project). */
  async removeMember(projectId: string, userId: string, actor: string) {
    const removed = await this.withProjectLock(projectId, async (tx) => {
      const target = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
      });
      if (!target) return false;
      if (target.role === "owner") {
        await this.assertNotLastOwner(tx, projectId, "remove");
      }
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId, userId } },
      });
      return true;
    });
    if (!removed) return;
    await this.realtime.publish(projectId, {
      resource: "members",
      op: "delete",
      ids: [userId],
      actor,
      at: Date.now(),
    });
  }

  /**
   * Run `fn` while holding a row lock on the project, so concurrent member
   * mutations on the same project serialize. Without this the read-count-then-
   * mutate "last owner" guard is a TOCTOU: two simultaneous owner demotions/
   * removals could both see >1 owner and both proceed, orphaning the project.
   */
  private withProjectLock<T>(
    projectId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      return fn(tx);
    });
  }

  /** Throw if the project would be left with no owner. Call inside the lock. */
  private async assertNotLastOwner(
    tx: Prisma.TransactionClient,
    projectId: string,
    action: "demote" | "remove",
  ): Promise<void> {
    const owners = await tx.projectMember.count({
      where: { projectId, role: "owner" },
    });
    if (owners <= 1) {
      throw new Error(`Cannot ${action} the last owner of a project`);
    }
  }
}
