import {
  ApiBinding,
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraNode,
  ProjectMember,
  ProjectRole,
  Task,
  VersionEntry,
  paths,
} from "./schema.js";
import { normalizeList } from "./rtdb.js";

/**
 * Thin RTDB client over the REST API, shared by every non-browser part of the
 * project (the VS Code extension and the MCP server). It carries no editor or
 * agent dependency — just `fetch` against a Firebase Realtime Database — so the
 * one writer stays the single source of truth: change a path or payload shape
 * here once and both surfaces follow.
 *
 * BYOD: the database URL comes from the caller's own settings/env. Designers
 * normally author the design layer on the canvas, but this client speaks the
 * full data contract too — it can create/update/delete design elements, document
 * them (write into an element's `apiBinding` sub-tree + append version history),
 * edit the infrastructure graph, and manage the project's member roster. That
 * parity is what lets the MCP server expose every feature to an AI agent.
 *
 * For private databases, pass an auth token (Firebase ID token / DB secret) and
 * it is appended as `?auth=` — keep it out of source control.
 */
export interface FirebaseConfig {
  databaseUrl: string; // e.g. https://my-db.firebaseio.com
  projectId: string;
  authToken?: string;
}

/**
 * What a caller supplies for a version-history entry. `timestamp` is stamped by
 * the writer; `action` and the endpoint snapshot are optional here — the schema
 * defaults `action` and `bindApiToElement` derives the snapshot from the binding
 * — but a caller that knows (created vs modified, or a deletion) should pass them.
 */
export type VersionInput = Omit<VersionEntry, "timestamp" | "action" | "endpoint"> &
  Partial<Pick<VersionEntry, "action" | "endpoint">>;

function url(cfg: FirebaseConfig, path: string): string {
  const base = cfg.databaseUrl.replace(/\/$/, "");
  const suffix = cfg.authToken
    ? `?auth=${encodeURIComponent(cfg.authToken)}`
    : "";
  return `${base}/${path}.json${suffix}`;
}

/**
 * Attach (or update) the API documentation on an existing design element, and
 * append an immutable version entry to its history.
 */
export async function bindApiToElement(
  cfg: FirebaseConfig,
  elementId: string,
  payload: ApiBinding,
  version: VersionInput,
): Promise<void> {
  const binding: ApiBinding = ApiBinding.parse(payload);

  // 1. Write the binding onto the element (leaves the element's geometry intact).
  await put(url(cfg, paths.apiBinding(cfg.projectId, elementId)), binding);

  // 2. Touch updatedAt so the canvas flags the change live.
  await put(
    url(cfg, `${paths.element(cfg.projectId, elementId)}/updatedAt`),
    new Date().toISOString(),
  );

  // 3. Append to the append-only timeline (POST = push id under the list path).
  //    Snapshot the endpoint (title/method/path) onto the entry so the timeline
  //    can still label this change after the binding is later deleted. The
  //    caller supplies `action` (created vs modified — it knows which); default
  //    covers any caller that doesn't.
  const entry: VersionEntry = VersionEntry.parse({
    ...version,
    timestamp: Date.now(),
    endpoint: version.endpoint ?? {
      title: binding.title,
      ...(binding.method ? { method: binding.method } : {}),
      ...(binding.endpoint ? { path: binding.endpoint } : {}),
    },
  });
  await post(url(cfg, paths.timeline(cfg.projectId, elementId)), entry);
}

/**
 * Remove the API binding from an element (the docs "delete"), touch updatedAt so
 * the canvas drops the pin live, and append a version entry recording the
 * removal. The design element itself is untouched — only its annotation goes.
 */
export async function unbindApiFromElement(
  cfg: FirebaseConfig,
  elementId: string,
  version: VersionInput,
): Promise<void> {
  await del(url(cfg, paths.apiBinding(cfg.projectId, elementId)));
  await put(
    url(cfg, `${paths.element(cfg.projectId, elementId)}/updatedAt`),
    new Date().toISOString(),
  );
  const entry: VersionEntry = VersionEntry.parse({
    ...version,
    timestamp: Date.now(),
  });
  await post(url(cfg, paths.timeline(cfg.projectId, elementId)), entry);
}

/**
 * Read existing design elements (id + display name) so a caller can offer a
 * pick-list of elements to annotate. Backend devs bind to what designers made.
 */
