import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Plan } from "@prisma/client";
import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { PrismaService } from "../prisma/prisma.service.js";
import { AdminAuditService, type AuditQuery } from "../common/admin-audit.service.js";

/** How many weekly buckets the overview trend charts cover. */
const TREND_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Platform Admin tier — the cross-tenant operations Forward staff use to run
 * the hosted product. Reached only through PlatformAdminGuard. Unlike every other
 * service here, it is deliberately NOT tenancy-scoped: it sees all users, orgs and
 * projects. Every mutating action is written to the platform audit trail.
 */
@Injectable()
export class AdminService {
  private readonly clerk: ClerkClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    config: ConfigService,
  ) {
    this.clerk = createClerkClient({
      secretKey: config.getOrThrow<string>("CLERK_SECRET_KEY"),
    });
  }

  /**
   * Bucket a list of timestamps into `TREND_WEEKS` trailing weekly counts, plus a
   * running cumulative total per week (for the KPI sparklines). `base` is the
   * count that existed before the window opened, so the cumulative line is whole.
   */
  private weeklyTrend(dates: Date[], base: number) {
    const now = Date.now();
    const start = now - TREND_WEEKS * WEEK_MS;
    const perWeek = new Array(TREND_WEEKS).fill(0) as number[];
    for (const d of dates) {
      const t = d.getTime();
      if (t < start) continue;
      const i = Math.min(TREND_WEEKS - 1, Math.floor((t - start) / WEEK_MS));
      perWeek[i] = (perWeek[i] ?? 0) + 1;
    }
    const cumulative: number[] = [];
    let run = base;
    for (const c of perWeek) {
      run += c;
      cumulative.push(run);
    }
    return { perWeek, cumulative };
  }

  /**
   * Everything the staff Overview screen needs: top-line counts, KPI trend
   * sparklines (cumulative orgs/users over the last 12 weeks), the new-orgs-per-
   * week bars, plan distribution, and the "needs attention" alert list (suspended
   * orgs + orgs at their seat limit). MRR/revenue is intentionally null — no
   * billing provider is wired (honest empty state in the UI).
   */
  async overview() {
    const windowStart = new Date(Date.now() - TREND_WEEKS * WEEK_MS);
    const [
      users,
      suspendedUsers,
      platformAdmins,
      orgCount,
      suspendedOrgs,
      projects,
      activeTokens,
      timelineEvents,
      activeEditorRows,
      planGroups,
      orgRows,
      orgDates,
      userDates,
      orgsBefore,
      usersBefore,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.user.count({ where: { isPlatformAdmin: true } }),
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.project.count(),
      this.prisma.apiToken.count({ where: { revokedAt: null } }),
      this.prisma.timelineEvent.count(),
      this.prisma.projectMember.findMany({
        where: { role: { in: ["editor", "owner"] } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      this.prisma.organization.groupBy({ by: ["plan"], _count: { _all: true } }),
      this.prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          plan: true,
          seatLimit: true,
          suspendedAt: true,
          _count: { select: { members: true } },
        },
      }),
      this.prisma.organization.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      this.prisma.organization.count({
        where: { createdAt: { lt: windowStart } },
      }),
      this.prisma.user.count({ where: { createdAt: { lt: windowStart } } }),
    ]);

    const orgTrend = this.weeklyTrend(
      orgDates.map((o) => o.createdAt),
      orgsBefore,
    );
    const userTrend = this.weeklyTrend(
      userDates.map((u) => u.createdAt),
      usersBefore,
    );

    const planDistribution = (["solo", "team", "enterprise"] as Plan[]).map(
      (plan) => ({
        plan,
        count: planGroups.find((g) => g.plan === plan)?._count._all ?? 0,
      }),
    );

    const alerts: {
      type: "suspended" | "seats";
      title: string;
      sub: string;
      orgId: string;
      severity: "error" | "warn";
    }[] = [];
    for (const o of orgRows) {
      const members = o._count.members;
      if (o.suspendedAt) {
        alerts.push({
          type: "suspended",
          title: `${o.name} is suspended`,
          sub: `${members} members · access frozen`,
          orgId: o.id,
          severity: "error",
        });
      } else if (o.seatLimit != null && members >= o.seatLimit) {
        alerts.push({
          type: "seats",
          title: `${o.name} at seat limit`,
          sub: `${members} / ${o.seatLimit} seats used`,
          orgId: o.id,
          severity: "warn",
        });
      }
    }

    return {
      counts: {
        users,
        suspendedUsers,
        platformAdmins,
        orgs: orgCount,
        suspendedOrgs,
        projects,
        activeTokens,
        timelineEvents,
        activeEditors: activeEditorRows.length,
      },
      // null = not wired (no billing provider); UI shows an honest dash.
      mrr: null as number | null,
      orgTrend,
      userTrend,
      planDistribution,
      alerts,
    };
  }

  /** Search users by id / email / name (case-insensitive). */
  async listUsers(q?: string, limit = 50) {
    const term = q?.trim();
    const where: Prisma.UserWhereInput = term
      ? {
          OR: [
            { id: { contains: term } },
            { email: { contains: term, mode: "insensitive" } },
            { name: { contains: term, mode: "insensitive" } },
          ],
        }
      : {};
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
      select: {
        id: true,
        email: true,
        name: true,
        imageUrl: true,
        isPlatformAdmin: true,
        suspendedAt: true,
        lastSeenAt: true,
        createdAt: true,
        _count: { select: { ownedProjects: true, memberships: true } },
        // Primary org (first joined) for the "Organization" + "Role" columns.
        orgMemberships: {
          orderBy: { addedAt: "asc" },
          take: 1,
          select: { role: true, org: { select: { name: true } } },
        },
      },
    });
    return rows.map((u) => {
      const m = u.orgMemberships[0];
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        imageUrl: u.imageUrl,
        isPlatformAdmin: u.isPlatformAdmin,
        suspendedAt: u.suspendedAt?.toISOString() ?? null,
        lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        ownedProjects: u._count.ownedProjects,
        memberships: u._count.memberships,
        orgName: m?.org.name ?? null,
        // Display role: platform staff, else their org role, else "—".
        role: u.isPlatformAdmin ? "staff" : (m?.role ?? null),
      };
    });
  }

  /** Suspend or restore a user account (denies/permits all their requests). */
  async setUserSuspended(userId: string, suspend: boolean, actor: string) {
    await this.requireUser(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: suspend ? new Date() : null },
    });
    await this.audit.record({
      scope: "platform",
      actorId: actor,
      action: suspend ? "user.suspend" : "user.restore",
      targetType: "user",
      targetId: userId,
    });
    return { ok: true as const };
  }

  /**
   * Grant or revoke the platform-admin flag. Guarded against removing the last
   * platform admin (which would lock everyone out of this portal).
   */
  async setPlatformAdmin(userId: string, value: boolean, actor: string) {
    await this.requireUser(userId);
    if (!value) {
      const admins = await this.prisma.user.count({
        where: { isPlatformAdmin: true },
      });
      const target = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isPlatformAdmin: true },
      });
      if (target?.isPlatformAdmin && admins <= 1) {
        throw new NotFoundException("Cannot remove the last platform admin");
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPlatformAdmin: value },
    });
    await this.audit.record({
      scope: "platform",
      actorId: actor,
      action: value ? "user.grantAdmin" : "user.revokeAdmin",
      targetType: "user",
      targetId: userId,
    });
    return { ok: true as const };
  }

  /** Search organizations by id / name / slug. */
  async listOrgs(q?: string, limit = 50) {
    const term = q?.trim();
    const where: Prisma.OrganizationWhereInput = term
      ? {
          OR: [
            { id: { contains: term } },
            { name: { contains: term, mode: "insensitive" } },
            { slug: { contains: term, mode: "insensitive" } },
          ],
        }
      : {};
    const rows = await this.prisma.organization.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 200),
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        seatLimit: true,
        region: true,
        suspendedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, projects: true } },
        // The org's "owner" for display = its first admin member.
        members: {
          where: { role: "admin" },
          orderBy: { addedAt: "asc" },
          take: 1,
          select: { user: { select: { email: true, name: true } } },
        },
      },
    });
    return rows.map((o) => this.orgSummary(o));
  }

  /** Shared org row shape for the list + detail header. */
  private orgSummary(o: {
    id: string;
    name: string;
    slug: string | null;
    plan: Plan;
    seatLimit: number | null;
    region: string | null;
    suspendedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { members: number; projects: number };
    members: { user: { email: string | null; name: string | null } }[];
  }) {
    const owner = o.members[0]?.user;
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      plan: o.plan,
      seatLimit: o.seatLimit,
      region: o.region,
      suspendedAt: o.suspendedAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      memberCount: o._count.members,
      projectCount: o._count.projects,
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
    };
  }

  /** Full org detail for the staff console drill-down: header + members + projects. */
  async orgDetail(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        seatLimit: true,
        region: true,
        suspendedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, projects: true } },
        members: {
          orderBy: { addedAt: "asc" },
          select: {
            userId: true,
            role: true,
            user: { select: { email: true, name: true } },
          },
        },
        projects: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            updatedAt: true,
            _count: { select: { members: true } },
          },
        },
      },
    });
    if (!org) throw new NotFoundException("No such organization");

    const adminMembers = org.members.filter((m) => m.role === "admin");
    const summary = this.orgSummary({ ...org, members: adminMembers });
    return {
      ...summary,
      members: org.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        name: m.user.name,
        email: m.user.email,
      })),
      projects: org.projects.map((p) => ({
        id: p.id,
        name: p.name,
        memberCount: p._count.members,
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  }

  /** Set an org's plan / seat limit / region (manual — no billing provider). */
  async setOrgPlan(
    orgId: string,
    data: { plan?: Plan; seatLimit?: number | null; region?: string | null },
    actor: string,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException("No such organization");
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.plan ? { plan: data.plan } : {}),
        ...(data.seatLimit !== undefined ? { seatLimit: data.seatLimit } : {}),
        ...(data.region !== undefined ? { region: data.region } : {}),
      },
    });
    await this.audit.record({
      scope: "platform",
      actorId: actor,
      action: "org.plan",
      targetType: "org",
      targetId: orgId,
      detail: data.plan ? `plan → ${data.plan}` : "updated billing fields",
    });
    return { ok: true as const };
  }

  /**
   * Mint a short-lived Clerk sign-in token to impersonate a user (e.g. an org
   * owner) for support. Returns a token the admin app turns into a sign-in URL.
   * Heavily audited — impersonation is the most sensitive staff action.
   */
  async impersonate(userId: string, actor: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException("No such user");
    let token: string;
    try {
      const created = await this.clerk.signInTokens.createSignInToken({
        userId,
        expiresInSeconds: 600,
      });
      token = created.token;
    } catch (err) {
      throw new NotFoundException(
        `Could not create impersonation token: ${(err as Error).message}`,
      );
    }
    await this.audit.record({
      scope: "platform",
      actorId: actor,
      action: "user.impersonate",
      targetType: "user",
      targetId: userId,
      detail: user.email ?? "",
    });
    return { token, userId, email: user.email };
  }

  /** Suspend or restore an org (freezes member access to all its projects). */
  async setOrgSuspended(orgId: string, suspend: boolean, actor: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException("No such organization");
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: suspend ? new Date() : null },
    });
    await this.audit.record({
      scope: "platform",
      actorId: actor,
      action: suspend ? "org.suspend" : "org.restore",
      targetType: "org",
      targetId: orgId,
    });
    return { ok: true as const };
  }

  /** Search projects across all tenants. */
  async listProjects(q?: string, limit = 50) {
    const term = q?.trim();
    const where: Prisma.ProjectWhereInput = term
      ? {
          OR: [
            { id: { contains: term } },
            { name: { contains: term, mode: "insensitive" } },
          ],
        }
      : {};
    const rows = await this.prisma.project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 200),
      select: {
        id: true,
        name: true,
        ownerId: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { email: true, name: true } },
        organization: { select: { name: true } },
        _count: { select: { members: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      ownerId: p.ownerId,
      ownerEmail: p.owner.email,
      organizationId: p.organizationId,
      organizationName: p.organization?.name ?? null,
      memberCount: p._count.members,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  /** Delete any project (cross-tenant). Everything under it cascades. */
  async deleteProject(projectId: string, actor: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException("No such project");
    await this.prisma.project.delete({ where: { id: projectId } });
    await this.audit.record({
      scope: "platform",
      actorId: actor,
      action: "project.delete",
      targetType: "project",
      targetId: projectId,
      detail: project.name,
    });
    return { ok: true as const };
  }

  /** The global audit trail (both scopes), filterable. */
  auditTrail(query: AuditQuery) {
    return this.audit.list(query);
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("No such user");
  }
}
