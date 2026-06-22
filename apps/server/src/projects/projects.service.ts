import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ProjectRole } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";

/** How many member avatars the list endpoint previews per project. */
const MEMBER_PREVIEW = 5;

/** Options for the projects list: server-side search + sort for the dashboard. */
export interface ListOptions {
  q?: string;
  sort?: "recent" | "name";
}

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
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Every project the user can see (is a member of), enriched for the dashboard:
   * the caller's `role` and `favorite` flag, a small roster preview (for member
   * avatars) and the total member count. Supports server-side search (`q`, on
   * name) and sort (recent | name).
   */
  async listForUser(userId: string, opts: ListOptions = {}) {
    const q = opts.q?.trim();
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        ...(q
          ? { project: { name: { contains: q, mode: "insensitive" } } }
          : {}),
      },
      select: {
        role: true,
        favorite: true,
        project: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { members: true } },
            members: {
              take: MEMBER_PREVIEW,
              orderBy: { addedAt: "asc" },
              select: {
                userId: true,
                role: true,
                user: { select: { email: true } },
              },
            },
          },
        },
      },
    });

    const rows = memberships.map((m) => {
      const { _count, members, ...project } = m.project;
      return {
        ...project,
        role: m.role,
        favorite: m.favorite,
        memberCount: _count.members,
        members: members.map((mm) => ({
          userId: mm.userId,
          email: mm.user.email,
          role: mm.role,
        })),
      };
    });

    rows.sort((a, b) =>
      opts.sort === "name"
        ? a.name.localeCompare(b.name)
        : b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
    return rows;
  }

  /** Rename a project (owner-only — enforced by the route guard). */
  async rename(projectId: string, name: string) {
    try {
      return await this.prisma.project.update({
        where: { id: projectId },
        data: { name },
        select: {
          id: true,
          name: true,
          ownerId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new NotFoundException("No such project");
      }
      throw err;
    }
  }

  /** Delete a project and everything under it (owner-only). Relations cascade. */
  async remove(projectId: string) {
    try {
      await this.prisma.project.delete({ where: { id: projectId } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new NotFoundException("No such project");
      }
      throw err;
    }
  }

  /** Set (or clear) the caller's favorite flag on a project they belong to. */
  async setFavorite(projectId: string, userId: string, favorite: boolean) {
    await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { favorite },
    });
    return { favorite };
  }

  /**
   * Deep-copy a project the caller can see into a brand-new project they own:
   * the design elements, the infrastructure graph (nodes/edges/flows) and the
   * task tracker come across. The append-only version history is intentionally
   * NOT copied — the copy starts its own documentation timeline.
   */
  async duplicate(sourceId: string, userId: string) {
    await this.ensureUser(userId);
    const source = await this.prisma.project.findUnique({
      where: { id: sourceId },
      select: { name: true },
    });
    if (!source) throw new NotFoundException("No such project");

    // The new project + owner membership go in first (plain client, mirroring
    // create()); the content copy then runs under the user's RLS context so the
    // child-table inserts pass the per-project membership check.
    const project = await this.prisma.project.create({
      data: {
        name: `${source.name} copy`,
        ownerId: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.prisma.withUser(userId, async (tx) => {
      const from = sourceId;
      const to = project.id;
      const reproject = <T extends { id: string; data: Prisma.JsonValue }>(
        rows: T[],
      ) =>
        rows.map((r) => ({
          projectId: to,
          id: r.id,
          data: r.data as Prisma.InputJsonValue,
        }));

      const [elements, nodes, edges, flows, tasks] = await Promise.all([
        tx.designElement.findMany({ where: { projectId: from }, select: { id: true, data: true } }),
        tx.infraNode.findMany({ where: { projectId: from }, select: { id: true, data: true } }),
        tx.infraEdge.findMany({ where: { projectId: from }, select: { id: true, data: true } }),
        tx.infraFlow.findMany({ where: { projectId: from }, select: { id: true, data: true } }),
        tx.task.findMany({ where: { projectId: from }, select: { id: true, data: true, createdAt: true } }),
      ]);

      if (elements.length) await tx.designElement.createMany({ data: reproject(elements) });
      if (nodes.length) await tx.infraNode.createMany({ data: reproject(nodes) });
      if (edges.length) await tx.infraEdge.createMany({ data: reproject(edges) });
      if (flows.length) await tx.infraFlow.createMany({ data: reproject(flows) });
      if (tasks.length)
        await tx.task.createMany({
          data: tasks.map((t) => ({
            projectId: to,
            id: t.id,
            data: t.data as Prisma.InputJsonValue,
            createdAt: t.createdAt,
          })),
        });
    });
    return project;
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