export async function listElements(
  cfg: FirebaseConfig,
): Promise<Array<{ id: string; name: string; type: string }>> {
  const res = await fetch(url(cfg, paths.projectElements(cfg.projectId)));
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  const body = (await res.json()) as Record<
    string,
    { name?: string; type?: string }
  > | null;
  if (!body) return [];
  return Object.entries(body).map(([id, el]) => ({
    id,
    name: el.name ?? "",
    type: el.type ?? "element",
  }));
}

/**
 * Read the full design elements (geometry + style + apiBinding) for a project,
 * so a caller can render the design or reason over the docs. Elements that don't
 * satisfy the schema are skipped rather than failing the whole read.
 */
export async function fetchElements(
  cfg: FirebaseConfig,
): Promise<DesignElement[]> {
  const res = await fetch(url(cfg, paths.projectElements(cfg.projectId)));
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  const body = (await res.json()) as Record<string, unknown> | null;
  if (!body) return [];
  const out: DesignElement[] = [];
  for (const value of Object.values(body)) {
    const parsed = DesignElement.safeParse(value);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Ids of every descendant of `id` (children, grandchildren, …) by `parentId`,
 * so a delete or move can cascade through a frame's whole subtree — the same
 * containment rule the canvas applies. The starting id itself is not included.
 */
export function descendantIds(
  id: string,
  elements: Array<Pick<DesignElement, "id" | "parentId">>,
): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const el of elements) {
      if (el.parentId === current && !out.includes(el.id)) {
        out.push(el.id);
        stack.push(el.id);
      }
    }
  }
  return out;
}

/**
 * Create or replace a whole design element (geometry + style + text + relations).
 * The canvas persists edits with the same PUT; exposing it here lets a non-browser
 * client author the design layer too. Stamps `updatedAt` so the canvas flags the
 * change live. Use `patchElement` to change a few fields without resending all.
 */
export async function saveElement(
  cfg: FirebaseConfig,
  element: DesignElement,
): Promise<void> {
  const body = DesignElement.parse({
    ...element,
    updatedAt: new Date().toISOString(),
  });
  await put(url(cfg, paths.element(cfg.projectId, body.id)), body);
}

/**
 * Update some fields of an existing element, preserving the rest (and its
 * apiBinding). Reads the element first so a partial change — move, resize,
 * rename, restyle, re-parent, or promote to a component — doesn't clobber the
 * other fields. Throws if the element doesn't exist.
 */
export async function patchElement(
  cfg: FirebaseConfig,
  elementId: string,
  patch: Partial<Omit<DesignElement, "id">>,
): Promise<DesignElement> {
  const current = (await fetchElements(cfg)).find((e) => e.id === elementId);
  if (!current) throw new Error(`No design element with id "${elementId}".`);
  const next = DesignElement.parse({
    ...current,
    ...patch,
    id: elementId,
    updatedAt: new Date().toISOString(),
  });
  await put(url(cfg, paths.element(cfg.projectId, elementId)), next);
  return next;
}

/**
 * Delete a design element. By default this cascades to the element's whole
 * subtree (descendants by `parentId`), matching the canvas — deleting a frame
 * removes what's nested inside it — so no child is left orphaned. Pass
 * `cascade: false` to remove only the one element. The element's append-only
 * version history is left intact as a record.
 */
export async function deleteElement(
  cfg: FirebaseConfig,
  elementId: string,
  opts: { cascade?: boolean } = {},
): Promise<string[]> {
  const cascade = opts.cascade ?? true;
  let ids = [elementId];
  if (cascade) {
    const all = await fetchElements(cfg);
    ids = [elementId, ...descendantIds(elementId, all)];
  }
  await Promise.all(
    ids.map((id) => del(url(cfg, paths.element(cfg.projectId, id)))),
  );
  return ids;
}

// --------------------------------------------------------------------------
// Membership roster (per-project access control)
// --------------------------------------------------------------------------

/** Read a project's member roster (uid + role + when granted). */
export async function listMembers(
  cfg: FirebaseConfig,
): Promise<Array<{ uid: string } & ProjectMember>> {
  const res = await fetch(url(cfg, paths.projectMembers(cfg.projectId)));
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  const body = (await res.json()) as Record<string, unknown> | null;
  if (!body) return [];
  const out: Array<{ uid: string } & ProjectMember> = [];
  for (const [uid, value] of Object.entries(body)) {
    const parsed = ProjectMember.safeParse(value);
    if (parsed.success) out.push({ uid, ...parsed.data });
  }
  return out;
}

