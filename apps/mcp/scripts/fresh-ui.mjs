import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vitest global setup: the browser tests drive the built canvas, so rebuild it
 * when its sources are newer, or they'd quietly pass against the old UI. It runs
 * before any test imports forward-core, so nothing reads `dist` mid-write. A
 * failed build is handed to those tests rather than thrown here, so a canvas
 * type error doesn't stop the rest of this workspace's suite.
 */
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const path = (...parts) => join(repo, ...parts);

function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** The most recent change among `paths`, ignoring tests, which never ship. */
function newest(paths) {
  let latest = 0;
  for (const dir of paths) {
    latest = Math.max(latest, mtime(dir));
    let entries = [];
    try {
      entries = readdirSync(dir, { recursive: true, withFileTypes: true });
    } catch {
      continue; // a file, not a directory
    }
    for (const e of entries) {
      if (e.isFile() && !e.name.endsWith(".test.ts")) latest = Math.max(latest, mtime(join(e.parentPath, e.name)));
    }
  }
  return latest;
}

function build(workspace) {
  console.log(`[fresh-ui] ${workspace} is out of date, rebuilding`);
  execFileSync("npm", ["run", "build", "-w", workspace], { cwd: repo, stdio: "pipe" });
}

export default function setup(project) {
  let error = "";
  try {
    const shared = newest([path("packages/shared/src")]) > mtime(path("packages/shared/dist/index.js"));
    if (shared) build("packages/shared");
    const canvasSources = [path("apps/canvas/src"), path("apps/canvas/host"), path("apps/canvas/vite.host.config.ts")];
    if (shared || newest(canvasSources) > mtime(path("apps/canvas/dist-host/index.html"))) build("apps/canvas");
  } catch (err) {
    error = String(err.stdout || err.message);
  }
  project.provide("uiBuildError", error);
}
