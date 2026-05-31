import { ApiPayload, VersionEntry, paths } from "@adc/shared";

/**
 * Thin RTDB writer over the REST API so the extension stays dependency-light
 * (no firebase-admin in the editor process). BYOD: the database URL comes from
 * the user's own settings.
 *
 * The extension never creates design elements — designers do that on the canvas.
 * It only *annotates* an existing element by writing into that element's
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
 * Attach (or update) the API binding on an existing design element, and append
 * an immutable version entry to its history.
 */
export async function bindApiToElement(
  cfg: FirebaseConfig,
  elementId: string,
  payload: ApiPayload,
  version: Omit<VersionEntry, "timestamp">,
): Promise<void> {
  const binding: ApiPayload = ApiPayload.parse(payload);

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
