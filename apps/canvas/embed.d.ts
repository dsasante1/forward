/**
 * Public types for `forward-canvas/embed`, hand-written so host apps (the
 * dashboard) get types without their tsc parsing the canvas app source — which
 * uses Vite-only imports (`*.css?inline`) and pulls in mermaid/firebase.
 *
 * Keep in sync with src/embed.ts. The runtime ("import" condition) resolves to
 * src/embed.ts; this file only backs the "types" condition.
 */
import type {
  Checkpoint,
  CheckpointInput,
  DesignElement,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  ProjectRole,
  ProjectTimelineEvent,
  Task,
  VersionEntry,
} from "forward-core";
import type { RosterMember } from "forward-core/api";

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

/**
 * The data contract the canvas editor renders against. `ServerSource` is the
 * built-in implementation; a host (e.g. the VS Code extension) can implement
 * this itself — bridged over postMessage — to drive the editor without a direct
 * backend connection. Mirrors src/source.ts (kept in sync by hand).
 */
export interface CanvasSource {
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void;
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void;
  saveElement(element: DesignElement): Promise<void>;
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
  addMember?(uid: string, role?: ProjectRole): Promise<void>;
  listMembers?(): Promise<RosterMember[]>;
  updateMemberRole?(uid: string, role: ProjectRole): Promise<void>;
  removeMember?(uid: string): Promise<void>;
  subscribeTasks?(onChange: (tasks: Task[]) => void): () => void;
  saveTask?(task: Task): Promise<void>;
  deleteTask?(taskId: string): Promise<void>;
  subscribeCheckpoints?(onChange: (checkpoints: Checkpoint[]) => void): () => void;
  subscribeProjectTimeline?(
    onChange: (events: ProjectTimelineEvent[]) => void,
  ): () => void;
  createCheckpoint?(input: CheckpointInput): Promise<Checkpoint>;
  restoreCheckpoint?(checkpointId: string): Promise<void>;
  deleteCheckpoint?(checkpointId: string): Promise<void>;
}

/** A CanvasSource backed by the Forward backend REST API; the host builds one
 * with its own token provider and hands it to mountCanvas. */
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
}

/** Handle from mountCanvas; `destroy` stops polling and removes global listeners. */
export interface CanvasHandle {
  destroy: () => void;
}

export declare function mountCanvas(opts: MountOptions): CanvasHandle;
