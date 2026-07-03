import type {
  AgentNode,
  ApiBinding,
  Checkpoint,
  CheckpointInput,
  DesignElement,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  McpServerNode,
  ProjectRole,
  ProjectTimelineEvent,
  Task,
  VersionEntry,
} from "forward-core";
import type { RosterMember } from "forward-core/api";

export type { ProjectRole, RosterMember };

/**
 * The data contract the canvas editor renders against. The only implementation
 * is `ServerSource` (the Forward backend over REST); the canvas is always
 * embedded by a host (the dashboard) that builds the source with its own auth.
 */
export interface ElementSnapshot {
  element: DesignElement;
  timeline: VersionEntry[];
}

/**
 * The project's infrastructure graph (pillar 3) — standalone nodes + edges —
 * plus the narrated `flows` layered over them (pillar 3b). A flow is a pure
 * function of its steps + these nodes, so it carries no geometry of its own.
 */
export interface InfraSnapshot {
  nodes: InfraNode[];
  edges: InfraEdge[];
  flows: InfraFlow[];
}

/**
 * The project's ER / data-model graph (the structural data view) — standalone
 * entities + the crow's-foot relations between them. Separate from both the
 * design elements and the infrastructure graph; renders to a Mermaid `erDiagram`.
 */
export interface EntitySnapshot {
  entities: Entity[];
  relations: EntityRelation[];
}

/**
 * The project's Agent / MCP graph (pillar 8) — the agents the project defines and
 * the MCP servers they call. Standalone, like the infra + ER graphs; renders to a
 * Mermaid wiring diagram via `agentsToComponentMermaid`.
 */
export interface AgentSnapshot {
  agents: AgentNode[];
  servers: McpServerNode[];
}

/**
 * Whether the source's polling currently reaches the backend. A read-only or
 * offline-fixture source has no remote to lose, so it simply never reports
 * `"offline"` (the canvas treats the absence of `subscribeStatus` as online).
 */
export type ConnectionStatus = "online" | "offline";

export interface CanvasSource {
  /** Subscribe to all elements in the project; fires on every change. */
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void;
  /**
   * Subscribe to the source's connection health. Fires immediately with the
   * current status, then on every change — so the canvas can surface a
   * "reconnecting" state instead of silently freezing when polling fails.
   */
  subscribeStatus?(onChange: (status: ConnectionStatus) => void): () => void;
  /** Subscribe to the infrastructure graph; fires on every change. */
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void;
  /** Create or update an element (the editor persists geometry/style here). */
  saveElement(element: DesignElement): Promise<void>;
  /**
   * Attach/replace the element's API documentation AND append an immutable entry
   * to its version history — the explicit "Save documentation" action. Distinct
   * from `saveElement` (which silently upserts the binding with no history), this
   * is what populates the History timeline's API tab. Optional: read-only or
   * history-less sources omit it and the panel hides the button.
   */
  documentElement?(
    elementId: string,
    binding: ApiBinding,
    version: { version: string; changeLog: string; action: "created" | "modified" },
  ): Promise<void>;
  /** Remove an element. */
  deleteElement(elementId: string): Promise<void>;
  /** Create or update one infra node. */
  saveInfraNode?(node: InfraNode): Promise<void>;
  /** Remove one infra node along with any edges that referenced it. */
  deleteInfraNode?(nodeId: string): Promise<void>;
  /** Create or update one infra edge. */
  saveInfraEdge?(edge: InfraEdge): Promise<void>;
  /** Create or update one narrated flow (the UML sequence-diagram source). */
  saveInfraFlow?(flow: InfraFlow): Promise<void>;
  /** Remove one narrated flow (nodes/edges it walked are left intact). */
  deleteInfraFlow?(flowId: string): Promise<void>;
  /** Subscribe to the ER / data-model graph (pillar 3c); fires on every change. */
  subscribeEntities?(onChange: (snapshot: EntitySnapshot) => void): () => void;
  /** Create or update one entity. */
  saveEntity?(entity: Entity): Promise<void>;
  /** Remove one entity along with any relations that referenced it. */
  deleteEntity?(entityId: string): Promise<void>;
  /** Create or update one entity relation. */
  saveEntityRelation?(relation: EntityRelation): Promise<void>;
  /** Remove one entity relation (the entities it joined are left intact). */
  deleteEntityRelation?(relationId: string): Promise<void>;
  /** Subscribe to the Agent / MCP graph (pillar 8); fires on every change. */
  subscribeAgents?(onChange: (snapshot: AgentSnapshot) => void): () => void;
  /** Create or update one agent node. */
  saveAgentNode?(agent: AgentNode): Promise<void>;
  /** Remove one agent node (the servers it referenced are left intact). */
  deleteAgentNode?(agentId: string): Promise<void>;
  /** Create or update one MCP server node. */
  saveMcpServer?(server: McpServerNode): Promise<void>;
  /** Remove one MCP server, dropping it from any agent's `mcpServerIds`. */
  deleteMcpServer?(serverId: string): Promise<void>;
  /** Enrol another uid into the project's member roster (membership-gated hosts). */
  addMember?(uid: string, role?: ProjectRole): Promise<void>;
  /** The project's member roster (membership-gated hosts); drives the Member view. */
  listMembers?(): Promise<RosterMember[]>;
  /** Change a member's role. */
  updateMemberRole?(uid: string, role: ProjectRole): Promise<void>;
  /** Remove a member from the roster. */
  removeMember?(uid: string): Promise<void>;
  /** Subscribe to the project's tasks (pillar 4); fires on every change. */
  subscribeTasks?(onChange: (tasks: Task[]) => void): () => void;
  /** Create or update one task. */
  saveTask?(task: Task): Promise<void>;
  /** Remove one task. */
  deleteTask?(taskId: string): Promise<void>;
  /** Subscribe to the project's manual checkpoints (pillar 5); newest first. */
  subscribeCheckpoints?(onChange: (checkpoints: Checkpoint[]) => void): () => void;
  /**
   * Subscribe to the project's unified activity feed (design / api / infra / uml
   * events) behind the History timeline; fires on every change, newest first.
   */
  subscribeProjectTimeline?(
    onChange: (events: ProjectTimelineEvent[]) => void,
  ): () => void;
  /** Save a new checkpoint; the server freezes the current canvas into it. */
  createCheckpoint?(input: CheckpointInput): Promise<Checkpoint>;
  /** Rewind the project's design + infra to a checkpoint's snapshot. */
  restoreCheckpoint?(checkpointId: string): Promise<void>;
  /** Remove one checkpoint. */
  deleteCheckpoint?(checkpointId: string): Promise<void>;
}
