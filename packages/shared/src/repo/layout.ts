/// <reference types="node" />
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * The on-disk layout of a Forward project inside a git repository.
 *
 * Every record is its own pretty-printed JSON file named after its id, so two
 * people editing different elements never touch the same file and a pull request
 * shows a readable per-record diff. Version-history entries are one file each
 * (append-only by construction), so concurrent doc saves on two branches merge
 * without conflicts.
 *
 *   .forward/
 *     forward.json                    project manifest (format, id, name)
 *     design/<elementId>.json         DesignElement (incl. its apiBinding)
 *     history/<elementId>/<ts>-<n>.json  VersionEntry (API-doc history)
 *     infra/nodes|edges|flows/<id>.json
 *     data/entities|relations/<id>.json
 *     agents/agents|servers/<id>.json
 *     tasks/<id>.json
 *     checkpoints/<id>.json
 */
export const FORWARD_DIR = ".forward";
export const MANIFEST_FILE = "forward.json";
export const FORMAT_VERSION = 1;

/** Every collection directory, relative to `.forward/`. */
export const COLLECTIONS = {
  elements: "design",
  history: "history",
  infraNodes: "infra/nodes",
  infraEdges: "infra/edges",
  infraFlows: "infra/flows",
  entities: "data/entities",
  relations: "data/relations",
  agents: "agents/agents",
  servers: "agents/servers",
  tasks: "tasks",
  checkpoints: "checkpoints",
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;

/** Filenames stay readable for ordinary ids and safe for any other id. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Map a record id to its filename (without `.json`). Ordinary ids are used as
 * is. Anything else is percent-encoded, and very long ids are hashed, so a
 * hostile id can never escape its directory. The file content carries the real
 * id, so reads never depend on decoding this name.
 */
export function fileNameForId(id: string): string {
  if (SAFE_ID.test(id)) return id;
  const encoded = encodeURIComponent(id).replace(/\./g, "%2E").replace(/\*/g, "%2A");
  if (encoded.length <= 100) return `_${encoded}`;
  return `_h${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

/** Absolute path of the `.forward/` directory under a repository root. */
export function forwardDir(root: string): string {
  return join(root, FORWARD_DIR);
}

/** Absolute path of a collection directory. */
export function collectionDir(root: string, key: CollectionKey): string {
  return join(root, FORWARD_DIR, COLLECTIONS[key]);
}

/** Map a `.forward/`-relative path back to the collection it belongs to. */
export function collectionOf(relPath: string): CollectionKey | undefined {
  let best: CollectionKey | undefined;
  for (const [key, dir] of Object.entries(COLLECTIONS) as [CollectionKey, string][]) {
    if (relPath.startsWith(`${dir}/`) && (!best || dir.length > COLLECTIONS[best].length)) {
      best = key;
    }
  }
  return best;
}
