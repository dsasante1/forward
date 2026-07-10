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
  ProjectInvite,
  ProjectRole,
  ProjectTimelineEvent,
  type SaveableElement,
  Task,
  VersionEntry,
} from "./schema.js";
// Type-only imports (erased at runtime → no coupling to the Firebase client) so
// the surfaces see the exact same VersionInput / poll-state shapes either way.
import type {
  EntityPollState,
  InfraPollState,
  ProjectTimelines,
  VersionInput,
} from "./rtdb-rest.js";

export type { EntityPollState, InfraPollState, ProjectTimelines, VersionInput };

/**
 * The closed-source API client — the centralized replacement for `rtdb-rest.ts`.
 *
 * It is a deliberate drop-in: every exported function mirrors the name, argument
 * order and return type of its `rtdb-rest` twin, so a surface migrates by swapping
 * its import (`forward-core` → `forward-core/api`) and building an `ApiConfig`
 * instead of a `FirebaseConfig`. Nothing else in the caller changes.
 *
 * The differences are exactly the centralization fixes:
 *   - talks to the Forward backend (apps/server), never the database directly;
 *   - sends a per-user token in the `Authorization: Bearer` header (no `?auth=`);
 *   - the server owns identity + timestamps, so the `author` a caller passes is
 *     ignored — the session decides who wrote it.
 *
 * The ETag/conditional pollers are kept for signature-compatibility but always
 * return data (the server has no 304 path yet). Subscribe to the project's
 * Supabase Realtime channel for push updates instead of tight polling.
 */
export interface ApiConfig {
  /** Base URL of the Forward backend, e.g. https://api.forward.dev */
  baseUrl: string;
  /** The project (tenancy) id this client operates within. */
  projectId: string;
  /** A Clerk session token (sent as `Authorization: Bearer`). */
  token: string;
}

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
  const res = await fetch(`${base(cfg)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Forward API ${method} ${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

const get = <T>(cfg: ApiConfig, path: string) => request<T>(cfg, "GET", path);

// --------------------------------------------------------------------------
// realtime
// --------------------------------------------------------------------------

/**
 * The project's realtime channel name — the unguessable, member-only capability
 * a client passes to Supabase Realtime to receive the server's ChangeEvent
 * broadcasts (see forward-core realtime.ts). Server-issued: the client never
 * derives it from the project id.
 *
 * Deliberately has no `rtdb-rest` twin (the one exception to the
 * signature-identical rule): on the Firebase path the database itself was the
 * realtime bus, so there is no channel capability to fetch.
 */
export async function fetchRealtimeChannel(cfg: ApiConfig): Promise<string> {
  const { channel } = await get<{ channel: string }>(cfg, "/realtime");
  return channel;
}

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
// membership roster
// --------------------------------------------------------------------------

export interface RosterMember {
  uid: string;
  email: string | null;
  /** Display name mirrored from Clerk; null until the user's profile is synced. */
  name: string | null;
  /** Avatar URL mirrored from Clerk; null if unavailable. */
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

export async function addMember(
  cfg: ApiConfig,
  uid: string,
  role: ProjectRole = "editor",
): Promise<void> {
  await request(cfg, "POST", "/members", { userId: uid, role });
}

export async function updateMemberRole(
  cfg: ApiConfig,
  uid: string,
  role: ProjectRole,
): Promise<void> {
  await request(cfg, "PATCH", `/members/${encodeURIComponent(uid)}`, { role });
}

export async function removeMember(cfg: ApiConfig, uid: string): Promise<void> {
  await request(cfg, "DELETE", `/members/${encodeURIComponent(uid)}`);
}

// --------------------------------------------------------------------------
// email invitations
// --------------------------------------------------------------------------

/** A pending invitation as returned by the API (the opaque token is never listed). */
export type InviteSummary = Pick<
  ProjectInvite,
  "id" | "email" | "role" | "status" | "createdAt" | "expiresAt"
>;

export async function listInvites(cfg: ApiConfig): Promise<InviteSummary[]> {
  return (await get<InviteSummary[]>(cfg, "/invites")) ?? [];
}

export async function createInvite(
  cfg: ApiConfig,
  email: string,
  role: ProjectRole = "editor",
): Promise<InviteSummary & { emailSent: boolean }> {
  return request(cfg, "POST", "/invites", { email, role });
}

export async function revokeInvite(
  cfg: ApiConfig,
  inviteId: string,
): Promise<void> {
  await request(cfg, "DELETE", `/invites/${encodeURIComponent(inviteId)}`);
}

/**
 * Redeem an invitation token. Account-level (not project-scoped) — the caller is
 * not yet a member — so it bypasses the project base path.
 */
export async function acceptInvite(
  cfg: ApiConfig,
  inviteToken: string,
): Promise<{ projectId: string; role: ProjectRole }> {
  const res = await fetch(
    `${cfg.baseUrl.replace(/\/$/, "")}/invites/${encodeURIComponent(inviteToken)}/accept`,
    { method: "POST", headers: { authorization: `Bearer ${cfg.token}` } },
  );
  if (!res.ok) {
    throw new Error(`Forward API accept invite failed: ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : { projectId: "", role: "editor" };
}

