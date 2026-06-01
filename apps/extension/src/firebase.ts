import {
  ApiBinding,
  DesignElement,
  InfraEdge,
  InfraNode,
  VersionEntry,
  normalizeList,
  paths,
} from "@adc/shared";

/**
 * Thin RTDB writer over the REST API so the extension stays dependency-light
 * (no firebase-admin in the editor process). BYOD: the database URL comes from
 * the user's own settings.
 *
 * The extension never creates design elements — designers do that on the canvas.
 * It only *documents* an existing element by writing into that element's
 * `apiBinding` sub-tree, then appends a version-history entry.
 *
 * For private databases, pass an auth token (Firebase ID token / DB secret) and
 * it is appended as `?auth=` — keep it out of source control.
 */
export interface FirebaseConfig {
  databaseUrl: string; // e.g. https://my-db.firebaseio.com
  projectId: string;
  authToken?: string;
}

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
  version: Omit<VersionEntry, "timestamp">,
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
  const entry: VersionEntry = VersionEntry.parse({
    ...version,
    timestamp: Date.now(),
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
  version: Omit<VersionEntry, "timestamp">,
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
 * Read existing design elements (id + display name) so the editor can offer a
 * quick-pick of elements to annotate. Backend devs bind to what designers made.
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
 * so the in-editor canvas webview can render the design and overlay the docs.
 * Elements that don't satisfy the schema are skipped rather than failing the
 * whole read.
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
