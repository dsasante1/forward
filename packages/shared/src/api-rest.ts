import type { ImportDesignReport, ImportDesignRequest } from "./design-import.js";
import {
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
  type SaveableElement,
  Task,
  VersionEntry,
} from "./schema.js";

/**
 * What a caller supplies for a version-history entry. `timestamp` is stamped by
 * the server; `action` and the endpoint snapshot are optional here — the schema
 * defaults `action` and `bindApiToElement` derives the snapshot from the binding
 * — but a caller that knows (created vs modified, or a deletion) should pass them.
 */
export type VersionInput = Omit<VersionEntry, "timestamp" | "action" | "endpoint"> &
  Partial<Pick<VersionEntry, "action" | "endpoint">> & {
    /**
     * Flag this change as breaking; merged onto the auto-computed `diff` so a
     * caller can warn clients without having to build the whole diff itself.
     * Ignored when the caller supplies a full `diff` (which carries its own).
     */
    breaking?: string;
  };

/** Per-element version histories for a whole project, keyed by element id. */
export type ProjectTimelines = Record<string, VersionEntry[]>;

/** ETags + last-parsed graph the infra poller carries between ticks. */
export interface InfraPollState {
  nodeEtag?: string;
  edgeEtag?: string;
  flowEtag?: string;
  nodes: InfraNode[];
  edges: InfraEdge[];
  flows: InfraFlow[];
}

/** ETags + last-parsed model the entity poller carries between ticks. */
export interface EntityPollState {
  entityEtag?: string;
  relationEtag?: string;
  entities: Entity[];
  relations: EntityRelation[];
}

/**
 * The Forward API client used by every surface (canvas, VS Code extension, MCP
 * server, CLI, docs CI). Build an `ApiConfig` and call the exported functions.
 *
 *   - With a `transport` (the usual case: `repoConfig()` from
 *     `forward-core/repo`), calls are served in-process from the `.forward/`
 *     directory of a git repository.
 *   - Without one, calls go over HTTP to `baseUrl` — the local server that
 *     `forward serve` runs for the canvas — with `token` as a `Bearer` header.
 *
 * Either way the backend owns identity + timestamps, so an `author` a caller
 * passes is ignored.
 */
export interface ApiConfig {
  /** Base URL of a `forward serve` instance, e.g. http://127.0.0.1:4747 (unused with a transport). */
  baseUrl: string;
  /** The project (tenancy) id this client operates within. */
  projectId: string;
  /** The `forward serve` session token (sent as `Authorization: Bearer`). */
  token: string;
  /**
   * Optional in-process transport. When set, every project-scoped request is
   * handed to it instead of `fetch` — this is how repo mode works: the
   * `forward-core/repo` transport serves the same routes from the `.forward/`
   * directory in a git repository, so the MCP server, extension and CLI run
   * unchanged against files with no server, no token and no network.
   */
  transport?: ApiTransport;
}

/** One project-scoped request, as the REST client would send it. */
export interface ApiRequest {
  method: string;
  /** Path below `/projects/:projectId`, including any query string. */
  path: string;
  body?: unknown;
}

/** What a transport hands back: an HTTP-like status and a parsed JSON body. */
export interface ApiResponse {
  status: number;
  body?: unknown;
}

/** Serves project-scoped requests without HTTP (see {@link ApiConfig.transport}). */
export type ApiTransport = (req: ApiRequest) => Promise<ApiResponse>;

// --------------------------------------------------------------------------
// low-level request helpers
// --------------------------------------------------------------------------

function base(cfg: ApiConfig): string {
  return `${cfg.baseUrl.replace(/\/$/, "")}/projects/${encodeURIComponent(cfg.projectId)}`;
}

