import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AgentNode, McpServerNode } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { sanitizeFields, sanitizeMarkdown } from "../common/sanitize.js";

type Json = Prisma.InputJsonValue;

/**
 * The project-scoped Agent / MCP layer — agents (model + system prompt) and the
 * MCP servers they call. Mirrors the agent functions in
 * packages/shared/src/rtdb-rest.ts, with server-stamped `updatedAt`, sanitized
 * Markdown, realtime broadcast, and an `agent`-domain timeline event per write so
 * the change lands in the History view like every other layer.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly timeline: TimelineService,
  ) {}

  /** Agents + MCP servers in one read (the twin of rtdb-rest.fetchAgents). */
  async fetch(projectId: string, actor: string) {
    return this.prisma.withUser(actor, async (tx) => {
      const [agents, servers] = await Promise.all([
        tx.agentNode.findMany({ where: { projectId }, select: { data: true } }),
        tx.mcpServer.findMany({ where: { projectId }, select: { data: true } }),
      ]);
      return {
        agents: parseAll(agents, AgentNode),
        servers: parseAll(servers, McpServerNode),
      };
    });
  }

  async saveAgent(projectId: string, agent: AgentNode, actor: string) {
    const next: AgentNode = {
      ...sanitizeFields(agent, ["label", "model", "systemPrompt", "description"]),
      updatedAt: new Date().toISOString(),
    };
    const existed = await this.exists(projectId, "agentNode", next.id, actor);
    await this.upsert(projectId, "agentNode", next.id, next, actor);
    await this.emit(projectId, "upsert", [next.id], actor);
    await this.timeline.add(projectId, actor, {
      domain: "agent",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.label,
      detail: `${existed ? "Updated" : "Added"} agent "${next.label}"${
        next.model ? ` (${next.model})` : ""
      }`,
    });
    return next;
  }

  async deleteAgent(projectId: string, agentId: string, actor: string) {
    const label = await this.nameOf(projectId, "agentNode", agentId, actor);
    await this.prisma.withUser(actor, (tx) =>
      tx.agentNode.deleteMany({ where: { projectId, id: agentId } }),
    );
    await this.emit(projectId, "delete", [agentId], actor);
    await this.timeline.add(projectId, actor, {
      domain: "agent",
      action: "deleted",
      targetId: agentId,
      title: label ?? agentId,
      detail: `Removed agent "${label ?? agentId}"`,
    });
  }

  async saveServer(projectId: string, server: McpServerNode, actor: string) {
    const next: McpServerNode = {
      ...sanitizeFields(server, ["label", "tech", "description"]),
      // Each tool carries free-form Markdown (name + description) rendered on the
      // canvas — sanitize the nested array too, not just the top-level fields.
      tools: server.tools.map((t) => ({
        ...t,
        name: sanitizeMarkdown(t.name),
        description: sanitizeMarkdown(t.description),
      })),
      updatedAt: new Date().toISOString(),
    };
    const existed = await this.exists(projectId, "mcpServer", next.id, actor);
    await this.upsert(projectId, "mcpServer", next.id, next, actor);
    await this.emit(projectId, "upsert", [next.id], actor);
    await this.timeline.add(projectId, actor, {
      domain: "agent",
      action: existed ? "modified" : "created",
      targetId: next.id,
      title: next.label,
      detail: `${existed ? "Updated" : "Added"} MCP server "${next.label}" (${next.transport}, ${next.tools.length} tools)`,
    });
    return next;
  }

  /**
   * Delete a server and drop it from any agent's `mcpServerIds`, so the wiring
   * diagram never keeps a dangling "uses" arrow — the same cascade
   * InfraService.deleteNode does for edges.
   */
  async deleteServer(projectId: string, serverId: string, actor: string) {
    const label = await this.nameOf(projectId, "mcpServer", serverId, actor);
    await this.prisma.withUser(actor, async (tx) => {
      await tx.mcpServer.deleteMany({ where: { projectId, id: serverId } });
      const agents = parseAll(
        await tx.agentNode.findMany({
          where: { projectId },
          select: { data: true },
        }),
        AgentNode,
      );
      for (const a of agents) {
        if (!a.mcpServerIds.includes(serverId)) continue;
        const next: AgentNode = {
          ...a,
          mcpServerIds: a.mcpServerIds.filter((id) => id !== serverId),
          updatedAt: new Date().toISOString(),
        };
        await tx.agentNode.update({
          where: { projectId_id: { projectId, id: a.id } },
          data: { data: next as unknown as Json, updatedAt: new Date() },
        });
      }
    });
    await this.emit(projectId, "delete", [serverId], actor);
    await this.timeline.add(projectId, actor, {
      domain: "agent",
      action: "deleted",
      targetId: serverId,
      title: label ?? serverId,
      detail: `Removed MCP server "${label ?? serverId}"`,
    });
  }

  // --- internals -----------------------------------------------------------

  /** Does a row with this id already exist? (drives created-vs-modified events) */
  private async exists(
    projectId: string,
    model: "agentNode" | "mcpServer",
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

  /** The display label of an agent or server, for delete titles. */
  private async nameOf(
    projectId: string,
    model: "agentNode" | "mcpServer",
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
      const data = row?.data as { label?: string } | undefined;
      return data?.label ?? null;
    });
  }

  private async upsert(
    projectId: string,
    model: "agentNode" | "mcpServer",
    id: string,
    data: unknown,
    actor: string,
  ): Promise<void> {
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
    op: "upsert" | "delete",
    ids: string[],
    actor: string,
  ): Promise<void> {
    await this.realtime.publish(projectId, {
      resource: "agents",
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
