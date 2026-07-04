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
  RealtimeResource,
  Task,
} from "forward-core";
import * as api from "forward-core/api";
import type {
  AgentSnapshot,
  CanvasSource,
  ConnectionStatus,
  ElementSnapshot,
  EntitySnapshot,
  InfraSnapshot,
} from "./source.js";

/** Resolves a fresh auth token for each request. Returns null/undefined when the
 * caller isn't signed in. Embedded in the dashboard this is Clerk's `getToken`;
 * standalone it's a constant wrapped in a promise. */
export type TokenProvider = () => Promise<string | null | undefined>;

/** Split a heartbeat failure into "can't reach the backend" vs "the backend
 * rejects us". `forward-core/api` throws plain Errors ending in the HTTP status
 * (`… failed: 401`), and `cfg()` throws "Not signed in …" when the token
 * provider comes back empty — both mean retrying alone won't recover, so the
 * canvas should say "sign in again" instead of "reconnecting". */
function classifyPollError(err: unknown): ConnectionStatus {
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed: 40[13]$/.test(msg) || msg.includes("Not signed in")) return "auth";
  return "offline";
}

/**
 * A CanvasSource backed by the Forward backend (`apps/server`) over its REST API
 * — the same contract the dashboard, extension and MCP speak via `forward-core/api`.
 * This is the migration target: it lets the canvas resolve the *same* elements
 * (by the same project id and element ids) that the dashboard documents, so the
 * canvas can be embedded as a dashboard route or deep-linked to an element.
 *
 * A token is resolved *per request* (`TokenProvider`) rather than captured once,
 * because tokens are short-lived (~60s) and an embedded canvas outlives any single
 * token.
 *
 * Freshness comes from two cooperating paths:
 *   - push: the host subscribes to the project's realtime channel and calls
 *     {@link notifyChange} per ChangeEvent, which re-runs the affected loop's
 *     fetch immediately; and
 *   - poll: every loop still ticks on `pollMs` as the reconciliation fallback
 *     (missed broadcast, realtime not configured). Hosts with realtime attached
 *     should pass a long `pollMs` — the push path carries the latency.
 * Either way a loop only emits when the data actually changed, to avoid
 * clobbering an in-progress edit.
 */
export class ServerSource implements CanvasSource {
  private timer: ReturnType<typeof setInterval> | undefined;
  private infraTimer: ReturnType<typeof setInterval> | undefined;
  private entityTimer: ReturnType<typeof setInterval> | undefined;
  private agentTimer: ReturnType<typeof setInterval> | undefined;
  private taskTimer: ReturnType<typeof setInterval> | undefined;
  private checkpointTimer: ReturnType<typeof setInterval> | undefined;
  private lastJson = "";
  private lastInfraJson = "";
  private lastEntityJson = "";
  private lastAgentJson = "";
  private lastTasksJson = "";
  private lastCheckpointsJson = "";
  private timelineTimer: ReturnType<typeof setInterval> | undefined;
  private lastTimelineJson = "";
  /** Connection health, driven by the primary (elements) poll loop. Optimistic
   * until the first failure so the indicator doesn't flicker on mount. */
  private status: ConnectionStatus = "online";
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  /** Live fetch loops by the realtime resource(s) they cover, so a pushed
   * ChangeEvent can re-run exactly the affected loop (see notifyChange). */
  private readonly loops = new Map<RealtimeResource, Set<() => void>>();

  constructor(
    private readonly baseUrl: string,
    private readonly projectId: string,
    private readonly getToken: TokenProvider,
    private readonly pollMs = 2000,
  ) {}

  /**
   * Wrap a poll tick so overlapping runs are skipped. With 7 poll loops per
   * canvas, firing a new request while the previous one is still in flight
   * stacks concurrent requests whenever the server is slower than pollMs —
   * a feedback loop that exhausted the server's DB pool on 2026-07-02.
   */
  private static guarded(tick: () => Promise<void>): () => void {
    let inFlight = false;
    return () => {
      if (inFlight) return;
      inFlight = true;
      void tick().finally(() => {
        inFlight = false;
      });
    };
  }

  /** Build a fresh ApiConfig with a current token for one request. */
  private async cfg(): Promise<api.ApiConfig> {
    const token = await this.getToken();
    if (!token) throw new Error("Not signed in (no token for the canvas).");
    return { baseUrl: this.baseUrl, projectId: this.projectId, token };
  }

  /** The elements loop is the connection heartbeat: it always runs, so its
   * success/failure is the single source of truth for the status indicator.
   * Other poll loops stay quiet on error to avoid the indicator flapping. */
  private setStatus(next: ConnectionStatus): void {
    if (next === this.status) return;
    this.status = next;
    for (const fn of this.statusListeners) fn(next);
  }

  subscribeStatus(onChange: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(onChange);
    onChange(this.status); // emit current state immediately
    return () => {
      this.statusListeners.delete(onChange);
    };
  }