async function request<T>(
  cfg: ApiConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (cfg.transport) {
    const res = await cfg.transport({ method, path, body });
    if (res.status >= 400) {
      const msg = (res.body as { message?: unknown } | undefined)?.message;
      throw new Error(
        typeof msg === "string" && msg
          ? msg
          : `Forward API ${method} ${path} failed: ${res.status}`,
      );
    }
    return res.body as T;
  }
  const res = await fetch(`${base(cfg)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, `${method} ${path}`));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

/**
 * Build an error message from a failed response, preferring the server's typed
 * `message` (e.g. "Cannot demote the last owner of a project", "Read-only
 * access…") over a bare status — those messages are actionable and meant for the
 * user. Falls back to the status when there is no usable body.
 */
async function errorMessage(res: Response, ctx: string): Promise<string> {
  try {
    const text = await res.text();
    if (text) {
      const body = JSON.parse(text) as { message?: string | string[] };
      const msg = Array.isArray(body.message)
        ? body.message.join(", ")
        : body.message;
      if (msg) return msg;
    }
  } catch {
    // Non-JSON or unreadable body — fall through to the status.
  }
  return `Forward API ${ctx} failed: ${res.status}`;
}

const get = <T>(cfg: ApiConfig, path: string) => request<T>(cfg, "GET", path);

// --------------------------------------------------------------------------
// design elements + API binding + timeline
// --------------------------------------------------------------------------

export async function listElements(
  cfg: ApiConfig,
): Promise<Array<{ id: string; name: string; type: string }>> {
  const els = await fetchElements(cfg);
  return els.map((el) => ({ id: el.id, name: el.name ?? "", type: el.type }));
}

export async function fetchElements(cfg: ApiConfig): Promise<DesignElement[]> {
  const raw = await get<unknown[]>(cfg, "/elements");
  return parseAll(raw, DesignElement);
}

/** Upsert an element's geometry/style — NOT its `apiBinding` (the server owns
 * that via bind()/unbind(); the `SaveableElement` param makes sending one a
 * compile error). Returns the server's persisted copy, whose server-owned fields
 * (`updatedAt`, and `author` where applicable) supersede the values the client
 * sent — the caller should adopt it as authoritative. */
export async function saveElement(
  cfg: ApiConfig,
  element: SaveableElement,
): Promise<DesignElement> {
  return request<DesignElement>(
    cfg,
    "PUT",
    `/elements/${encodeURIComponent(element.id)}`,
    element,
  );
}

/**
 * Write elements generated from frontend code in one call (see
 * design-import.ts and `RepoStore.importDesign`). The backend decides per
 * element whether to create, update, skip (hand-drawn or adopted) or report a
 * conflict (edited since the last import); `dryRun` only reports.
 */
export async function importDesign(
  cfg: ApiConfig,
  request_: ImportDesignRequest,
): Promise<ImportDesignReport> {
  return request<ImportDesignReport>(cfg, "POST", "/elements/import", request_);
}

export async function patchElement(
  cfg: ApiConfig,
  elementId: string,
  patch: Partial<Omit<DesignElement, "id">>,
): Promise<DesignElement> {
  return request<DesignElement>(
    cfg,
    "PATCH",
    `/elements/${encodeURIComponent(elementId)}`,
    patch,
  );
}

export async function deleteElement(
  cfg: ApiConfig,
  elementId: string,
  opts: { cascade?: boolean } = {},
): Promise<string[]> {
  const cascade = opts.cascade ?? true;
  const res = await request<{ deleted: string[] }>(
    cfg,
    "DELETE",
    `/elements/${encodeURIComponent(elementId)}?cascade=${cascade}`,
  );
  return res?.deleted ?? [elementId];
}

/**
 * Attach/replace the API documentation and append a version entry. The server
 * stamps `author` + `timestamp` and derives the endpoint snapshot, so only the
 * version label, change log and action travel from the client.
 */
export async function bindApiToElement(
  cfg: ApiConfig,
  elementId: string,
  payload: ApiBinding,
  version: VersionInput,
): Promise<void> {
  await request(cfg, "PUT", `/elements/${encodeURIComponent(elementId)}/binding`, {
    binding: ApiBinding.parse(payload),
    version: version.version,
    changeLog: version.changeLog ?? "",
    action: version.action ?? "modified",
  });
}

/** Remove the API documentation and append a "deleted" version entry. */
export async function unbindApiFromElement(
  cfg: ApiConfig,
  elementId: string,
  version: VersionInput,
): Promise<void> {
  await request(
    cfg,
    "DELETE",
    `/elements/${encodeURIComponent(elementId)}/binding`,
    {
      version: version.version,
      changeLog: version.changeLog ?? "Removed API documentation",
      ...(version.endpoint?.title ? { title: version.endpoint.title } : {}),
    },
  );
}

// --------------------------------------------------------------------------
// contributor roster (read-only: derived from git history in repo mode)
// --------------------------------------------------------------------------

export interface RosterMember {
  uid: string;
  email: string | null;
  /** Display name (the git author name). */
  name: string | null;
  /** Avatar URL, when known. */
  imageUrl: string | null;
  role: ProjectRole;
  addedAt: string;
}

export async function listMembers(cfg: ApiConfig): Promise<RosterMember[]> {
  const rows = await get<
    Array<{
      userId: string;
      email: string | null;
      name?: string | null;
      imageUrl?: string | null;
      role: ProjectRole;
      addedAt: string;
    }>
  >(cfg, "/members");
  return (rows ?? []).map((m) => ({
    uid: m.userId,
    email: m.email ?? null,
    name: m.name ?? null,
    imageUrl: m.imageUrl ?? null,
    role: m.role,
    addedAt: m.addedAt,
  }));
}

// --------------------------------------------------------------------------
// infrastructure graph + flows
// --------------------------------------------------------------------------

interface InfraResponse {
  nodes: unknown[];
  edges: unknown[];
  flows: unknown[];
  entities: unknown[];
  relations: unknown[];
}

export async function fetchInfra(
  cfg: ApiConfig,
): Promise<{ nodes: InfraNode[]; edges: InfraEdge[] }> {
  const body = await get<InfraResponse>(cfg, "/infra");
  return {
    nodes: parseAll(body?.nodes ?? [], InfraNode),
    edges: parseAll(body?.edges ?? [], InfraEdge),
  };
}

export async function fetchFlows(cfg: ApiConfig): Promise<InfraFlow[]> {
  const body = await get<InfraResponse>(cfg, "/infra");
  return parseAll(body?.flows ?? [], InfraFlow);
}

export async function saveInfraNode(
  cfg: ApiConfig,
  node: InfraNode,
): Promise<void> {
  await request(cfg, "PUT", `/infra/nodes/${encodeURIComponent(node.id)}`, node);
}

export async function saveInfraEdge(
  cfg: ApiConfig,
  edge: InfraEdge,
): Promise<void> {
  await request(cfg, "PUT", `/infra/edges/${encodeURIComponent(edge.id)}`, edge);
}

/** Delete a node; the server cascades the edges that referenced it. */
export async function deleteInfraNode(
  cfg: ApiConfig,
  nodeId: string,
): Promise<void> {
  await request(cfg, "DELETE", `/infra/nodes/${encodeURIComponent(nodeId)}`);
}

/** Delete a single edge, leaving both endpoint nodes in place. */
export async function deleteInfraEdge(
  cfg: ApiConfig,
  edgeId: string,
): Promise<void> {
  await request(cfg, "DELETE", `/infra/edges/${encodeURIComponent(edgeId)}`);
}

export async function saveInfraFlow(
  cfg: ApiConfig,
  flow: InfraFlow,
): Promise<void> {
  await request(cfg, "PUT", `/infra/flows/${encodeURIComponent(flow.id)}`, flow);
}

export async function deleteInfraFlow(
  cfg: ApiConfig,
  flowId: string,
): Promise<void> {
  await request(cfg, "DELETE", `/infra/flows/${encodeURIComponent(flowId)}`);
}

// --------------------------------------------------------------------------
// entity (ER / data model) layer
// --------------------------------------------------------------------------

/** Read the ER model — served alongside the infra graph on the same `/infra` GET. */
export async function fetchEntities(
  cfg: ApiConfig,
): Promise<{ entities: Entity[]; relations: EntityRelation[] }> {
  const body = await get<InfraResponse>(cfg, "/infra");
  return {
    entities: parseAll(body?.entities ?? [], Entity),
    relations: parseAll(body?.relations ?? [], EntityRelation),
  };
}

export async function saveEntity(
  cfg: ApiConfig,
  entity: Entity,
): Promise<void> {
  await request(
    cfg,
    "PUT",
    `/infra/entities/${encodeURIComponent(entity.id)}`,
    entity,
  );
}

export async function saveEntityRelation(
  cfg: ApiConfig,
  relation: EntityRelation,
): Promise<void> {
  await request(
    cfg,
    "PUT",
    `/infra/relations/${encodeURIComponent(relation.id)}`,
    relation,
  );
}

/** Delete an entity; the server cascades the relations that referenced it. */
export async function deleteEntity(
  cfg: ApiConfig,
  entityId: string,
): Promise<void> {
  await request(cfg, "DELETE", `/infra/entities/${encodeURIComponent(entityId)}`);
}

export async function deleteEntityRelation(
  cfg: ApiConfig,
  relationId: string,
): Promise<void> {
  await request(
    cfg,
    "DELETE",
    `/infra/relations/${encodeURIComponent(relationId)}`,
  );
}

// --------------------------------------------------------------------------
// agent / MCP layer (a standalone graph, served on its own `/agents` resource)
// --------------------------------------------------------------------------

interface AgentsResponse {
  agents: unknown[];
  servers: unknown[];
}

/** Read the project's agents + MCP servers in one call. */
export async function fetchAgents(
  cfg: ApiConfig,
): Promise<{ agents: AgentNode[]; servers: McpServerNode[] }> {
  const body = await get<AgentsResponse>(cfg, "/agents");
  return {
    agents: parseAll(body?.agents ?? [], AgentNode),
    servers: parseAll(body?.servers ?? [], McpServerNode),
  };
}

export async function saveAgentNode(
  cfg: ApiConfig,
  agent: AgentNode,
): Promise<void> {
  await request(
    cfg,
    "PUT",
    `/agents/nodes/${encodeURIComponent(agent.id)}`,
    agent,
  );
}

export async function deleteAgentNode(
  cfg: ApiConfig,
  agentId: string,
): Promise<void> {
  await request(cfg, "DELETE", `/agents/nodes/${encodeURIComponent(agentId)}`);
}

export async function saveMcpServer(
  cfg: ApiConfig,
  server: McpServerNode,
): Promise<void> {
  await request(
    cfg,
    "PUT",
    `/agents/servers/${encodeURIComponent(server.id)}`,
    server,
  );
}

/** Delete a server; the server cascades it out of any agent's `mcpServerIds`. */
export async function deleteMcpServer(
  cfg: ApiConfig,
  serverId: string,
): Promise<void> {
  await request(
    cfg,
    "DELETE",
    `/agents/servers/${encodeURIComponent(serverId)}`,
  );
}

// --------------------------------------------------------------------------
// tasks
// --------------------------------------------------------------------------

export async function fetchTasks(cfg: ApiConfig): Promise<Task[]> {
  const raw = await get<unknown[]>(cfg, "/tasks");
  return parseAll(raw, Task);
}

export async function saveTask(cfg: ApiConfig, task: Task): Promise<void> {
  await request(cfg, "PUT", `/tasks/${encodeURIComponent(task.id)}`, task);
}

/** Partial update — reads the task, merges, then writes the whole shape back. */
export async function patchTask(
  cfg: ApiConfig,
  taskId: string,
  patch: Partial<Omit<Task, "id" | "createdAt">>,
): Promise<Task> {
  const current = (await fetchTasks(cfg)).find((t) => t.id === taskId);
  if (!current) throw new Error(`No task with id "${taskId}".`);
  const next = Task.parse({
    ...current,
    ...patch,
    id: taskId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  await saveTask(cfg, next);
  return next;
}

export async function deleteTask(cfg: ApiConfig, taskId: string): Promise<void> {
  await request(cfg, "DELETE", `/tasks/${encodeURIComponent(taskId)}`);
}

// --------------------------------------------------------------------------
// checkpoints — manual, named canvas snapshots
// --------------------------------------------------------------------------

export async function fetchCheckpoints(cfg: ApiConfig): Promise<Checkpoint[]> {
  const raw = await get<unknown[]>(cfg, "/checkpoints");
  return parseAll(raw, Checkpoint);
}

/**
 * The project's unified activity feed (design / api / infra / flow events) for the
 * History timeline. Server-ordered newest-first; the client groups + filters it.
 */
export async function fetchProjectTimeline(
  cfg: ApiConfig,
): Promise<ProjectTimelineEvent[]> {
  const raw = await get<unknown[]>(cfg, "/timeline");
  return parseAll(raw, ProjectTimelineEvent);
}

/**
 * Create a checkpoint. The client only describes it (title/note/tag); the server
 * freezes the project's current design + infra into the snapshot, so the result
 * always reflects the persisted canvas. Returns the saved checkpoint.
 */
export async function createCheckpoint(
  cfg: ApiConfig,
  input: CheckpointInput,
): Promise<Checkpoint> {
  const raw = await request<unknown>(cfg, "POST", "/checkpoints", input);
  return Checkpoint.parse(raw);
}

export async function deleteCheckpoint(
  cfg: ApiConfig,
  checkpointId: string,
): Promise<void> {
  await request(cfg, "DELETE", `/checkpoints/${encodeURIComponent(checkpointId)}`);
}

/**
 * Restore a checkpoint: the server transactionally rewinds the project's design
 * elements + infra graph to the snapshot. The endpoint version history is left
 * intact (it is an append-only record, not part of the snapshot).
 */
export async function restoreCheckpoint(
  cfg: ApiConfig,
  checkpointId: string,
): Promise<void> {
  await request(
    cfg,
    "POST",
    `/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
  );
}

