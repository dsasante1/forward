import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
} from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";
import { TimelineService, type TimelineRecord } from "../timeline/timeline.service.js";
import { sanitizeFields } from "../common/sanitize.js";

type Json = Prisma.InputJsonValue;
type Tx = Prisma.TransactionClient;

/** The models this service persists — all share the (projectId, id) key + data column. */
type InfraModel = "infraNode" | "infraEdge" | "infraFlow" | "entity" | "entityRelation";

/**
 * The project-scoped infrastructure graph (nodes + edges) and the narrated flows
 * over it. Persists the infra layer with
 * server-stamped `updatedAt`, sanitized Markdown, and realtime broadcast.
 *
 * Every write runs in ONE `withUser` transaction — the existence probe, the
 * upsert/delete and the timeline event commit or roll back together (an event is
 * never persisted without its change), matching the elements service. The
 * realtime broadcast happens after commit so it can never hold the transaction
 * open or roll back a write that already succeeded.
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
      const [nodes, edges, flows, entities, relations] = await Promise.all([
        tx.infraNode.findMany({ where: { projectId }, select: { data: true } }),
        tx.infraEdge.findMany({ where: { projectId }, select: { data: true } }),
        tx.infraFlow.findMany({ where: { projectId }, select: { data: true } }),
        tx.entity.findMany({ where: { projectId }, select: { data: true } }),
        tx.entityRelation.findMany({
          where: { projectId },
          select: { data: true },
        }),
      ]);
      return {
        nodes: parseAll(nodes, InfraNode),
        edges: parseAll(edges, InfraEdge),
        flows: parseAll(flows, InfraFlow),
        entities: parseAll(entities, Entity),
        relations: parseAll(relations, EntityRelation),
      };
    });
  }

  async saveNode(projectId: string, node: InfraNode, actor: string) {
    const next: InfraNode = {
      ...sanitizeFields(node, ["label", "tech", "description"]),
      updatedAt: new Date().toISOString(),
    };
    await this.writeOne(projectId, actor, "infraNode", next.id, next, (existed) => ({
      domain: "infra",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.label,
      detail: `${existed ? "Updated" : "Added"} ${next.kind} node "${next.label}"`,
    }));
    await this.emit(projectId, "infra", "upsert", [next.id], actor);
    return next;
  }

  async deleteNode(projectId: string, nodeId: string, actor: string) {
    await this.prisma.withUser(actor, async (tx) => {
      const label = await this.nameOf(tx, projectId, "infraNode", nodeId);
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
      await this.timeline.record(tx, projectId, actor, {
        domain: "infra",
        action: "deleted",
        targetId: nodeId,
        title: label ?? nodeId,
        detail: `Removed node "${label ?? nodeId}"`,
      });
    });
    await this.emit(projectId, "infra", "delete", [nodeId], actor);
  }

  async saveEdge(projectId: string, edge: InfraEdge, actor: string) {
    const next: InfraEdge = {
      ...sanitizeFields(edge, ["label"]),
      updatedAt: new Date().toISOString(),
    };
    await this.writeOne(projectId, actor, "infraEdge", next.id, next, (existed) => ({
      domain: "infra",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.label || `${next.from} → ${next.to}`,
      detail: `${existed ? "Updated" : "Linked"} ${next.from} → ${next.to}`,
    }));
    await this.emit(projectId, "infra", "upsert", [next.id], actor);
    return next;
  }

  async deleteEdge(projectId: string, edgeId: string, actor: string) {
    await this.prisma.withUser(actor, async (tx) => {
      await tx.infraEdge.deleteMany({ where: { projectId, id: edgeId } });
      await this.timeline.record(tx, projectId, actor, {
        domain: "infra",
        action: "deleted",
        targetId: edgeId,
        title: "edge",
        detail: "Removed an edge",
      });
    });
    await this.emit(projectId, "infra", "delete", [edgeId], actor);
  }

  async saveFlow(projectId: string, flow: InfraFlow, actor: string) {
    const next: InfraFlow = {
      ...sanitizeFields(flow, ["name", "description"]),
      updatedAt: new Date().toISOString(),
    };
    await this.writeOne(projectId, actor, "infraFlow", next.id, next, (existed) => ({
      domain: "flow",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.name,
      detail: `${existed ? "Updated" : "Narrated"} the ${next.name} flow (${next.steps.length} steps)`,
    }));
    await this.emit(projectId, "flows", "upsert", [next.id], actor);
    return next;
  }

  async deleteFlow(projectId: string, flowId: string, actor: string) {
    await this.prisma.withUser(actor, async (tx) => {
      const name = await this.nameOf(tx, projectId, "infraFlow", flowId);
      await tx.infraFlow.deleteMany({ where: { projectId, id: flowId } });
      await this.timeline.record(tx, projectId, actor, {
        domain: "flow",
        action: "deleted",
        targetId: flowId,
        title: name ?? flowId,
        detail: `Removed the ${name ?? flowId} flow`,
      });
    });
    await this.emit(projectId, "flows", "delete", [flowId], actor);
  }

  // --- entity (ER / data model) layer --------------------------------------

  async saveEntity(projectId: string, entity: Entity, actor: string) {
    const next: Entity = {
      ...sanitizeFields(entity, ["name", "description"]),
      updatedAt: new Date().toISOString(),
    };
    await this.writeOne(projectId, actor, "entity", next.id, next, (existed) => ({
      domain: "flow",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.name,
      detail: `${existed ? "Updated" : "Added"} entity "${next.name}" (${next.fields.length} fields)`,
    }));
    await this.emit(projectId, "entities", "upsert", [next.id], actor);
    return next;
  }

  async deleteEntity(projectId: string, entityId: string, actor: string) {
    await this.prisma.withUser(actor, async (tx) => {
      const name = await this.nameOf(tx, projectId, "entity", entityId);
      await tx.entity.deleteMany({ where: { projectId, id: entityId } });
      // Drop relations touching the entity so none dangle.
      const relations = parseAll(
        await tx.entityRelation.findMany({
          where: { projectId },
          select: { data: true },
        }),
        EntityRelation,
      );
      const dangling = relations
        .filter((r) => r.from === entityId || r.to === entityId)
        .map((r) => r.id);
      if (dangling.length) {
        await tx.entityRelation.deleteMany({
          where: { projectId, id: { in: dangling } },
        });
      }
      await this.timeline.record(tx, projectId, actor, {
        domain: "flow",
        action: "deleted",
        targetId: entityId,
        title: name ?? entityId,
        detail: `Removed entity "${name ?? entityId}"`,
      });
    });
    await this.emit(projectId, "entities", "delete", [entityId], actor);
  }

  async saveRelation(projectId: string, relation: EntityRelation, actor: string) {
    const next: EntityRelation = {
      ...sanitizeFields(relation, ["label"]),
      updatedAt: new Date().toISOString(),
    };
    await this.writeOne(
      projectId,
      actor,
      "entityRelation",
      next.id,
      next,
      (existed) => ({
        domain: "flow",
        action: existed ? "modified" : "created",
        targetId: next.id,
        title: next.label || `${next.from} → ${next.to}`,
        detail: `${existed ? "Updated" : "Related"} ${next.from} → ${next.to}`,
      }),
    );
    await this.emit(projectId, "entities", "upsert", [next.id], actor);
    return next;
  }

  async deleteRelation(projectId: string, relationId: string, actor: string) {
    await this.prisma.withUser(actor, async (tx) => {
      await tx.entityRelation.deleteMany({ where: { projectId, id: relationId } });
      await this.timeline.record(tx, projectId, actor, {
        domain: "flow",
        action: "deleted",
        targetId: relationId,
        title: "relation",
        detail: "Removed a relation",
      });
    });
    await this.emit(projectId, "entities", "delete", [relationId], actor);
  }

  // --- internals -----------------------------------------------------------

  /**
   * One atomic write: probe existence (drives created-vs-modified), upsert the
   * row and record the timeline event in a single RLS-scoped transaction.
   */
  private async writeOne(
    projectId: string,
    actor: string,
    model: InfraModel,
    id: string,
    data: unknown,
    event: (existed: boolean) => TimelineRecord,
  ): Promise<void> {
    await this.prisma.withUser(actor, async (tx) => {
      const existed = await this.exists(tx, projectId, model, id);
      await this.upsert(tx, projectId, model, id, data);
      await this.timeline.record(tx, projectId, actor, event(existed));
    });
  }

  /** Does a row with this id already exist? (drives created-vs-modified events) */
  private async exists(
    tx: Tx,
    projectId: string,
    model: InfraModel,
    id: string,
  ): Promise<boolean> {
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
  }

  /** The display name (label/name) of a node, flow or entity, for delete titles. */
  private async nameOf(
    tx: Tx,
    projectId: string,
    model: "infraNode" | "infraFlow" | "entity",
    id: string,
  ): Promise<string | null> {
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
  }

  private async upsert(
    tx: Tx,
    projectId: string,
    model: InfraModel,
    id: string,
    data: unknown,
  ): Promise<void> {
    // These delegates share the same composite key + columns, so a minimal
    // structural type lets one helper serve all of them.
    type UpsertDelegate = {
      upsert(args: {
        where: { projectId_id: { projectId: string; id: string } };
        update: { data: Json; updatedAt: Date };
        create: { projectId: string; id: string; data: Json; updatedAt: Date };
      }): Promise<unknown>;
    };
    await (tx[model] as unknown as UpsertDelegate).upsert({
      where: { projectId_id: { projectId, id } },
      update: { data: data as Json, updatedAt: new Date() },
      create: { projectId, id, data: data as Json, updatedAt: new Date() },
    });
  }

  private async emit(
    projectId: string,
    resource: "infra" | "flows" | "entities",
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
