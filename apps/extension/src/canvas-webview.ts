import {
  type AgentSnapshot,
  type CanvasHandle,
  type CanvasSource,
  type ElementSnapshot,
  type EntitySnapshot,
  type InfraSnapshot,
  type TasksMode,
  mountCanvas,
} from "forward-canvas/embed";
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
} from "forward-core";
import type { Roster } from "forward-core/api";

/**
 * The VS Code canvas webview. Rather than re-implement the editor, this mounts
 * the *real* `forward-canvas` library — so the toolbar (Layers / Data / Flows /
 * Tasks / Infra / checkpoints) and every authoring affordance are identical to
 * the canvas `forward serve` opens, and stay in sync automatically.
 *
 * The canvas drives a `CanvasSource`; here that source is a thin RPC bridge over
 * `postMessage`. The extension host reads and writes the workspace's `.forward/`
 * files and answers the bridge's subscription + mutation calls, so the webview
 * needs no file or network access and the CSP can forbid it. Reads flow host →
 * webview as `snap` messages; writes flow webview → host as `rpc` calls that
 * resolve a Promise when the host replies. The host's "show task timeline"
 * command arrives as a `show-tasks` message.
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
interface ShowTasks {
  kind: "show-tasks";
  mode: TasksMode;
}
type HostMessage = RpcResult | Snapshot | ShowTasks;

interface FwdConfig {
  projectId: string | null;
  projectName: string | null;
  /** Open on the task tracker in this layout (the "show task timeline" command). */
  tasksMode?: TasksMode | null;
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
  } else if (msg?.kind === "show-tasks") {
    handle?.showTasks(msg.mode);
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
  subscribeAgents(onChange: (snapshot: AgentSnapshot) => void): () => void {
    return sub("agents", onChange);
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
  undocumentElement(
    elementId: string,
    version: { version: string; changeLog: string; title?: string },
  ): Promise<void> {
    return rpc("undocumentElement", [elementId, version]);
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
  saveAgentNode(agent: AgentNode): Promise<void> {
    return rpc("saveAgentNode", [agent]);
  }
  deleteAgentNode(agentId: string): Promise<void> {
    return rpc("deleteAgentNode", [agentId]);
  }
  saveMcpServer(server: McpServerNode): Promise<void> {
    return rpc("saveMcpServer", [server]);
  }
  deleteMcpServer(serverId: string): Promise<void> {
    return rpc("deleteMcpServer", [serverId]);
  }
  listMembers(): Promise<Roster> {
    return rpc("listMembers", []);
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
  if (config.tasksMode) handle.showTasks(config.tasksMode);
} catch (err) {
  container.textContent = `Failed to mount the canvas: ${(err as Error).message}`;
}

window.addEventListener("unload", () => handle?.destroy());