// --------------------------------------------------------------------------
// poller-facing reads (ETag-based conditional pollers)
//
// There is no 304 path, so these always return fresh data rather than `null`.
// They exist so the extension's poll loop keeps a stable shape; in repo mode a
// read is a few local file reads, so polling is cheap.
// --------------------------------------------------------------------------

export async function fetchElementsConditional(
  cfg: ApiConfig,
  _etag: string | undefined,
): Promise<{ etag: string | undefined; elements: DesignElement[] }> {
  return { etag: undefined, elements: await fetchElements(cfg) };
}

export async function fetchTimelinesConditional(
  cfg: ApiConfig,
  _etag: string | undefined,
): Promise<{ etag: string | undefined; timelines: ProjectTimelines }> {
  // Per-element version histories live at `/timelines` (plural); the singular
  // `/timeline` is the unified project feed (see fetchProjectTimeline). They must
  // stay distinct — sharing a path collides the two server routes.
  const raw = await get<Record<string, unknown[]>>(cfg, "/timelines");
  const timelines: ProjectTimelines = {};
  for (const [elementId, list] of Object.entries(raw ?? {})) {
    const entries = parseAll(list ?? [], VersionEntry);
    if (entries.length) timelines[elementId] = entries;
  }
  return { etag: undefined, timelines };
}

