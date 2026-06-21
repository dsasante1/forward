import { loadConfig, readLink } from "./config.js";
import { FixtureSource, LiveSource, type CanvasSource } from "./firebase.js";
import { RestSource } from "./rest-source.js";
import { ServerSource } from "./server-source.js";
import { mountCanvas } from "./canvas.js";

/**
 * Standalone entry: the canvas served on its own (`npm run dev:canvas`). Picks a
 * data source from local config + the URL deep link, then hands it to mountCanvas.
 * When embedded as a dashboard route the canvas is mounted directly (with a Clerk
 * token provider), so this file is bypassed entirely.
 */

/** Surface a project-access failure (not a member) as a blocking banner. */
function showAccessError(err: Error): void {
  const banner = document.createElement("div");
  banner.className = "access-error";
  banner.textContent = err.message;
  document.body.prepend(banner);
}

const config = loadConfig();
const projectId = config?.projectId ?? "project_xyz";

const source: CanvasSource = !config
  ? new FixtureSource(projectId)
  : config.mode === "server"
    ? new ServerSource(config.baseUrl, config.projectId, async () => config.token)
    : config.mode === "mock"
      ? new RestSource(config.databaseUrl, config.projectId)
      : new LiveSource(config.firebase, config.projectId, {
          ...config.options,
          onError: showAccessError,
        });

// Deep link (e.g. from the dashboard docs tab): #project=…&el=…&token=…
// Strip the token from the URL once read so the short-lived credential doesn't
// linger in the address bar or history; keep the element to focus.
const link = readLink();
if (link.token && typeof history !== "undefined") {
  const keep = new URLSearchParams();
  if (link.projectId) keep.set("project", link.projectId);
  if (link.el) keep.set("el", link.el);
  const hash = keep.toString();
  history.replaceState(
    null,
    "",
    location.pathname + location.search + (hash ? `#${hash}` : ""),
  );
}

console.info(`[canvas] source: ${config?.mode ?? "fixture"}, project "${projectId}"`);

const host = document.getElementById("app");
if (!host) throw new Error('Canvas mount point #app not found.');
mountCanvas({ container: host, source, focusElementId: link.el ?? null });
