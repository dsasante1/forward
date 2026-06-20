import { Injectable } from "@nestjs/common";
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
    const target = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (!target) throw new Error("No such member on this project");
    if (target.role === "owner" && role !== "owner") {
      const owners = await this.prisma.projectMember.count({
        where: { projectId, role: "owner" },
      });
      if (owners <= 1) {
        throw new Error("Cannot demote the last owner of a project");
      }
    }
    await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { role },
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
    const target = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (!target) return;
    if (target.role === "owner") {
      const owners = await this.prisma.projectMember.count({
        where: { projectId, role: "owner" },
      });
      if (owners <= 1) {
        throw new Error("Cannot remove the last owner of a project");
      }
    }
    await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
    await this.realtime.publish(projectId, {
      resource: "members",
      op: "delete",
      ids: [userId],
      actor,
      at: Date.now(),
    });
  }
}
