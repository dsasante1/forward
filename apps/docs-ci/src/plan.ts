import { z } from "zod";
import {
  AgentNode,
  ApiBinding,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  McpServerNode,
  VersionAction,
} from "forward-core";

/**
 * The `forward-docs.json` contract — the ONLY thing the customer's AI has to
 * produce. It is deliberately a *content* contract, not a canvas contract:
 *
 *   - No geometry. The AI never invents x/y/width/height — `apply` places new
 *     nodes on a grid and preserves the coordinates of ones that already exist,
 *     so the layout is stable across re-runs and the model stays out of a job it
 *     is bad at.
 *   - No timestamps. `apply` stamps `updatedAt`; the server owns identity.
 *   - Every shape is *derived from the canonical forward-core schema* (never
 *     re-declared), so this file can never drift from the real data contract —
 *     it is the same Zod objects with the machine-owned fields relaxed.
 *
 * `apply` re-parses each hydrated object through the strict forward-core schema
 * before writing, so a loose input here still can't produce an invalid write.
 */

/**
 * Geometry made optional WITHOUT the canonical defaults. zod 4 fills a
 * `.default()` inside `.partial()`, and `apply` reads an absent width/height/
 * parent as "keep the stored one" — so a defaulted value would reset every box
 * someone resized or nested on each run.
 */
const geometry = {
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  parentId: z.string().nullable().optional(),
};

/** Attach/replace an element's API documentation. `elementId` is resolved by the
 *  AI from the `@adc <id>` anchor in the source — that is what makes a re-run
 *  update the same element instead of creating a duplicate. */
export const BindingInput = ApiBinding.extend({
  /** The design element this documentation attaches to (from its `@adc` anchor). */
  elementId: z.string().min(1),
  /** Version label for the history entry; `apply` defaults it to the commit sha. */
  version: z.string().optional(),
  /** One-line summary of the change; defaults to the merge commit message. */
  changeLog: z.string().optional(),
  action: VersionAction.optional(),
});
export type BindingInput = z.infer<typeof BindingInput>;

/** An ER table. Geometry is optional — `apply` owns placement. */
export const EntityInput = Entity.omit({ updatedAt: true }).extend(geometry);
export type EntityInput = z.infer<typeof EntityInput>;

/** A crow's-foot relation between two entities (by id). */
export const EntityRelationInput = EntityRelation.omit({ updatedAt: true });
export type EntityRelationInput = z.infer<typeof EntityRelationInput>;

/** An infrastructure component. Geometry is optional — `apply` owns placement. */
export const InfraNodeInput = InfraNode.omit({ updatedAt: true }).extend(geometry);
export type InfraNodeInput = z.infer<typeof InfraNodeInput>;

/** A directed connection between two infra nodes (by id). */
export const InfraEdgeInput = InfraEdge.omit({ updatedAt: true });
export type InfraEdgeInput = z.infer<typeof InfraEdgeInput>;

/** A narrated flow over the infra nodes. `steps` reference node ids by `from`/`to`. */
export const InfraFlowInput = InfraFlow.omit({ updatedAt: true });
export type InfraFlowInput = z.infer<typeof InfraFlowInput>;

/** An MCP server box (pillar 8). Geometry optional — `apply` owns placement. */
export const McpServerInput = McpServerNode.omit({ updatedAt: true }).extend(geometry);
export type McpServerInput = z.infer<typeof McpServerInput>;

/** An agent box; `mcpServerIds` wire it to the MCP servers it can call (by id). */
export const AgentInput = AgentNode.omit({ updatedAt: true }).extend(geometry);
export type AgentInput = z.infer<typeof AgentInput>;

/**
 * The whole document. Every layer is optional — a merge that only touched one
 * endpoint produces a plan with a single `bindings` entry and nothing else.
 */
export const Plan = z.object({
  /** Contract version; bump if the shape changes. */
  version: z.literal(1).default(1),
  bindings: z.array(BindingInput).default([]),
  entities: z.array(EntityInput).default([]),
  entityRelations: z.array(EntityRelationInput).default([]),
  infraNodes: z.array(InfraNodeInput).default([]),
  infraEdges: z.array(InfraEdgeInput).default([]),
  infraFlows: z.array(InfraFlowInput).default([]),
  mcpServers: z.array(McpServerInput).default([]),
  agents: z.array(AgentInput).default([]),
});
export type Plan = z.infer<typeof Plan>;
