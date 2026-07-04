import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  Checkpoint,
  CheckpointChange,
  CheckpointInput,
  CheckpointSnapshot,
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraNode,
} from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { sanitizeFields } from "../common/sanitize.js";

type Json = Prisma.InputJsonValue;

/**
 * Manual, named canvas snapshots (pillar 5). A checkpoint freezes the project's
 * current design + infra graph so it can be restored later. The server — not the
 * client — assembles the snapshot from the persisted tables, so a checkpoint
 * always reflects the real canvas, and stamps `author`/`createdAt` from the
 * session. Restore rewinds those layers transactionally; the append-only endpoint
 * timeline is left intact (it is a record, not part of the snapshot).
 */
@Injectable()
export class CheckpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly timeline: TimelineService,
  ) {}

  async list(projectId: string, actor: string): Promise<Checkpoint[]> {
    return this.prisma.withUser(actor, async (tx) => {
      const rows = await tx.checkpoint.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        select: { data: true },
      });
      return rows.flatMap((r) => {
        const p = Checkpoint.safeParse(r.data);
        return p.success ? [p.data] : [];
      });
    });
  }

  async create(
    projectId: string,
    input: CheckpointInput,
    actor: string,
  ): Promise<Checkpoint> {
    const clean = sanitizeFields(input, ["title", "description"]);
    const id = `cp_${randomUUID()}`;
    const now = new Date();
    const cp = await this.prisma.withUser(actor, async (tx) => {
      const snapshot = await this.snapshotOf(tx, projectId);
      const parsed: Checkpoint = Checkpoint.parse({
        id,
        title: clean.title,
        description: clean.description,
        tag: clean.tag,
        author: actor,
        changes: changesOf(snapshot),
        snapshot,
        createdAt: now.toISOString(),
      });
      await tx.checkpoint.create({
        data: {
          projectId,
          id,
          data: parsed as unknown as Json,
          createdAt: now,
        },
      });
      return parsed;
    });
    // After commit: a broadcast must never hold the transaction open or roll
    // back a write that already succeeded.
    await this.emit(projectId, "upsert", [id], actor);
    return cp;
  }

  async delete(projectId: string, id: string, actor: string): Promise<void> {
    await this.prisma.withUser(actor, (tx) =>
      tx.checkpoint.deleteMany({ where: { projectId, id } }),
    );
    await this.emit(projectId, "delete", [id], actor);
  }

  /**
   * Rewind the project's design elements + infra graph to the checkpoint's
   * snapshot, in one transaction: drop what's there now, then recreate from the
   * frozen copy. Broadcasts a change on every affected layer so live clients
   * re-fetch.
   */
  async restore(projectId: string, id: string, actor: string): Promise<void> {
    const cp = await this.prisma.withUser(actor, async (tx) => {
      const row = await tx.checkpoint.findUnique({
        where: { projectId_id: { projectId, id } },
        select: { data: true },
      });
      if (!row) throw new NotFoundException(`No checkpoint "${id}"`);
      const parsed = Checkpoint.parse(row.data);
      const { elements, infraNodes, infraEdges, infraFlows } = parsed.snapshot;
      const stamp = new Date();

      await tx.designElement.deleteMany({ where: { projectId } });
      if (elements.length) {
        await tx.designElement.createMany({
          data: elements.map((e) => ({
            projectId,
            id: e.id,
            data: e as unknown as Json,
            updatedAt: stamp,
          })),
        });
      }
      await tx.infraNode.deleteMany({ where: { projectId } });
      if (infraNodes.length) {
        await tx.infraNode.createMany({
          data: infraNodes.map((n) => ({
            projectId,
            id: n.id,
            data: n as unknown as Json,
            updatedAt: stamp,
          })),
        });
      }
      await tx.infraEdge.deleteMany({ where: { projectId } });
      if (infraEdges.length) {
        await tx.infraEdge.createMany({
          data: infraEdges.map((e) => ({
            projectId,
            id: e.id,
            data: e as unknown as Json,
            updatedAt: stamp,
          })),
        });
      }
      await tx.infraFlow.deleteMany({ where: { projectId } });
      if (infraFlows.length) {
        await tx.infraFlow.createMany({
          data: infraFlows.map((f) => ({
            projectId,
            id: f.id,
            data: f as unknown as Json,
            updatedAt: stamp,
          })),
        });
      }
      await tx.project.update({
        where: { id: projectId },
        data: { updatedAt: stamp },
      });
      // A restore rewinds every layer — leave a record in the activity feed,
      // in the same transaction as the rewind itself.
      await this.timeline.record(tx, projectId, actor, {
        domain: "design",
        action: "modified",
        targetId: id,
        title: parsed.title,
        detail:
          `Restored checkpoint "${parsed.title}" ` +
          `(${parsed.snapshot.elements.length} elements, ` +
          `${parsed.snapshot.infraNodes.length} infra nodes, ` +
          `${parsed.snapshot.infraFlows.length} flows)`,
      });
      return parsed;
    });

    // A restore touches every layer — tell live clients to re-fetch them all.
    const at = Date.now();
    await Promise.all([
      this.realtime.publish(projectId, {
        resource: "elements",
        op: "upsert",
        ids: cp.snapshot.elements.map((e) => e.id),
        actor,
        at,
      }),
      this.realtime.publish(projectId, {
        resource: "infra",
        op: "upsert",
        ids: [
          ...cp.snapshot.infraNodes.map((n) => n.id),
          ...cp.snapshot.infraEdges.map((e) => e.id),
        ],
        actor,
        at,
      }),
      this.realtime.publish(projectId, {
        resource: "flows",
        op: "upsert",
        ids: cp.snapshot.infraFlows.map((f) => f.id),
        actor,
        at,
      }),
    ]);
  }

  // --- internals -----------------------------------------------------------

  /** Freeze the project's current design + infra into a checkpoint snapshot. */
  private async snapshotOf(
    tx: Prisma.TransactionClient,
    projectId: string,
  ): Promise<CheckpointSnapshot> {
    const [elements, nodes, edges, flows] = await Promise.all([
      tx.designElement.findMany({ where: { projectId }, select: { data: true } }),
      tx.infraNode.findMany({ where: { projectId }, select: { data: true } }),
      tx.infraEdge.findMany({ where: { projectId }, select: { data: true } }),
      tx.infraFlow.findMany({ where: { projectId }, select: { data: true } }),
    ]);
    return CheckpointSnapshot.parse({
      elements: parseAll(elements, DesignElement),
      infraNodes: parseAll(nodes, InfraNode),
      infraEdges: parseAll(edges, InfraEdge),
      infraFlows: parseAll(flows, InfraFlow),
    });
  }

  private async emit(
    projectId: string,
    op: "upsert" | "delete",
    ids: string[],
    actor: string,
  ): Promise<void> {
    await this.realtime.publish(projectId, {
      resource: "checkpoints",
      op,
      ids,
      actor,
      at: Date.now(),
    });
  }
}

/** Per-layer change-count chips for a checkpoint card, from its snapshot. */
function changesOf(snapshot: CheckpointSnapshot): CheckpointChange[] {
  const out: CheckpointChange[] = [];
  if (snapshot.elements.length) {
    out.push({ layer: "DESIGN", n: snapshot.elements.length });
  }
  const infra = snapshot.infraNodes.length + snapshot.infraEdges.length;
  if (infra) out.push({ layer: "INFRA", n: infra });
  if (snapshot.infraFlows.length) {
    out.push({ layer: "UML", n: snapshot.infraFlows.length });
  }
  return out;
}

function parseAll<T>(
  rows: Array<{ data: unknown }>,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T[] {
  return rows.flatMap((r) => {
    const p = schema.safeParse(r.data);
    return p.success && p.data ? [p.data] : [];
  });
}