export async function fetchInfraConditional(
  cfg: ApiConfig,
  prev: InfraPollState,
): Promise<InfraPollState & { changed: boolean }> {
  const body = await get<InfraResponse>(cfg, "/infra");
  return {
    ...prev,
    nodes: parseAll(body?.nodes ?? [], InfraNode),
    edges: parseAll(body?.edges ?? [], InfraEdge),
    flows: parseAll(body?.flows ?? [], InfraFlow),
    changed: true,
  };
}

export async function fetchEntitiesConditional(
  cfg: ApiConfig,
  prev: EntityPollState,
): Promise<EntityPollState & { changed: boolean }> {
  const body = await get<InfraResponse>(cfg, "/infra");
  return {
    ...prev,
    entities: parseAll(body?.entities ?? [], Entity),
    relations: parseAll(body?.relations ?? [], EntityRelation),
    changed: true,
  };
}

export async function fetchTasksConditional(
  cfg: ApiConfig,
  _etag: string | undefined,
): Promise<{ etag: string | undefined; tasks: Task[] }> {
  return { etag: undefined, tasks: await fetchTasks(cfg) };
}

// --------------------------------------------------------------------------

/** Parse a list of unknowns with a schema, skipping rows that don't satisfy it. */
function parseAll<T>(
  values: unknown[],
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
): T[] {
  const out: T[] = [];
  for (const value of values) {
    const parsed = schema.safeParse(value);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
