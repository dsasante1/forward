import type { ProjectBundle } from "forward-core/repo";
import { mountCanvas } from "../src/canvas.js";
import { ServerSource } from "../src/server-source.js";
import { StaticSource } from "../src/static-source.js";

/**
 * Standalone host for the canvas, shipped with the `forward` CLI.
 *
 *   - `forward serve` injects `{ mode: "serve", token, projectId }`; the canvas
 *     edits the repo's `.forward/` files through the local server's REST routes
 *     (the same `forward-core/api` contract), authorized by a per-session token.
 *   - `forward export` injects `{ mode: "static", bundle }`; the canvas renders
 *     the exported snapshot read-only — what GitHub Pages serves.
 */
type HostConfig =
  | { mode: "serve"; token: string; projectId: string; projectName: string }
  | { mode: "static"; bundle: string };

declare global {
  interface Window {
    __FORWARD__?: HostConfig;
  }
}

const app = document.getElementById("app") as HTMLElement;
const banner = document.getElementById("banner") as HTMLElement;

function showError(html: string): void {
  const el = document.getElementById("error") as HTMLElement;
  el.innerHTML = html;
  el.style.display = "block";
}

function showBanner(text: string): void {
  banner.textContent = text;
  banner.style.display = "block";
}

async function start(): Promise<void> {
  const cfg = window.__FORWARD__;
  if (!cfg) {
    showError(
      "<h2>Forward</h2><p>Open this page through <code>forward serve</code> " +
        "or a site built with <code>forward export</code>.</p>",
    );
    return;
  }
  if (cfg.mode === "serve") {
    document.title = `${cfg.projectName} · Forward`;
    const source = new ServerSource(location.origin, cfg.projectId, async () => cfg.token, 1500);
    mountCanvas({ container: app, source, projectId: cfg.projectId, projectName: cfg.projectName });
    showBanner("Editing .forward/ in your repository · commit to share");
    return;
  }
  const res = await fetch(new URL(cfg.bundle, location.href));
  if (!res.ok) {
    showError(`<h2>Forward</h2><p>Couldn't load the project snapshot (${res.status}).</p>`);
    return;
  }
  const bundle = (await res.json()) as ProjectBundle;
  document.title = `${bundle.project.name} · Forward`;
  const focus = new URLSearchParams(location.search).get("element");
  mountCanvas({
    container: app,
    source: new StaticSource(bundle),
    projectId: bundle.project.id,
    projectName: bundle.project.name,
    focusElementId: focus,
  });
  const when = new Date(bundle.generatedAt).toLocaleString();
  showBanner(`Read-only snapshot · exported ${when} · run \`forward serve\` to edit`);
}

void start();
