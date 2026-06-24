import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { InfraEdge, InfraFlow, InfraNode } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { sanitizeFields } from "../common/sanitize.js";

type Json = Prisma.InputJsonValue;

/**
 * The project-scoped infrastructure graph (nodes + edges) and the narrated flows
 * over it. Mirrors the infra functions in packages/shared/src/rtdb-rest.ts, with
 * server-stamped `updatedAt`, sanitized Markdown, and realtime broadcast.
 */
@Injectable()
export class InfraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly timeline: TimelineService,
  ) {}

  async fetch(projectId: string, actor: string) {
    return this.prisma.withUser(actor, async (tx) => {
      const [nodes, edges, flows] = await Promise.all([
        tx.infraNode.findMany({ where: { projectId }, select: { data: true } }),
        tx.infraEdge.findMany({ where: { projectId }, select: { data: true } }),
        tx.infraFlow.findMany({ where: { projectId }, select: { data: true } }),
      ]);
      return {
        nodes: parseAll(nodes, InfraNode),
        edges: parseAll(edges, InfraEdge),
        flows: parseAll(flows, InfraFlow),
      };
    });
  }

  async saveNode(projectId: string, node: InfraNode, actor: string) {
    const next: InfraNode = {
      ...sanitizeFields(node, ["label", "tech", "description"]),
      updatedAt: new Date().toISOString(),
    };
    const existed = await this.exists(projectId, "infraNode", next.id, actor);
    await this.upsert(projectId, "infraNode", next.id, next, actor);
    await this.emit(projectId, "infra", "upsert", [next.id], actor);
    await this.timeline.add(projectId, actor, {
      domain: "infra",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.label,
      detail: `${existed ? "Updated" : "Added"} ${next.kind} node "${next.label}"`,
    });
    return next;
  }

  async deleteNode(projectId: string, nodeId: string, actor: string) {
    const label = await this.nameOf(projectId, "infraNode", nodeId, actor);
    await this.prisma.withUser(actor, async (tx) => {
      await tx.infraNode.deleteMany({ where: { projectId, id: nodeId } });
      // Drop edges touching the node so none dangle.
      const edges = parseAll(
        await tx.infraEdge.findMany({ where: { projectId }, select: { data: true } }),
        InfraEdge,
      );
      const dangling = edges
        .filter((e) => e.from === nodeId || e.to === nodeId)
        .map((e) => e.id);
      if (dangling.length) {
        await tx.infraEdge.deleteMany({
          where: { projectId, id: { in: dangling } },
        });
      }
    });
    await this.emit(projectId, "infra", "delete", [nodeId], actor);
    await this.timeline.add(projectId, actor, {
      domain: "infra",
      action: "deleted",
      targetId: nodeId,
      title: label ?? nodeId,
      detail: `Removed node "${label ?? nodeId}"`,
    });
  }

  async saveEdge(projectId: string, edge: InfraEdge, actor: string) {
    const next: InfraEdge = {
      ...sanitizeFields(edge, ["label"]),
      updatedAt: new Date().toISOString(),
    };
    const existed = await this.exists(projectId, "infraEdge", next.id, actor);
    await this.upsert(projectId, "infraEdge", next.id, next, actor);
    await this.emit(projectId, "infra", "upsert", [next.id], actor);
    const edgeLabel = next.label || `${next.from} → ${next.to}`;
    await this.timeline.add(projectId, actor, {
      domain: "infra",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: edgeLabel,
      detail: `${existed ? "Updated" : "Linked"} ${next.from} → ${next.to}`,
    });
    return next;
  }

  async deleteEdge(projectId: string, edgeId: string, actor: string) {
    await this.prisma.withUser(actor, (tx) =>
      tx.infraEdge.deleteMany({ where: { projectId, id: edgeId } }),
    );
    await this.emit(projectId, "infra", "delete", [edgeId], actor);
    await this.timeline.add(projectId, actor, {
      domain: "infra",
      action: "deleted",
      targetId: edgeId,
      title: "edge",
      detail: "Removed an edge",
    });
  }

  async saveFlow(projectId: string, flow: InfraFlow, actor: string) {
    const next: InfraFlow = {
      ...sanitizeFields(flow, ["name", "description"]),
      updatedAt: new Date().toISOString(),
    };
    const existed = await this.exists(projectId, "infraFlow", next.id, actor);
    await this.upsert(projectId, "infraFlow", next.id, next, actor);
    await this.emit(projectId, "flows", "upsert", [next.id], actor);
    await this.timeline.add(projectId, actor, {
      domain: "uml",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.name,
      detail: `${existed ? "Updated" : "Narrated"} the ${next.name} flow (${next.steps.length} steps)`,
    });
    return next;
  }

  async deleteFlow(projectId: string, flowId: string, actor: string) {
    const name = await this.nameOf(projectId, "infraFlow", flowId, actor);
    await this.prisma.withUser(actor, (tx) =>
      tx.infraFlow.deleteMany({ where: { projectId, id: flowId } }),
    );
    await this.emit(projectId, "flows", "delete", [flowId], actor);
    await this.timeline.add(projectId, actor, {
      domain: "uml",
      action: "deleted",
      targetId: flowId,
      title: name ?? flowId,
      detail: `Removed the ${name ?? flowId} flow`,
    });
  }

  // --- internals -----------------------------------------------------------

  /** Does a row with this id already exist? (drives created-vs-modified events) */
  private async exists(
    projectId: string,
    model: "infraNode" | "infraEdge" | "infraFlow",
    id: string,
    actor: string,
  ): Promise<boolean> {
    return this.prisma.withUser(actor, async (tx) => {
      type FindDelegate = {
        findUnique(args: {
          where: { projectId_id: { projectId: string; id: string } };
          select: { id: true };
        }): Promise<unknown>;
      };
      const row = await (tx[model] as unknown as FindDelegate).findUnique({
        where: { projectId_id: { projectId, id } },
        select: { id: true },
      });
      return row != null;
    });
  }

  /** The display name (label/name) of a node or flow, for delete-event titles. */
  private async nameOf(
    projectId: string,
    model: "infraNode" | "infraFlow",
    id: string,
    actor: string,
  ): Promise<string | null> {
    return this.prisma.withUser(actor, async (tx) => {
      type FindDelegate = {
        findUnique(args: {
          where: { projectId_id: { projectId: string; id: string } };
          select: { data: true };
        }): Promise<{ data: unknown } | null>;
      };
      const row = await (tx[model] as unknown as FindDelegate).findUnique({
        where: { projectId_id: { projectId, id } },
        select: { data: true },
      });
      const data = row?.data as { label?: string; name?: string } | undefined;
      return data?.label ?? data?.name ?? null;
    });
  }

  private async upsert(
    projectId: string,
    model: "infraNode" | "infraEdge" | "infraFlow",
    id: string,
    data: unknown,
    actor: string,
  ): Promise<void> {
    // The three infra delegates share the same composite key + columns, so a
    // minimal structural type lets one helper serve all three.
    type UpsertDelegate = {
      upsert(args: {
        where: { projectId_id: { projectId: string; id: string } };
        update: { data: Json; updatedAt: Date };
        create: { projectId: string; id: string; data: Json; updatedAt: Date };
      }): Promise<unknown>;
    };
    await this.prisma.withUser(actor, (tx) =>
      (tx[model] as unknown as UpsertDelegate).upsert({
        where: { projectId_id: { projectId, id } },
        update: { data: data as Json, updatedAt: new Date() },
        create: { projectId, id, data: data as Json, updatedAt: new Date() },
      }),
    );
  }

  private async emit(
    projectId: string,
    resource: "infra" | "flows",
    op: "upsert" | "delete",
    ids: string[],
    actor: string,
  ): Promise<void> {
    await this.realtime.publish(projectId, {
      resource,
      op,
      ids,
      actor,
      at: Date.now(),
    });
  }
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