/**
 * Enrol a uid into the project's roster (the REST-side of the canvas' 👤 +Member
 * control). The caller must already be a privileged/member client for the rules
 * to admit the write. Defaults the new uid to `editor`; pass `owner` to grant
 * ownership or `viewer` for read-only. Re-adding an existing uid updates its role.
 */
export async function addMember(
  cfg: FirebaseConfig,
  uid: string,
  role: ProjectRole = "editor",
): Promise<void> {
  const member = ProjectMember.parse({ role, addedAt: new Date().toISOString() });
  await put(url(cfg, paths.projectMember(cfg.projectId, uid)), member);
}

/** Remove a uid from the project's roster, revoking its access. */
export async function removeMember(
  cfg: FirebaseConfig,
  uid: string,
): Promise<void> {
  await del(url(cfg, paths.projectMember(cfg.projectId, uid)));
}

/**
 * Read the project's infrastructure graph (nodes + edges). Both subtrees may
 * arrive as a literal array or a push-keyed object, so normalize on read; rows
 * that don't satisfy the schema are skipped rather than failing the whole read.
 */
export async function fetchInfra(
  cfg: FirebaseConfig,
): Promise<{ nodes: InfraNode[]; edges: InfraEdge[] }> {
  const [nodesRes, edgesRes] = await Promise.all([
    fetch(url(cfg, paths.infraNodes(cfg.projectId))),
    fetch(url(cfg, paths.infraEdges(cfg.projectId))),
  ]);
  if (!nodesRes.ok) throw new Error(`Firebase read failed: ${nodesRes.status}`);
  if (!edgesRes.ok) throw new Error(`Firebase read failed: ${edgesRes.status}`);

  const nodes: InfraNode[] = [];
  for (const value of normalizeList(await nodesRes.json())) {
    const parsed = InfraNode.safeParse(value);
    if (parsed.success) nodes.push(parsed.data);
  }
  const edges: InfraEdge[] = [];
  for (const value of normalizeList(await edgesRes.json())) {
    const parsed = InfraEdge.safeParse(value);
    if (parsed.success) edges.push(parsed.data);
  }
  return { nodes, edges };
}

/**
 * Conditional GET against the RTDB REST API. Asks Firebase for an ETag and,
 * when a previous one is supplied, sends it as `If-None-Match` so an unchanged
 * subtree comes back as a bodyless 304 — no transfer, no JSON parse, no diff.
 * Returns `null` for 304 (caller keeps its last value), otherwise the new body
 * plus the fresh ETag to send next time.
 */
async function getJsonConditional(
  u: string,
  etag: string | undefined,
): Promise<{ etag: string | undefined; body: unknown } | null> {
  const headers: Record<string, string> = { "X-Firebase-ETag": "true" };
  if (etag) headers["if-none-match"] = etag;
  const res = await fetch(u, { headers });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  return { etag: res.headers.get("etag") ?? undefined, body: await res.json() };
}

/**
 * Poller-facing read of the design elements. Returns `null` when nothing has
 * changed since `etag` (so the caller can skip re-rendering), otherwise the
 * parsed elements and the new ETag to pass on the next poll.
 */
