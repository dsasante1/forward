import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import {
  ProjectTimelineEvent,
  TimelineDomain,
  VersionAction,
} from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";

/** What a service records when something changes — author/timestamp are stamped here. */
export interface TimelineRecord {
  domain: TimelineDomain;
  action: VersionAction;
  targetId: string;
  title: string;
  detail?: string;
}

/**
 * The unified, project-wide activity feed behind the canvas History timeline.
 * Append-only: the element + infra services call `record()` inside their own
 * write transaction (so an event is never persisted without its change), and the
 * History view reads `list()`. No route mutates existing rows.
 */
@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert one activity event within the caller's RLS-scoped transaction. The
   * server stamps `author` (the actor) and `ts` (now), mirroring how element
   * version entries are written.
   */
  async record(
    tx: PrismaClient,
    projectId: string,
    actor: string,
    event: TimelineRecord,
  ): Promise<void> {
    await tx.timelineEvent.create({
      data: {
        projectId,
        domain: event.domain,
        action: event.action,
        targetId: event.targetId,
        title: event.title,
        detail: event.detail ?? "",
        author: actor,
        ts: BigInt(Date.now()),
      },
    });
  }

  /**
   * Record an event in its own RLS-scoped transaction — for callers (the infra
   * service) whose write isn't already inside a shared transaction.
   */
  async add(
    projectId: string,
    actor: string,
    event: TimelineRecord,
  ): Promise<void> {
    await this.prisma.withUser(actor, (tx) =>
      this.record(tx as unknown as PrismaClient, projectId, actor, event),
    );
  }

  /** The whole feed, newest first — what the History timeline reads. */
  async list(
    projectId: string,
    actor: string,
  ): Promise<ProjectTimelineEvent[]> {
    return this.prisma.withUser(actor, async (tx) => {
      const rows = await tx.timelineEvent.findMany({
        where: { projectId },
        orderBy: [{ ts: "desc" }, { seq: "desc" }],
      });
      return rows.flatMap((r) => {
        const parsed = ProjectTimelineEvent.safeParse({
          seq: Number(r.seq),
          domain: r.domain,
          action: r.action,
          targetId: r.targetId,
          title: r.title,
          detail: r.detail,
          author: r.author,
          timestamp: Number(r.ts),
        });
        return parsed.success ? [parsed.data] : [];
      });
    });
  }
}
