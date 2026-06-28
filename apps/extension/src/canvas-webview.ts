import {
  type CanvasHandle,
  type CanvasSource,
  type ElementSnapshot,
  type EntitySnapshot,
  type InfraSnapshot,
  mountCanvas,
} from "forward-canvas/embed";
import type {
  ApiBinding,
  Checkpoint,
  CheckpointInput,
  DesignElement,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  ProjectTimelineEvent,
  Task,
} from "forward-core";

/**
 * The VS Code canvas webview. Rather than re-implement the editor, this mounts
 * the *real* `forward-canvas` library — so the toolbar (Layers / Data / UML /
 * Tasks / Infra / checkpoints) and every authoring affordance are identical to
 * the dashboard's canvas, and stay in sync automatically.
 *
 * The canvas drives a `CanvasSource`; here that source is a thin RPC bridge over
 * `postMessage`. The extension host runs the actual backend client (a
 * `ServerSource`) and answers the bridge's subscription + mutation calls, so the
 * access token never enters the webview and the CSP can forbid direct network
 * access. Reads flow host → webview as `snap` messages; writes flow webview →
 * host as `rpc` calls that resolve a Promise when the host replies.
 */

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface RpcResult {
  kind: "rpc-result";
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}
interface Snapshot {
  kind: "snap";
  channel: string;
  data: unknown;
}
type HostMessage = RpcResult | Snapshot;

interface FwdConfig {
  projectId: string | null;
  projectName: string | null;
}
declare global {
  interface Window {
    __FORWARD_CONFIG__?: FwdConfig;
  }
}

let rpcSeq = 0;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
const channels = new Map<string, (data: unknown) => void>();

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as HostMessage;
  if (msg?.kind === "rpc-result") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new Error(msg.error ?? "Request failed"));
  } else if (msg?.kind === "snap") {
    channels.get(msg.channel)?.(msg.data);
  }
});

/** Invoke a host-side mutation and await its result. */
function rpc<T>(method: string, args: unknown[]): Promise<T> {
  const id = ++rpcSeq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    vscode.postMessage({ kind: "rpc", id, method, args });
  });
}

/** Open a subscription channel; the host streams `snap` messages onto it. */
function sub<T>(channel: string, onChange: (data: T) => void): () => void {
  channels.set(channel, onChange as (data: unknown) => void);
  vscode.postMessage({ kind: "sub", channel });
  return () => {
    channels.delete(channel);
    vscode.postMessage({ kind: "unsub", channel });
  };
}

/** A CanvasSource that proxies every call to the extension host over postMessage. */
class BridgeSource implements CanvasSource {
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void {
    return sub("elements", onChange);
  }
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void {
    return sub("infra", onChange);
  }
  subscribeEntities(onChange: (snapshot: EntitySnapshot) => void): () => void {
    return sub("entities", onChange);
  }
  subscribeTasks(onChange: (tasks: Task[]) => void): () => void {
    return sub("tasks", onChange);
  }
  subscribeCheckpoints(onChange: (checkpoints: Checkpoint[]) => void): () => void {
    return sub("checkpoints", onChange);
  }
  subscribeProjectTimeline(
    onChange: (events: ProjectTimelineEvent[]) => void,
  ): () => void {
    return sub("timeline", onChange);
  }
  saveElement(element: DesignElement): Promise<void> {
    return rpc("saveElement", [element]);
  }
  documentElement(
    elementId: string,
    binding: ApiBinding,
    version: { version: string; changeLog: string; action: "created" | "modified" },
  ): Promise<void> {
    return rpc("documentElement", [elementId, binding, version]);
  }
  deleteElement(elementId: string): Promise<void> {
    return rpc("deleteElement", [elementId]);
  }
  saveInfraNode(node: InfraNode): Promise<void> {
    return rpc("saveInfraNode", [node]);
  }
  deleteInfraNode(nodeId: string): Promise<void> {
    return rpc("deleteInfraNode", [nodeId]);
  }
  saveInfraEdge(edge: InfraEdge): Promise<void> {
    return rpc("saveInfraEdge", [edge]);
  }
  saveInfraFlow(flow: InfraFlow): Promise<void> {
    return rpc("saveInfraFlow", [flow]);
  }
  deleteInfraFlow(flowId: string): Promise<void> {
    return rpc("deleteInfraFlow", [flowId]);
  }
  saveEntity(entity: Entity): Promise<void> {
    return rpc("saveEntity", [entity]);
  }
  deleteEntity(entityId: string): Promise<void> {
    return rpc("deleteEntity", [entityId]);
  }
  saveEntityRelation(relation: EntityRelation): Promise<void> {
    return rpc("saveEntityRelation", [relation]);
  }
  deleteEntityRelation(relationId: string): Promise<void> {
    return rpc("deleteEntityRelation", [relationId]);
  }
  saveTask(task: Task): Promise<void> {
    return rpc("saveTask", [task]);
  }
  deleteTask(taskId: string): Promise<void> {
    return rpc("deleteTask", [taskId]);
  }
  createCheckpoint(input: CheckpointInput): Promise<Checkpoint> {
    return rpc("createCheckpoint", [input]);
  }
  restoreCheckpoint(checkpointId: string): Promise<void> {
    return rpc("restoreCheckpoint", [checkpointId]);
  }
  deleteCheckpoint(checkpointId: string): Promise<void> {
    return rpc("deleteCheckpoint", [checkpointId]);
  }
}

const config = window.__FORWARD_CONFIG__ ?? { projectId: null, projectName: null };
const container = document.getElementById("app") as HTMLElement;

let handle: CanvasHandle | undefined;
try {
  handle = mountCanvas({
    container,
    source: new BridgeSource(),
    projectId: config.projectId,
    projectName: config.projectName,
  });
} catch (err) {
  container.textContent = `Failed to mount the canvas: ${(err as Error).message}`;
}

window.addEventListener("unload", () => handle?.destroy());