export async function fetchElementsConditional(
  cfg: FirebaseConfig,
  etag: string | undefined,
): Promise<{ etag: string | undefined; elements: DesignElement[] } | null> {
  const r = await getJsonConditional(
    url(cfg, paths.projectElements(cfg.projectId)),
    etag,
  );
  if (!r) return null;
  const body = r.body as Record<string, unknown> | null;
  const out: DesignElement[] = [];
  if (body) {
    for (const value of Object.values(body)) {
      const parsed = DesignElement.safeParse(value);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return { etag: r.etag, elements: out };
}

/** Per-element version histories for a whole project, keyed by element id. */
export type ProjectTimelines = Record<string, VersionEntry[]>;

/**
 * Poller-facing read of every element's version history in one GET. Returns
 * `null` when nothing has changed since `etag` (so the caller can skip
 * re-rendering), otherwise the parsed histories and the new ETag. Each history
 * may arrive as a literal array or a push-keyed object (the writers POST), so
 * normalize per element; entries that don't satisfy the schema are skipped.
 */
export async function fetchTimelinesConditional(
  cfg: FirebaseConfig,
  etag: string | undefined,
): Promise<{ etag: string | undefined; timelines: ProjectTimelines } | null> {
  const r = await getJsonConditional(
    url(cfg, paths.projectTimelines(cfg.projectId)),
    etag,
  );
  if (!r) return null;
  const body = r.body as Record<string, unknown> | null;
  const timelines: ProjectTimelines = {};
  if (body) {
    for (const [elementId, value] of Object.entries(body)) {
      const entries: VersionEntry[] = [];
      for (const raw of normalizeList(value)) {
        const parsed = VersionEntry.safeParse(raw);
        if (parsed.success) entries.push(parsed.data);
      }
      if (entries.length) timelines[elementId] = entries;
    }
  }
  return { etag: r.etag, timelines };
}

/** ETags + last-parsed graph the infra poller carries between ticks. */
export interface InfraPollState {
  nodeEtag?: string;
  edgeEtag?: string;
  flowEtag?: string;
  nodes: InfraNode[];
  edges: InfraEdge[];
  flows: InfraFlow[];
}

/**
 * Poller-facing read of the infrastructure graph. Conditionally fetches the
 * nodes, edges and flows subtrees in parallel, falling back to the previous
 * value for whichever side is unchanged (304). `changed` is true when any side
 * moved, so the caller only re-renders the combined graph when it actually differs.
 */
export async function fetchInfraConditional(
  cfg: FirebaseConfig,
  prev: InfraPollState,
): Promise<InfraPollState & { changed: boolean }> {
  const [nodesR, edgesR, flowsR] = await Promise.all([
    getJsonConditional(url(cfg, paths.infraNodes(cfg.projectId)), prev.nodeEtag),
    getJsonConditional(url(cfg, paths.infraEdges(cfg.projectId)), prev.edgeEtag),
    getJsonConditional(url(cfg, paths.infraFlows(cfg.projectId)), prev.flowEtag),
  ]);

  let nodes = prev.nodes;
  let nodeEtag = prev.nodeEtag;
  if (nodesR) {
    nodeEtag = nodesR.etag;
    nodes = [];
    for (const value of normalizeList(nodesR.body)) {
      const parsed = InfraNode.safeParse(value);
      if (parsed.success) nodes.push(parsed.data);
    }
  }

  let edges = prev.edges;
  let edgeEtag = prev.edgeEtag;
  if (edgesR) {
    edgeEtag = edgesR.etag;
    edges = [];
    for (const value of normalizeList(edgesR.body)) {
      const parsed = InfraEdge.safeParse(value);
      if (parsed.success) edges.push(parsed.data);
    }
  }

  let flows = prev.flows;
  let flowEtag = prev.flowEtag;
  if (flowsR) {
    flowEtag = flowsR.etag;
    flows = [];
    for (const value of normalizeList(flowsR.body)) {
      const parsed = InfraFlow.safeParse(value);
      if (parsed.success) flows.push(parsed.data);
    }
  }

  return {
    nodeEtag,
    edgeEtag,
    flowEtag,
    nodes,
    edges,
    flows,
    changed: Boolean(nodesR) || Boolean(edgesR) || Boolean(flowsR),
  };
}

/** Create or update one infrastructure node. */
export async function saveInfraNode(
  cfg: FirebaseConfig,
  node: InfraNode,
): Promise<void> {
  const body = InfraNode.parse(node);
  await put(url(cfg, paths.infraNode(cfg.projectId, body.id)), body);
}

/** Create or update one infrastructure edge. */
export async function saveInfraEdge(
  cfg: FirebaseConfig,
  edge: InfraEdge,
): Promise<void> {
  const body = InfraEdge.parse(edge);
  await put(url(cfg, paths.infraEdge(cfg.projectId, body.id)), body);
}

/**
 * Remove an infrastructure node and any edges touching it, so the diagram never
 * keeps a dangling connection to a node that no longer exists.
 */
export async function deleteInfraNode(
  cfg: FirebaseConfig,
  nodeId: string,
): Promise<void> {
  await del(url(cfg, paths.infraNode(cfg.projectId, nodeId)));
  const { edges } = await fetchInfra(cfg);
  await Promise.all(
    edges
      .filter((e) => e.from === nodeId || e.to === nodeId)
      .map((e) => del(url(cfg, paths.infraEdge(cfg.projectId, e.id)))),
  );
}

// --------------------------------------------------------------------------
// Infrastructure flows (narrated paths over the infra graph)
// --------------------------------------------------------------------------

/**
 * Read the project's infrastructure flows. Like the nodes/edges subtrees, this
 * may arrive as a literal array or a push-keyed object, so normalize on read;
 * flows that don't satisfy the schema are skipped rather than failing the read.
 */
export async function fetchFlows(cfg: FirebaseConfig): Promise<InfraFlow[]> {
  const res = await fetch(url(cfg, paths.infraFlows(cfg.projectId)));
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  const flows: InfraFlow[] = [];
  for (const value of normalizeList(await res.json())) {
    const parsed = InfraFlow.safeParse(value);
    if (parsed.success) flows.push(parsed.data);
  }
  return flows;
}

/** Create or update one infrastructure flow (stamps `updatedAt`). */
export async function saveInfraFlow(
  cfg: FirebaseConfig,
  flow: InfraFlow,
): Promise<void> {
  const body = InfraFlow.parse({ ...flow, updatedAt: new Date().toISOString() });
  await put(url(cfg, paths.infraFlow(cfg.projectId, body.id)), body);
}

/** Remove one infrastructure flow. */
export async function deleteInfraFlow(
  cfg: FirebaseConfig,
  flowId: string,
): Promise<void> {
  await del(url(cfg, paths.infraFlow(cfg.projectId, flowId)));
}

// --------------------------------------------------------------------------
// Task tracker (project-scoped work items that link into the other layers)
// --------------------------------------------------------------------------

/**
 * Read the project's tasks. Like the infra subtrees, this may arrive as a
 * literal array or a push-keyed object, so normalize on read; rows that don't
 * satisfy the schema are skipped rather than failing the whole read.
 */
export async function fetchTasks(cfg: FirebaseConfig): Promise<Task[]> {
  const res = await fetch(url(cfg, paths.tasks(cfg.projectId)));
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  const tasks: Task[] = [];
  for (const value of normalizeList(await res.json())) {
    const parsed = Task.safeParse(value);
    if (parsed.success) tasks.push(parsed.data);
  }
  return tasks;
}

/** Create or update one task (stamps `updatedAt`). */
export async function saveTask(cfg: FirebaseConfig, task: Task): Promise<void> {
  const body = Task.parse({ ...task, updatedAt: new Date().toISOString() });
  await put(url(cfg, paths.task(cfg.projectId, body.id)), body);
}

/**
 * Update some fields of an existing task, preserving the rest. Reads the task
 * first so a partial change — status, assignee, a link — doesn't clobber the
 * other fields. Throws if the task doesn't exist.
 */
export async function patchTask(
  cfg: FirebaseConfig,
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
  await put(url(cfg, paths.task(cfg.projectId, taskId)), next);
  return next;
}

/** Remove one task. */
export async function deleteTask(
  cfg: FirebaseConfig,
  taskId: string,
): Promise<void> {
  await del(url(cfg, paths.task(cfg.projectId, taskId)));
}

/**
 * Poller-facing read of the project's tasks. Returns `null` when nothing has
 * changed since `etag` (so the caller can skip re-rendering), otherwise the
 * parsed tasks and the new ETag to pass on the next poll.
 */
export async function fetchTasksConditional(
  cfg: FirebaseConfig,
  etag: string | undefined,
): Promise<{ etag: string | undefined; tasks: Task[] } | null> {
  const r = await getJsonConditional(url(cfg, paths.tasks(cfg.projectId)), etag);
  if (!r) return null;
  const tasks: Task[] = [];
  for (const value of normalizeList(r.body)) {
    const parsed = Task.safeParse(value);
    if (parsed.success) tasks.push(parsed.data);
  }
  return { etag: r.etag, tasks };
}

async function put(u: string, body: unknown): Promise<void> {
  const res = await fetch(u, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firebase write failed: ${res.status}`);
}

async function post(u: string, body: unknown): Promise<void> {
  const res = await fetch(u, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firebase append failed: ${res.status}`);
}

async function del(u: string): Promise<void> {
  const res = await fetch(u, { method: "DELETE" });
  if (!res.ok) throw new Error(`Firebase delete failed: ${res.status}`);
}
