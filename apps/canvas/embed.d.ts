/**
 * Public types for `forward-canvas/embed`, hand-written so host apps (the VS
 * Code extension webview) get types without their tsc parsing the canvas app source — which
 * uses Vite-only imports (`*.css?inline`) and pulls in mermaid.
 *
 * Keep in sync with src/embed.ts. The runtime ("import" condition) resolves to
 * src/embed.ts; this file only backs the "types" condition.
 */
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
  ProjectTimelineEvent,
  Task,
  VersionEntry,
} from "forward-core";
import type { RealtimeResource } from "forward-core";
import type { Roster } from "forward-core/api";

export type TokenProvider = () => Promise<string | null | undefined>;

export interface ElementSnapshot {
  element: DesignElement;
  timeline: VersionEntry[];
}
export interface InfraSnapshot {
  nodes: InfraNode[];
  edges: InfraEdge[];
  flows: InfraFlow[];
}
export interface EntitySnapshot {
  entities: Entity[];
  relations: EntityRelation[];
}
export interface AgentSnapshot {
  agents: AgentNode[];
  servers: McpServerNode[];
}

/** Whether the source's polling currently reaches the backend. */
export type ConnectionStatus = "online" | "offline" | "auth";

/**
 * The data contract the canvas editor renders against. `ServerSource` is the
 * built-in implementation; a host (e.g. the VS Code extension) can implement
 * this itself — bridged over postMessage — to drive the editor without a direct
 * backend connection. Mirrors src/source.ts (kept in sync by hand).
 */
export interface CanvasSource {
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void;
  subscribeStatus?(onChange: (status: ConnectionStatus) => void): () => void;
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void;
  saveElement(element: DesignElement): Promise<void>;
  documentElement?(
    elementId: string,
    binding: ApiBinding,
    version: { version: string; changeLog: string; action: "created" | "modified" },
  ): Promise<void>;
  undocumentElement?(
    elementId: string,
    version: { version: string; changeLog: string; title?: string },
  ): Promise<void>;
  deleteElement(elementId: string): Promise<void>;
  saveInfraNode?(node: InfraNode): Promise<void>;
  deleteInfraNode?(nodeId: string): Promise<void>;
  saveInfraEdge?(edge: InfraEdge): Promise<void>;
  saveInfraFlow?(flow: InfraFlow): Promise<void>;
  deleteInfraFlow?(flowId: string): Promise<void>;
  subscribeEntities?(onChange: (snapshot: EntitySnapshot) => void): () => void;
  saveEntity?(entity: Entity): Promise<void>;
  deleteEntity?(entityId: string): Promise<void>;
  saveEntityRelation?(relation: EntityRelation): Promise<void>;
  deleteEntityRelation?(relationId: string): Promise<void>;
  subscribeAgents?(onChange: (snapshot: AgentSnapshot) => void): () => void;
  saveAgentNode?(agent: AgentNode): Promise<void>;
  deleteAgentNode?(agentId: string): Promise<void>;
  saveMcpServer?(server: McpServerNode): Promise<void>;
  deleteMcpServer?(serverId: string): Promise<void>;
  listMembers?(): Promise<Roster>;
  subscribeTasks?(onChange: (tasks: Task[]) => void): () => void;
  saveTask?(task: Task): Promise<void>;
  deleteTask?(taskId: string): Promise<void>;
  subscribeCheckpoints?(onChange: (checkpoints: Checkpoint[]) => void): () => void;
  subscribeProjectTimeline?(
    onChange: (events: ProjectTimelineEvent[]) => void,
  ): () => void;
  notifyChange?(resource: RealtimeResource): void;
  createCheckpoint?(input: CheckpointInput): Promise<Checkpoint>;
  restoreCheckpoint?(checkpointId: string): Promise<void>;
  deleteCheckpoint?(checkpointId: string): Promise<void>;
}

/** A CanvasSource backed by Forward's REST API (`forward serve`); the host
 * builds one with its token provider and hands it to mountCanvas. */
export declare class ServerSource implements CanvasSource {
  constructor(
    baseUrl: string,
    projectId: string,
    getToken: TokenProvider,
    pollMs?: number,
  );
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void;
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void;
  saveElement(element: DesignElement): Promise<void>;
  deleteElement(elementId: string): Promise<void>;
  /** Re-fetch one layer immediately (the poll loops remain the fallback). */
  notifyChange(resource: RealtimeResource): void;
}

/** A read-only CanvasSource over a project bundle written by `forward export`
 * (the GitHub Pages viewer). Mirrors src/static-source.ts. */
export declare class StaticSource implements CanvasSource {
  constructor(bundle: import("forward-core/repo").ProjectBundle);
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void;
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void;
  saveElement(element: DesignElement): Promise<DesignElement>;
  deleteElement(elementId: string): Promise<void>;
}

export interface MountOptions {
  /** Element to render the editor into; its Shadow DOM is created/reused. */
  container: HTMLElement;
  /** The data source — a ServerSource when embedded, or any CanvasSource. */
  source: CanvasSource;
  /** Element id to select + center once it loads (e.g. a docs deep link). */
  focusElementId?: string | null;
  /** Project id, used only to scope the local (per-project) view theme. */
  projectId?: string | null;
  /** Project name, shown as the middle breadcrumb segment (`forward / <name> / canvas`). */
  projectName?: string | null;
  /** Invoked by the in-canvas "Back to project" pill; the host navigates. The
   * pill is shown only when this is provided. */
  onBack?: () => void;
  /** Invoked when the "forward" crumb is clicked; the host navigates to the
   * project list. The crumb is a link only when this is provided. */
  onNavigateHome?: () => void;
  /** Invoked when the project-name crumb is clicked; the host navigates to the
   * project. The crumb is a link only when this is provided. */
  onNavigateProject?: () => void;
}

/** The task tracker's layout: a list, or the timeline (Gantt). */
export type TasksMode = "list" | "timeline";

/** Handle from mountCanvas; `destroy` stops polling and removes global listeners. */
export interface CanvasHandle {
  destroy: () => void;
  /** Open the task tracker in `mode` — a host's "show the task timeline"
   * command. A no-op when the source can't list tasks. */
  showTasks: (mode: TasksMode) => void;
}

export declare function mountCanvas(opts: MountOptions): CanvasHandle;