  /**
   * Push path: the host received a ChangeEvent on the project's realtime
   * channel — re-run the affected loop's fetch immediately instead of waiting
   * for its next poll tick. Unknown/uncovered resources are a no-op. The ticks
   * are `guarded`, so a burst of events while a fetch is in flight collapses.
   */
  notifyChange(resource: RealtimeResource): void {
    for (const run of this.loops.get(resource) ?? []) run();
  }

  /** Register a loop's tick under the realtime resources it refreshes. */
  private register(resources: RealtimeResource[], run: () => void): () => void {
    for (const r of resources) {
      const set = this.loops.get(r) ?? new Set<() => void>();
      set.add(run);
      this.loops.set(r, set);
    }
    return () => {
      for (const r of resources) this.loops.get(r)?.delete(run);
    };
  }

  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void {
    const tick = async () => {
      try {
        const snapshots = await this.fetchAll();
        this.setStatus("online");
        const json = JSON.stringify(snapshots);
        if (json !== this.lastJson) {
          this.lastJson = json;
          onChange(snapshots);
        }
      } catch (err) {
        this.setStatus(classifyPollError(err));
        console.warn("[server-source] poll failed:", err);
      }
    };
    const run = ServerSource.guarded(tick);
    run();
    this.timer = setInterval(run, this.pollMs);
    const deregister = this.register(["elements", "timeline"], run);
    return () => {
      if (this.timer) clearInterval(this.timer);
      deregister();
    };
  }

  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void {
    const tick = async () => {
      try {
        const infra = await this.fetchInfra();
        const json = JSON.stringify(infra);
        if (json !== this.lastInfraJson) {
          this.lastInfraJson = json;
          onChange(infra);
        }
      } catch (err) {
        console.warn("[server-source] infra poll failed:", err);
      }
    };
    const run = ServerSource.guarded(tick);
    run();
    this.infraTimer = setInterval(run, this.pollMs);
    const deregister = this.register(["infra", "flows"], run);
    return () => {
      if (this.infraTimer) clearInterval(this.infraTimer);
      deregister();
    };
  }

  subscribeEntities(onChange: (snapshot: EntitySnapshot) => void): () => void {
    const tick = async () => {
      try {
        const snapshot = await api.fetchEntities(await this.cfg());
        const json = JSON.stringify(snapshot);
        if (json !== this.lastEntityJson) {
          this.lastEntityJson = json;
          onChange(snapshot);
        }
      } catch (err) {
        console.warn("[server-source] entities poll failed:", err);
      }
    };
    const run = ServerSource.guarded(tick);
    run();
    this.entityTimer = setInterval(run, this.pollMs);
    const deregister = this.register(["entities"], run);
    return () => {
      if (this.entityTimer) clearInterval(this.entityTimer);
      deregister();
    };
  }

  subscribeAgents(onChange: (snapshot: AgentSnapshot) => void): () => void {
    const tick = async () => {
      try {
        const snapshot = await api.fetchAgents(await this.cfg());
        const json = JSON.stringify(snapshot);
        if (json !== this.lastAgentJson) {
          this.lastAgentJson = json;
          onChange(snapshot);
        }
      } catch (err) {
        console.warn("[server-source] agents poll failed:", err);
      }
    };
    const run = ServerSource.guarded(tick);
    run();
    this.agentTimer = setInterval(run, this.pollMs);
    const deregister = this.register(["agents"], run);
    return () => {
      if (this.agentTimer) clearInterval(this.agentTimer);
      deregister();
    };
  }

  subscribeTasks(onChange: (tasks: Task[]) => void): () => void {
    const tick = async () => {
      try {
        const tasks = await api.fetchTasks(await this.cfg());
        const json = JSON.stringify(tasks);
        if (json !== this.lastTasksJson) {
          this.lastTasksJson = json;
          onChange(tasks);
        }
      } catch (err) {
        console.warn("[server-source] tasks poll failed:", err);
      }
    };
    const run = ServerSource.guarded(tick);
    run();
    this.taskTimer = setInterval(run, this.pollMs);
    const deregister = this.register(["tasks"], run);
    return () => {
      if (this.taskTimer) clearInterval(this.taskTimer);
      deregister();
    };
  }

  subscribeCheckpoints(
    onChange: (checkpoints: Checkpoint[]) => void,
  ): () => void {
    const tick = async () => {
      try {
        const checkpoints = await api.fetchCheckpoints(await this.cfg());
        const json = JSON.stringify(checkpoints);
        if (json !== this.lastCheckpointsJson) {
          this.lastCheckpointsJson = json;
          onChange(checkpoints);
        }
      } catch (err) {
        console.warn("[server-source] checkpoints poll failed:", err);
      }
    };
    const run = ServerSource.guarded(tick);
    run();
    this.checkpointTimer = setInterval(run, this.pollMs);
    const deregister = this.register(["checkpoints"], run);
    return () => {
      if (this.checkpointTimer) clearInterval(this.checkpointTimer);
      deregister();
    };
  }