// --------------------------------------------------------------------------
// account-level (above project scope)
//
// These take a raw baseUrl + token rather than a project-scoped ApiConfig: they
// list the projects a user belongs to, and manage the Personal Access Tokens a
// headless surface (the VS Code extension) authenticates with. Shared here so the
// dashboard and extension don't each hand-build these paths.
// --------------------------------------------------------------------------

async function accountRequest<T>(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Forward API ${method} ${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

/** A project the caller belongs to, with their role in it. */
export interface ProjectSummary {
  id: string;
  name: string;
  role: ProjectRole;
}

/** The projects the authenticated user is a member of (account-level). */
export async function listProjects(
  baseUrl: string,
  token: string,
): Promise<ProjectSummary[]> {
  const rows = await accountRequest<
    Array<{ id: string; name: string; role: ProjectRole }>
  >(baseUrl, token, "GET", "/projects");
  return (rows ?? []).map((p) => ({ id: p.id, name: p.name, role: p.role }));
}

/** A Personal Access Token as listed — never includes the secret. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export async function listApiTokens(
  baseUrl: string,
  token: string,
): Promise<ApiTokenSummary[]> {
  return (
    (await accountRequest<ApiTokenSummary[]>(baseUrl, token, "GET", "/tokens")) ??
    []
  );
}

/** A freshly minted PAT — the only response that carries the plaintext `token`. */
export interface NewApiToken {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  createdAt: string;
  token: string;
}

/**
 * Mint a PAT. The returned `token` is the plaintext, available only here — show
 * it once, then it is unrecoverable. `expiresInDays` defaults to 90 server-side
 * when omitted; every token expires (there is no never-expires option).
 */
export async function createApiToken(
  baseUrl: string,
  token: string,
  name: string,
  expiresInDays?: number,
): Promise<NewApiToken> {
  return accountRequest(baseUrl, token, "POST", "/tokens", {
    name,
    ...(expiresInDays !== undefined ? { expiresInDays } : {}),
  });
}

/**
 * Rotate a PAT: revoke `id` and mint a replacement under the same name. Returns
 * the new plaintext (shown once); the old token stops working immediately.
 */
export async function rotateApiToken(
  baseUrl: string,
  token: string,
  id: string,
  expiresInDays?: number,
): Promise<NewApiToken> {
  return accountRequest(
    baseUrl,
    token,
    "POST",
    `/tokens/${encodeURIComponent(id)}/rotate`,
    expiresInDays !== undefined ? { expiresInDays } : {},
  );
}

export async function revokeApiToken(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  await accountRequest(baseUrl, token, "DELETE", `/tokens/${encodeURIComponent(id)}`);
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

/** Read the project's agents + MCP servers (the twin of rtdb-rest.fetchAgents). */
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
 * The project's unified activity feed (design / api / infra / uml events) for the
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
// poller-facing reads (signature-compatible with the Firebase ETag pollers)
//
// The backend has no 304 path yet, so these always return fresh data rather than
// `null`. They exist so the extension's existing poll loop runs unchanged; the
// real upgrade is to subscribe to the project's Supabase Realtime channel and
// re-fetch only on a change event.
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
