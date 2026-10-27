/// <reference types="node" />
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ApiConfig, ApiTransport } from "../api-rest.js";
import { resolveAuthor } from "./git.js";
import { FORWARD_DIR, MANIFEST_FILE } from "./layout.js";
import { createRepoRouter } from "./router.js";
import { RepoStore } from "./store.js";

/**
 * Walk up from `start` to the nearest directory holding `.forward/forward.json`.
 * `$FORWARD_REPO` (a path) wins when set. Returns undefined when none is found.
 */
export function findRepoRoot(start: string = process.cwd()): string | undefined {
  const forced = process.env.FORWARD_REPO?.trim();
  if (forced) {
    const root = resolve(forced);
    return existsSync(join(root, FORWARD_DIR, MANIFEST_FILE)) ? root : undefined;
  }
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, FORWARD_DIR, MANIFEST_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface RepoConfigOptions {
  /** Override the author stamped on writes (defaults to git `user.name`). */
  author?: string;
}

/** An in-process transport that serves every request from `root/.forward/`. */
export function repoTransport(root: string, opts: RepoConfigOptions = {}): ApiTransport {
  const store = new RepoStore(root, { author: opts.author ?? resolveAuthor(root) });
  return createRepoRouter(store);
}

/**
 * An {@link ApiConfig} for repo mode: pass it to any `forward-core/api`
 * function and the call is served from the files in `root`. No server, no
 * token, no network.
 */
export function repoConfig(root: string, opts: RepoConfigOptions = {}): ApiConfig {
  const store = new RepoStore(root, { author: opts.author ?? resolveAuthor(root) });
  return {
    baseUrl: `file://${root}`,
    projectId: store.manifest().id,
    token: "repo",
    transport: createRepoRouter(store),
  };
}
