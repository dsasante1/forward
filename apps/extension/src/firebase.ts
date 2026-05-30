import {
  ApiPayload,
  CanvasNode,
  VersionEntry,
  paths,
} from "@adc/shared";

/**
 * Thin RTDB writer over the REST API so the extension stays dependency-light
 * (no firebase-admin in the editor process). BYOD: the database URL comes from
 * the user's own settings.
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
  const suffix = cfg.authToken ? `?auth=${encodeURIComponent(cfg.authToken)}` : "";
  return `${base}/${path}.json${suffix}`;
}

/** Upsert a canvas node (latest state) and append an immutable version entry. */
export async function pushEndpoint(
  cfg: FirebaseConfig,
  nodeId: string,
  payload: ApiPayload,
  version: Omit<VersionEntry, "timestamp">,
): Promise<void> {
  const node: CanvasNode = CanvasNode.parse({
    ...payload,
    updatedAt: new Date().toISOString(),
  });

  // 1. Upsert the current node state.
  await put(url(cfg, paths.node(cfg.projectId, nodeId)), node);

  // 2. Append to the append-only timeline (POST = push id under the list path).
  const entry: VersionEntry = VersionEntry.parse({
    ...version,
    timestamp: Date.now(),
  });
  await post(url(cfg, paths.timeline(cfg.projectId, nodeId)), entry);
}

/** Read existing node ids for a project (powers a quick-pick in the editor). */
export async function listNodeIds(cfg: FirebaseConfig): Promise<string[]> {
  const res = await fetch(
    url(cfg, paths.projectNodes(cfg.projectId)) +
      (cfg.authToken ? "&" : "?") +
      "shallow=true",
  );
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  const body = (await res.json()) as Record<string, true> | null;
  return body ? Object.keys(body) : [];
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