  subscribeProjectTimeline(
    onChange: (events: ProjectTimelineEvent[]) => void,
  ): () => void {
    const tick = async () => {
      try {
        const events = await api.fetchProjectTimeline(await this.cfg());
        const json = JSON.stringify(events);
        if (json !== this.lastTimelineJson) {
          this.lastTimelineJson = json;
          onChange(events);
        }
      } catch (err) {
        console.warn("[server-source] timeline poll failed:", err);
      }
    };
    const run = ServerSource.guarded(tick);
    run();
    this.timelineTimer = setInterval(run, this.pollMs);
    const deregister = this.register(["timeline"], run);
    return () => {
      if (this.timelineTimer) clearInterval(this.timelineTimer);
      deregister();
    };
  }

  async createCheckpoint(input: CheckpointInput): Promise<Checkpoint> {
    return api.createCheckpoint(await this.cfg(), input);
  }

  async restoreCheckpoint(checkpointId: string): Promise<void> {
    await api.restoreCheckpoint(await this.cfg(), checkpointId);
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    await api.deleteCheckpoint(await this.cfg(), checkpointId);
  }

  private async fetchAll(): Promise<ElementSnapshot[]> {
    const cfg = await this.cfg();
    const [elements, { timelines }] = await Promise.all([
      api.fetchElements(cfg),
      api.fetchTimelinesConditional(cfg, undefined),
    ]);
    return elements.map((element) => ({
      element,
      timeline: timelines[element.id] ?? [],
    }));
  }

  private async fetchInfra(): Promise<InfraSnapshot> {
    const cfg = await this.cfg();
    const [{ nodes, edges }, flows] = await Promise.all([
      api.fetchInfra(cfg),
      api.fetchFlows(cfg),
    ]);
    return { nodes, edges, flows };
  }

  async saveElement(element: DesignElement): Promise<DesignElement> {
    return api.saveElement(await this.cfg(), element);
  }

  async documentElement(
    elementId: string,
    binding: ApiBinding,
    version: { version: string; changeLog: string; action: "created" | "modified" },
  ): Promise<void> {
    // The server stamps author + timestamp and derives the endpoint snapshot, so
    // only the label/log/action travel; author here is a placeholder it ignores.
    await api.bindApiToElement(await this.cfg(), elementId, binding, {
      version: version.version,
      changeLog: version.changeLog,
      action: version.action,
      author: "canvas",
    });
  }

  async deleteElement(elementId: string): Promise<void> {
    await api.deleteElement(await this.cfg(), elementId);
  }

  async saveInfraNode(node: InfraNode): Promise<void> {
    await api.saveInfraNode(await this.cfg(), node);
  }

  async deleteInfraNode(nodeId: string): Promise<void> {
    await api.deleteInfraNode(await this.cfg(), nodeId);
  }

  async saveInfraEdge(edge: InfraEdge): Promise<void> {
    await api.saveInfraEdge(await this.cfg(), edge);
  }

  async saveInfraFlow(flow: InfraFlow): Promise<void> {
    await api.saveInfraFlow(await this.cfg(), flow);
  }

  async deleteInfraFlow(flowId: string): Promise<void> {
    await api.deleteInfraFlow(await this.cfg(), flowId);
  }

  async saveEntity(entity: Entity): Promise<void> {
    await api.saveEntity(await this.cfg(), entity);
  }

  async deleteEntity(entityId: string): Promise<void> {
    await api.deleteEntity(await this.cfg(), entityId);
  }

  async saveEntityRelation(relation: EntityRelation): Promise<void> {
    await api.saveEntityRelation(await this.cfg(), relation);
  }

  async saveAgentNode(agent: AgentNode): Promise<void> {
    await api.saveAgentNode(await this.cfg(), agent);
  }

  async deleteAgentNode(agentId: string): Promise<void> {
    await api.deleteAgentNode(await this.cfg(), agentId);
  }

  async saveMcpServer(server: McpServerNode): Promise<void> {
    await api.saveMcpServer(await this.cfg(), server);
  }

  async deleteMcpServer(serverId: string): Promise<void> {
    await api.deleteMcpServer(await this.cfg(), serverId);
  }

  async deleteEntityRelation(relationId: string): Promise<void> {
    await api.deleteEntityRelation(await this.cfg(), relationId);
  }

  async saveTask(task: Task): Promise<void> {
    await api.saveTask(await this.cfg(), task);
  }

  async deleteTask(taskId: string): Promise<void> {
    await api.deleteTask(await this.cfg(), taskId);
  }

  async addMember(uid: string, role: ProjectRole = "editor"): Promise<void> {
    await api.addMember(await this.cfg(), uid, role);
  }

  async listMembers(): Promise<api.RosterMember[]> {
    return api.listMembers(await this.cfg());
  }

  async updateMemberRole(uid: string, role: ProjectRole): Promise<void> {
    await api.updateMemberRole(await this.cfg(), uid, role);
  }

  async removeMember(uid: string): Promise<void> {
    await api.removeMember(await this.cfg(), uid);
  }
}
