import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ClerkUserService } from "../common/clerk-user.service.js";
import { AdminAuditService } from "../common/admin-audit.service.js";

/**
 * The Org Admin tier: an org admin's view and control over everything filed
 * under their organization — its projects, people, the PATs its members hold, the
 * cross-project activity, and usage. Tenancy (caller is an admin of `orgId`) is
 * enforced by OrgAdminGuard on the routes; this service trusts that and scopes
 * every query to the org. Every mutating action is written to the admin audit
 * trail.
 */
@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: ClerkUserService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Every project filed under the org, enriched for the admin projects table. */
  async listProjects(orgId: string) {
    const rows = await this.prisma.project.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true } },
        owner: { select: { email: true, name: true, imageUrl: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      ownerId: p.ownerId,
      owner: p.owner,
      memberCount: p._count.members,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  /** Assert a project exists and belongs to this org (else 404, not leaking). */
  private async assertProjectInOrg(orgId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true, ownerId: true, name: true },
    });
    if (!project) throw new NotFoundException("No such project in this org");
    return project;
  }

  /**
   * Transfer a project's ownership to another user. The new owner must already
   * be a member of the org (an admin can't gift a project outside the org). The
   * old owner is demoted to editor; the new owner is made the project `owner`.
   */
  async transferOwnership(
    orgId: string,
    projectId: string,
    newOwnerId: string,
    actor: string,
  ) {
    const project = await this.assertProjectInOrg(orgId, projectId);

    const orgMember = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: newOwnerId } },
      select: { userId: true },
    });
    if (!orgMember) {
      throw new ForbiddenException("New owner must be a member of the org");
    }
    await this.users.sync(newOwnerId);

    await this.prisma.$transaction(async (tx) => {
      // Demote the previous owner so we don't leave two owners hanging around.
      if (project.ownerId !== newOwnerId) {
        await tx.projectMember.updateMany({
          where: { projectId, userId: project.ownerId, role: "owner" },
          data: { role: "editor" },
        });
      }
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: newOwnerId } },
        update: { role: "owner" },
        create: { projectId, userId: newOwnerId, role: "owner" },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { ownerId: newOwnerId },
      });
    });

    await this.audit.record({
      scope: "org",
      orgId,
      actorId: actor,
      action: "project.transfer",
      targetType: "project",
      targetId: projectId,
      detail: `owner → ${newOwnerId}`,
    });
    return { ok: true as const };
  }

  /** Delete a project in the org (everything under it cascades). */
  async deleteProject(orgId: string, projectId: string, actor: string) {
    const project = await this.assertProjectInOrg(orgId, projectId);
    await this.prisma.project.delete({ where: { id: projectId } });
    await this.audit.record({
      scope: "org",
      orgId,
      actorId: actor,
      action: "project.delete",
      targetType: "project",
      targetId: projectId,
      detail: project.name,
    });
    return { ok: true as const };
  }

  /** The org's people (from the local mirror, joined to the user profile). */
  async listMembers(orgId: string) {
    const rows = await this.prisma.organizationMember.findMany({
      where: { orgId },
      orderBy: { addedAt: "asc" },
      select: {
        userId: true,
        role: true,
        addedAt: true,
        user: { select: { email: true, name: true, imageUrl: true } },
      },
    });
    return rows.map((m) => ({
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      name: m.user.name,
      imageUrl: m.user.imageUrl,
      addedAt: m.addedAt.toISOString(),
    }));
  }

  /** Org ids of the org's members — the scope for token governance. */
  private async memberIds(orgId: string): Promise<string[]> {
    const members = await this.prisma.organizationMember.findMany({
      where: { orgId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** Active PATs held by the org's members — governance for the admin. */
  async listTokens(orgId: string) {
    const userIds = await this.memberIds(orgId);
    if (userIds.length === 0) return [];
    const rows = await this.prisma.apiToken.findMany({
      where: { userId: { in: userIds }, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      userId: t.userId,
      ownerEmail: t.user.email,
      ownerName: t.user.name,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  /** Revoke a PAT held by one of the org's members. */
  async revokeToken(orgId: string, tokenId: string, actor: string) {
    const userIds = await this.memberIds(orgId);
    const token = await this.prisma.apiToken.findFirst({
      where: { id: tokenId, userId: { in: userIds }, revokedAt: null },
      select: { id: true, userId: true },
    });
    if (!token) throw new NotFoundException("No such active token in this org");
    await this.prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      scope: "org",
      orgId,
      actorId: actor,
      action: "token.revoke",
      targetType: "token",
      targetId: tokenId,
      detail: `owner ${token.userId}`,
    });
    return { ok: true as const };
  }

  /** The org-wide activity feed: timeline events across all the org's projects. */
  async activity(orgId: string, limit = 100) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    });
    if (projects.length === 0) return [];
    const names = new Map(projects.map((p) => [p.id, p.name]));
    const events = await this.prisma.timelineEvent.findMany({
      where: { projectId: { in: projects.map((p) => p.id) } },
      orderBy: { ts: "desc" },
      take: Math.min(limit, 500),
    });
    return events.map((e) => ({
      seq: Number(e.seq),
      projectId: e.projectId,
      projectName: names.get(e.projectId) ?? e.projectId,
      domain: e.domain,
      action: e.action,
      targetId: e.targetId,
      title: e.title,
      detail: e.detail,
      author: e.author,
      ts: Number(e.ts),
    }));
  }

  /** Seats / usage rollup the admin (and, later, billing) reads. */
  async usage(orgId: string) {
    const [projectCount, memberCount, projects] = await Promise.all([
      this.prisma.project.count({ where: { organizationId: orgId } }),
      this.prisma.organizationMember.count({ where: { orgId } }),
      this.prisma.project.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      }),
    ]);
    const projectIds = projects.map((p) => p.id);
    const [elementCount, eventCount, tokenCount] = await Promise.all([
      projectIds.length
        ? this.prisma.designElement.count({
            where: { projectId: { in: projectIds } },
          })
        : Promise.resolve(0),
      projectIds.length
        ? this.prisma.timelineEvent.count({
            where: { projectId: { in: projectIds } },
          })
        : Promise.resolve(0),
      this.memberIds(orgId).then((ids) =>
        ids.length
          ? this.prisma.apiToken.count({
              where: { userId: { in: ids }, revokedAt: null },
            })
          : 0,
      ),
    ]);
    return { projectCount, memberCount, elementCount, eventCount, tokenCount };
  }

  /** The org's recent admin audit trail. */
  auditTrail(orgId: string, limit = 100) {
    return this.audit.list({ scope: "org", orgId, limit });
  }
}
