import {
  ApiBinding,
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraNode,
  ProjectRole,
  Task,
  VersionEntry,
} from "./schema.js";
// Type-only imports (erased at runtime → no coupling to the Firebase client) so
// the surfaces see the exact same VersionInput / poll-state shapes either way.
import type {
  InfraPollState,
  ProjectTimelines,
  VersionInput,
} from "./rtdb-rest.js";

export type { InfraPollState, ProjectTimelines, VersionInput };

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

export async function saveElement(
  cfg: ApiConfig,
  element: DesignElement,
): Promise<void> {
  await request(cfg, "PUT", `/elements/${encodeURIComponent(element.id)}`, element);
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

export async function listMembers(
  cfg: ApiConfig,
): Promise<Array<{ uid: string; role: ProjectRole; addedAt: string }>> {
  const rows = await get<
    Array<{ userId: string; role: ProjectRole; addedAt: string }>
  >(cfg, "/members");
  return (rows ?? []).map((m) => ({
    uid: m.userId,
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

export async function removeMember(cfg: ApiConfig, uid: string): Promise<void> {
  await request(cfg, "DELETE", `/members/${encodeURIComponent(uid)}`);
}

// --------------------------------------------------------------------------
// infrastructure graph + flows
// --------------------------------------------------------------------------

interface InfraResponse {
  nodes: unknown[];
  edges: unknown[];
  flows: unknown[];
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
  const raw = await get<Record<string, unknown[]>>(cfg, "/timeline");
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
