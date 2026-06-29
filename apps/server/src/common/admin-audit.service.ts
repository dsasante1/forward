import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

/** What a privileged action targets, for the audit row. */
export type AuditTargetType = "project" | "user" | "org" | "token";

/** A single privileged action to record. `ts` is stamped here, not by the caller. */
export interface AuditInput {
  scope: "org" | "platform";
  /** Set for scope='org' so an org's trail can be queried in isolation. */
  orgId?: string;
  /** Clerk uid of the admin who performed the action. */
  actorId: string;
  /** Dotted verb, e.g. 'project.transfer', 'user.suspend', 'token.revoke'. */
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  detail?: string;
}

/** Filters for reading the trail back (Org Admin: by org; Platform: global). */
export interface AuditQuery {
  scope?: "org" | "platform";
  orgId?: string;
  actorId?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  limit?: number;
}

/**
 * The append-only audit trail behind both admin portals. Writes are INSERT-only
 * and server-stamped — the tamper-evident record of every privileged action. No
 * method updates or deletes a row, by design.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record one privileged action. Never throws into the caller's happy path. */
  async record(input: AuditInput): Promise<void> {
    await this.prisma.adminAuditEvent.create({
      data: {
        scope: input.scope,
        orgId: input.orgId ?? null,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: input.detail ?? "",
        ts: BigInt(Date.now()),
      },
    });
  }

  /** Read the trail back, newest first. Used by both portals' activity views. */
  async list(query: AuditQuery = {}) {
    const where: Prisma.AdminAuditEventWhereInput = {
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
    };
    const rows = await this.prisma.adminAuditEvent.findMany({
      where,
      orderBy: { ts: "desc" },
      take: Math.min(query.limit ?? 100, 500),
    });
    // BigInt → number for JSON (ms timestamps are well within Number range).
    return rows.map((r) => ({ ...r, ts: Number(r.ts) }));
  }
}
