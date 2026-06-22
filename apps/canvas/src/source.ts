import type {
  Checkpoint,
  CheckpointInput,
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraNode,
  Task,
  VersionEntry,
} from "forward-core";

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

export interface CanvasSource {
  /** Subscribe to all elements in the project; fires on every change. */
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void;
  /** Subscribe to the infrastructure graph; fires on every change. */
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void;
  /** Create or update an element (the editor persists geometry/style here). */
  saveElement(element: DesignElement): Promise<void>;
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
  /** Enrol another uid into the project's member roster (membership-gated hosts). */
  addMember?(uid: string): Promise<void>;
  /** Subscribe to the project's tasks (pillar 4); fires on every change. */
  subscribeTasks?(onChange: (tasks: Task[]) => void): () => void;
  /** Create or update one task. */
  saveTask?(task: Task): Promise<void>;
  /** Remove one task. */
  deleteTask?(taskId: string): Promise<void>;
  /** Subscribe to the project's manual checkpoints (pillar 5); newest first. */
  subscribeCheckpoints?(onChange: (checkpoints: Checkpoint[]) => void): () => void;
  /** Save a new checkpoint; the server freezes the current canvas into it. */
  createCheckpoint?(input: CheckpointInput): Promise<Checkpoint>;
  /** Rewind the project's design + infra to a checkpoint's snapshot. */
  restoreCheckpoint?(checkpointId: string): Promise<void>;
  /** Remove one checkpoint. */
  deleteCheckpoint?(checkpointId: string): Promise<void>;
}
