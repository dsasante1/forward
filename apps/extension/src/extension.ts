import * as vscode from "vscode";
import {
  HttpMethod,
  InfraKind,
  type ApiBinding,
  type InfraEdge,
  type InfraNode,
} from "forward-core";
import {
  bindApiToElement,
  deleteInfraNode,
  fetchElements,
  fetchElementsConditional,
  fetchInfra,
  fetchInfraConditional,
  fetchTimelinesConditional,
  listElements,
  saveInfraEdge,
  saveInfraNode,
  unbindApiFromElement,
  type FirebaseConfig,
  type InfraPollState,
} from "./firebase.js";

const NO_METHOD = "— none (not an HTTP endpoint) —";
const POLL_MS = 1000; // base cadence while the canvas is visible
const POLL_MAX_MS = 30000; // backoff ceiling after repeated failures

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "forward.connectEndpoint",
      connectEndpoint,
    ),
    vscode.commands.registerCommand("forward.openCanvas", () =>
      openCanvas(context),
    ),
    vscode.commands.registerCommand(
      "forward.removeDocumentation",
      removeDocumentationCommand,
    ),
    vscode.commands.registerCommand(
      "forward.addInfraNode",
      addInfraNode,
    ),
    vscode.commands.registerCommand(
      "forward.linkInfraNodes",
      linkInfraNodes,
    ),
    vscode.commands.registerCommand(
      "forward.removeInfraNode",
      removeInfraNode,
    ),
  );

  // Opt-in: open the canvas at startup, but only when it's actually configured
  // so we never throw a "set your config" toast on every launch.
  const c = vscode.workspace.getConfiguration("forward");
  if (
    c.get<boolean>("openCanvasOnStartup") &&
    c.get<string>("firebaseDatabaseUrl") &&
    c.get<string>("projectId")
  ) {
    openCanvas(context);
  }
}

export function deactivate(): void {}

function readConfig(): FirebaseConfig | undefined {
  const c = vscode.workspace.getConfiguration("forward");
  const databaseUrl = c.get<string>("firebaseDatabaseUrl") ?? "";
  const projectId = c.get<string>("projectId") ?? "";
  const authToken = c.get<string>("authToken") ?? "";
  if (!databaseUrl || !projectId) {
    vscode.window.showErrorMessage(
      "Set forward.firebaseDatabaseUrl and projectId in Settings (BYOD).",
    );
    return undefined;
  }
  return {
    databaseUrl,
    projectId,
    ...(authToken ? { authToken } : {}),
  };
}

async function connectEndpoint(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;

  // Backend devs document elements the designers already drew. Pick one.
  const elementId = await pickElement(cfg);
  if (!elementId) return;
  await documentElement(cfg, elementId);
}

/**
 * Add or edit the documentation on one element. When `existing` is passed (an
 * edit), the prompts are pre-filled with the current values. The developer
 * writes the documentation by hand — no parsing, no framework assumptions —
 * so the same flow documents a REST route, a GraphQL resolver or a CLI command.
 */
async function documentElement(
  cfg: FirebaseConfig,
  elementId: string,
  existing?: ApiBinding,
): Promise<void> {
  const binding = await gatherDocumentation(existing);
  if (!binding) return;

  const changeLog = await vscode.window.showInputBox({
    prompt: `Change log for "${binding.title}"`,
    value: existing ? "Update API documentation" : "Add API documentation",
  });
  if (changeLog === undefined) return;

  try {
    await bindApiToElement(cfg, elementId, binding, {
      version: new Date().toISOString(),
      author: process.env.USER ?? "unknown",
      action: existing ? "modified" : "created",
      changeLog,
    });
    vscode.window.showInformationMessage(
      `Documented ${elementId}: ${binding.title}`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

/**
 * Persist the free-form documentation the developer typed into the canvas inline
 * form. This is the no-prompt path: a single block of text arrives, and we turn
 * it into a binding — the first line becomes the label (`title`) and the rest is
 * the Markdown body (`description`). The change-log entry is generated
 * automatically — add vs. update is inferred from whether the element already
 * carried a binding.
 */
async function saveDocumentation(
  cfg: FirebaseConfig,
  elementId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return; // the form validates this, but guard the host too.

  const newline = trimmed.indexOf("\n");
  const title = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim();
  const description = newline === -1 ? "" : trimmed.slice(newline + 1).trim();
  const binding: ApiBinding = { title, description, parameters: [] };

  let existed = false;
  try {
    existed = !!(await fetchElements(cfg)).find((el) => el.id === elementId)
      ?.apiBinding;
  } catch {
    /* offline / unreachable — fall back to "Add" wording */
  }

  try {
    await bindApiToElement(cfg, elementId, binding, {
      version: new Date().toISOString(),
      author: process.env.USER ?? "unknown",
      action: existed ? "modified" : "created",
      changeLog: existed ? "Update API documentation" : "Add API documentation",
    });
    vscode.window.showInformationMessage(`Documented ${elementId}: ${binding.title}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

/** Palette entry point: pick a documented element, then remove its docs. */
async function removeDocumentationCommand(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;

  let documented: Array<{ id: string; title: string }> = [];
  try {
    documented = (await fetchElements(cfg))
      .filter((el) => el.apiBinding)
      .map((el) => ({ id: el.id, title: el.apiBinding?.title ?? el.id }));
  } catch {
    /* offline / unreachable */
  }
  if (!documented.length) {
    vscode.window.showWarningMessage("No documented elements to remove.");
    return;
  }

  const choice = await vscode.window.showQuickPick(
    documented.map((d) => ({ label: d.title, detail: d.id, id: d.id })),
    { placeHolder: "Remove documentation from which element?", matchOnDetail: true },
  );
  if (!choice) return;
  await removeDocumentation(cfg, choice.id, choice.label);
}

/** Confirm, then strip the binding off one element. Shared by command + canvas. */
async function removeDocumentation(
  cfg: FirebaseConfig,
  elementId: string,
  title?: string,
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Remove API documentation${title ? ` "${title}"` : ""} from ${elementId}?`,
    { modal: true },
    "Remove",
  );
  if (confirm !== "Remove") return;

  try {
    await unbindApiFromElement(cfg, elementId, {
      version: new Date().toISOString(),
      author: process.env.USER ?? "unknown",
      action: "deleted",
      ...(title ? { endpoint: { title } } : {}),
      changeLog: "Removed API documentation",
    });
    vscode.window.showInformationMessage(`Removed documentation from ${elementId}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Remove failed: ${(err as Error).message}`);
  }
}

/**
 * Prompt the developer for the documentation to attach. Title is mandatory;
 * everything else is optional. Cancelling any required step (Esc) returns
 * undefined so the caller aborts cleanly.
 */
async function gatherDocumentation(
  existing?: ApiBinding,
): Promise<ApiBinding | undefined> {
  const title = await vscode.window.showInputBox({
    prompt: "Title for this API / endpoint (required)",
    placeHolder: "e.g. Login, Fetch user profile, createOrder mutation",
    value: existing?.title ?? "",
    validateInput: (v) => (v.trim() ? undefined : "A title is required."),
  });
  if (!title?.trim()) return undefined;

  const description = await vscode.window.showInputBox({
    prompt: "Documentation (Markdown supported)",
    placeHolder: "What it does, params, request/response, gotchas…",
    value: existing?.description ?? "",
  });
  if (description === undefined) return undefined;

  const language = await vscode.window.showInputBox({
    prompt: "Language / framework (optional)",
    placeHolder: "e.g. Python/FastAPI, Go, Node/Express, GraphQL",
    value: existing?.language ?? "",
  });
  if (language === undefined) return undefined;

  // Optional HTTP hints. Picking "none" documents a non-HTTP API. The current
  // method (when editing) is floated to the top so it's the obvious default.
  const methodOptions = existing?.method
    ? [existing.method, ...HttpMethod.options.filter((m) => m !== existing.method), NO_METHOD]
    : [...HttpMethod.options, NO_METHOD];
  const methodPick = await vscode.window.showQuickPick(methodOptions, {
    placeHolder: "HTTP method (optional)",
  });
  if (methodPick === undefined) return undefined;
  const isHttp = methodPick !== NO_METHOD;

  let endpoint: string | undefined;
  if (isHttp) {
    endpoint = await vscode.window.showInputBox({
      prompt: "Endpoint / path (optional)",
      placeHolder: "/api/v1/users/:id",
      value: existing?.endpoint ?? "",
    });
    if (endpoint === undefined) return undefined;
  }

  return {
    title: title.trim(),
    description,
    ...(language.trim() ? { language: language.trim() } : {}),
    ...(isHttp ? { method: HttpMethod.parse(methodPick) } : {}),
    ...(endpoint?.trim() ? { endpoint: endpoint.trim() } : {}),
    parameters: endpoint ? pathParams(endpoint) : [],
  };
}

/** Extract `:param` style path params, e.g. /users/:id -> ["id"]. */
function pathParams(endpoint: string): string[] {
  const out: string[] = [];
  for (const m of endpoint.matchAll(/:([A-Za-z0-9_]+)/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

// ==========================================================================
// Infrastructure layer (pillar 3) — project-scoped architecture diagram.
// Authored entirely from the palette; both canvases render it read-only.
// ==========================================================================

/**
 * Add one node (a tool / framework / database / DevOps resource) to the
 * project's infrastructure diagram. New nodes are tiled across the canvas so
 * several added in a row don't stack on the same spot.
 */
async function addInfraNode(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;

  const kind = await vscode.window.showQuickPick([...InfraKind.options], {
    placeHolder: "What does this node represent?",
  });
  if (kind === undefined) return;

  const label = await vscode.window.showInputBox({
    prompt: "Name of this resource (required)",
    placeHolder: "e.g. PostgreSQL, GitHub Actions, Redis",
    validateInput: (v) => (v.trim() ? undefined : "A name is required."),
  });
  if (!label?.trim()) return;

  const tech = await vscode.window.showInputBox({
    prompt: "Version / runtime (optional)",
    placeHolder: "e.g. v15, Node 20",
  });
  if (tech === undefined) return;

  const description = await vscode.window.showInputBox({
    prompt: "Notes (Markdown supported, optional)",
    placeHolder: "Role in the system, config, gotchas…",
  });
  if (description === undefined) return;

  // Tile the node onto a grid based on how many already exist.
  let existing = 0;
  try {
    existing = (await fetchInfra(cfg)).nodes.length;
  } catch {
    /* offline / unreachable — fall back to the first slot */
  }
  const node: InfraNode = {
    id: `infra_${Date.now().toString(36)}`,
    kind: InfraKind.parse(kind),
    label: label.trim(),
    ...(tech.trim() ? { tech: tech.trim() } : {}),
    description,
    x: 80 + (existing % 5) * 200,
    y: 80 + Math.floor(existing / 5) * 140,
    width: 160,
    height: 72,
    parentId: null,
    updatedAt: new Date().toISOString(),
  };

  try {
    await saveInfraNode(cfg, node);
    vscode.window.showInformationMessage(`Added infra node: ${node.label}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

/** Draw a directed edge between two existing infra nodes. */
async function linkInfraNodes(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;

  let nodes: InfraNode[] = [];
  try {
    nodes = (await fetchInfra(cfg)).nodes;
  } catch {
    /* offline / unreachable */
  }
  if (nodes.length < 2) {
    vscode.window.showWarningMessage(
      "Add at least two infra nodes before linking them.",
    );
    return;
  }

  const item = (n: InfraNode): vscode.QuickPickItem & { id: string } => ({
    label: n.label,
    description: n.kind,
    id: n.id,
  });
  const from = await vscode.window.showQuickPick(nodes.map(item), {
    placeHolder: "Link FROM which node?",
  });
  if (!from) return;
  const to = await vscode.window.showQuickPick(
    nodes.filter((n) => n.id !== from.id).map(item),
    { placeHolder: `Link "${from.label}" TO which node?` },
  );
  if (!to) return;

  const label = await vscode.window.showInputBox({
    prompt: "Edge label (optional)",
    placeHolder: "e.g. reads/writes, publishes, calls",
  });
  if (label === undefined) return;

  const edge: InfraEdge = {
    id: `edge_${Date.now().toString(36)}`,
    from: from.id,
    to: to.id,
    ...(label.trim() ? { label: label.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  try {
    await saveInfraEdge(cfg, edge);
    vscode.window.showInformationMessage(
      `Linked ${from.label} → ${to.label}`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

/** Pick an infra node, confirm, then remove it along with its edges. */
async function removeInfraNode(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;

  let nodes: InfraNode[] = [];
  try {
    nodes = (await fetchInfra(cfg)).nodes;
  } catch {
    /* offline / unreachable */
  }
  if (!nodes.length) {
    vscode.window.showWarningMessage("No infra nodes to remove.");
    return;
  }

  const choice = await vscode.window.showQuickPick(
    nodes.map((n) => ({ label: n.label, description: n.kind, id: n.id })),
    { placeHolder: "Remove which infra node?" },
  );
  if (!choice) return;

  const confirm = await vscode.window.showWarningMessage(
    `Remove infra node "${choice.label}" and its connections?`,
    { modal: true },
    "Remove",
  );
  if (confirm !== "Remove") return;

  try {
    await deleteInfraNode(cfg, choice.id);
    vscode.window.showInformationMessage(`Removed infra node: ${choice.label}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Remove failed: ${(err as Error).message}`);
  }
}

/**
 * Open a read-only webview that renders the design and overlays a doc pin on
 * every element with an apiBinding. The host (not the webview) polls the RTDB
 * and posts elements in, so the auth token never leaves the extension process
 * and the webview CSP can forbid all network access.
 */
function openCanvas(context: vscode.ExtensionContext): void {
  const cfg = readConfig();
  if (!cfg) return;

  const panel = vscode.window.createWebviewPanel(
    "forward.canvas",
    "Design Canvas",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
  );
  panel.webview.html = canvasHtml(panel.webview, scriptUri);

  // Poll the database and push snapshots to the webview only when they change.
  // The design layer and the infrastructure layer are tracked independently so
  // a change to one doesn't force a redraw of the other. Change detection is
  // delegated to the server via ETags (conditional GETs): an unchanged subtree
  // returns a bodyless 304, so we skip the transfer, the parse, and the post.
  let elementsEtag: string | undefined;
  let infra: InfraPollState = { nodes: [], edges: [], flows: [] };
  let timelinesEtag: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let backoff = POLL_MS; // grows on consecutive failures, resets on success

  const poll = async () => {
    let ok = true;
    try {
      const next = await fetchElementsConditional(cfg, elementsEtag);
      if (next) {
        elementsEtag = next.etag;
        void panel.webview.postMessage({
          type: "elements",
          elements: next.elements,
          projectId: cfg.projectId,
        });
      }
    } catch (err) {
      ok = false;
      console.warn("[canvas] poll failed:", err);
    }
    try {
      const next = await fetchInfraConditional(cfg, infra);
      infra = next;
      if (next.changed) {
        void panel.webview.postMessage({
          type: "infra",
          nodes: next.nodes,
          edges: next.edges,
          flows: next.flows,
        });
      }
    } catch (err) {
      ok = false;
      console.warn("[canvas] infra poll failed:", err);
    }
    try {
      const next = await fetchTimelinesConditional(cfg, timelinesEtag);
      if (next) {
        timelinesEtag = next.etag;
        void panel.webview.postMessage({
          type: "timeline",
          timelines: next.timelines,
        });
      }
    } catch (err) {
      ok = false;
      console.warn("[canvas] timeline poll failed:", err);
    }
    // Reset to the base cadence on success; back off (capped) on failure so an
    // unreachable database isn't hammered every second.
    backoff = ok ? POLL_MS : Math.min(backoff * 2, POLL_MAX_MS);
  };

  // Self-scheduling loop (instead of a fixed setInterval) so it can honour the
  // backoff and stop cleanly while the panel is hidden.
  const loop = async () => {
    if (disposed || !panel.visible) return;
    await poll();
    if (disposed || !panel.visible) return;
    timer = setTimeout(() => void loop(), backoff);
  };

  const refresh = () => {
    elementsEtag = undefined; // drop ETags so the next poll re-emits every layer
    timelinesEtag = undefined;
    infra = { nodes: [], edges: [], flows: [] };
    if (timer) clearTimeout(timer);
    void loop();
  };

  // Pause polling entirely when the canvas tab is in the background (the webview
  // keeps its DOM via retainContextWhenHidden); resume with a fresh frame when
  // it comes back into view.
  panel.onDidChangeViewState(() => {
    if (disposed) return;
    if (panel.visible) {
      if (timer) clearTimeout(timer);
      void loop();
    } else if (timer) {
      clearTimeout(timer);
    }
  });

  // The webview asks for the first frame once its script is live; it also
  // forwards the save/delete actions the user triggers on the canvas. The
  // developer fills in the documentation inline on the canvas (no prompt flow),
  // so the canvas posts the whole binding back here in one "save" message.
  panel.webview.onDidReceiveMessage(
    async (msg: {
      type?: string;
      id?: string;
      title?: string;
      text?: string;
    }) => {
      switch (msg?.type) {
        case "ready":
          refresh();
          return;
        case "save":
          if (!msg.id || msg.text == null) return;
          await saveDocumentation(cfg, msg.id, msg.text);
          refresh();
          return;
        case "delete":
          if (!msg.id) return;
          await removeDocumentation(cfg, msg.id, msg.title);
          refresh();
          return;
      }
    },
  );

  // The "ready" message kicks off the first poll via refresh(); nothing to do
  // here but make sure the loop tears down with the panel.
  panel.onDidDispose(() => {
    disposed = true;
    if (timer) clearTimeout(timer);
  });
}

function canvasHtml(webview: vscode.Webview, scriptUri: vscode.Uri): string {
  const nonce = Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join("");
  const csp =
    `default-src 'none'; ` +
    `style-src ${webview.cspSource} 'unsafe-inline'; ` +
    `script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body {
    margin: 0; padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background-color: var(--vscode-editor-background);
    background-image:
      linear-gradient(to right, rgba(127,127,127,0.12) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(127,127,127,0.12) 1px, transparent 1px);
    background-size: 40px 40px;
    /* Grid scrolls with the canvas. Avoid background-attachment: fixed, which
       forces a full-viewport repaint on every pan/scroll frame. */
  }
  .empty { opacity: 0.6; padding: 16px; }
  .toolbar {
    position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 6px;
    padding: 6px 12px; background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .toolbar button {
    min-width: 26px; padding: 2px 8px; cursor: pointer; border: none; border-radius: 4px;
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .toolbar button:hover { filter: brightness(1.15); }
  .toolbar button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .toolbar #zoomLabel { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
  .toolbar .hint { margin-left: auto; opacity: 0.55; font-size: 11px; }
  #app { position: relative; padding: 16px; cursor: grab; }
  body.panning, body.panning #app { cursor: grabbing; user-select: none; }
  .world { position: relative; }
  .el { position: absolute; box-sizing: border-box; border: 1px solid var(--vscode-panel-border); overflow: visible; }
  .el-frame { background: rgba(127,127,127,0.06); }
  .el-text { border: none; }
  .el .el-text { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 12px; }
  .el .el-name { position: absolute; left: 0; bottom: 100%; margin-bottom: 4px; font-size: 10px; opacity: 0.7; white-space: nowrap; pointer-events: none; }
  /* documented elements: subtle accent cue, full leader callout on hover */
  .el.documented { cursor: pointer; }
  .el.documented:hover { border-color: var(--vscode-charts-blue, #5b8cff); }
  .doc-leader-layer {
    position: absolute; left: 0; top: 0; width: 100%; height: 100%;
    z-index: 8; overflow: visible; pointer-events: none;
  }
  .doc-leader { pointer-events: auto; cursor: pointer; }
  .doc-leader-line { fill: none; stroke: var(--vscode-charts-blue, #5b8cff); stroke-width: 1.5; }
  .doc-leader-dot { fill: var(--vscode-charts-blue, #5b8cff); }
  .doc-leader-bg {
    fill: var(--vscode-editorWidget-background, #14171f);
    stroke: var(--vscode-charts-blue, #5b8cff); stroke-width: 1;
  }
  .doc-leader-label { fill: var(--vscode-foreground); font-size: 12px; font-weight: 700; pointer-events: none; }
  .doc-leader-sub { fill: var(--vscode-descriptionForeground); font-size: 10px; pointer-events: none; }
  .addbtn {
    position: absolute; top: -10px; right: -10px; z-index: 4; opacity: 0;
    font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 9px; cursor: pointer;
    border: 1px dashed var(--vscode-panel-border); background: var(--vscode-editor-background);
    color: var(--vscode-foreground); transition: opacity 0.1s;
  }
  .el:hover > .addbtn { opacity: 0.85; }
  .addbtn:hover { opacity: 1; }
  .doccard {
    position: absolute; top: 18px; right: 0; z-index: 10; cursor: default;
    width: 260px; overflow: visible; text-align: left;
    padding: 10px 12px; border-radius: 6px;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    font-weight: 400; letter-spacing: normal;
  }
  .doccard .cardhead { display: flex; align-items: flex-start; gap: 6px; }
  .doccard h4 { flex: 1; margin: 0 0 6px; font-size: 13px; }
  .doccard .tag { display: inline-block; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .doccard .route { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; margin-bottom: 6px; }
  .doccard .params { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  .doccard .doc { font-size: 12px; line-height: 1.45; max-height: 220px; overflow: auto; }
  .doccard code { font-family: var(--vscode-editor-font-family, monospace); background: rgba(127,127,127,0.2); padding: 0 3px; border-radius: 3px; }
  /* kebab (⋮) menu */
  .doccard .kebabwrap { position: relative; flex: none; }
  .doccard .kebab {
    border: none; background: transparent; cursor: pointer; padding: 0 4px;
    font-size: 16px; line-height: 1; border-radius: 4px;
    color: var(--vscode-foreground);
  }
  .doccard .kebab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.2)); }
  .doccard .menu {
    position: absolute; top: 24px; right: 0; z-index: 20; min-width: 120px;
    display: flex; flex-direction: column; padding: 4px; border-radius: 6px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #252526));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border, var(--vscode-panel-border)));
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .doccard .menuitem {
    text-align: left; padding: 5px 10px; cursor: pointer; border: none; border-radius: 4px;
    background: transparent; color: inherit;
  }
  .doccard .menuitem:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-menu-selectionForeground, inherit);
  }
  .doccard .menuitem.danger:hover { background: var(--vscode-errorForeground, #c33); color: #fff; }
  /* --- inline documentation form: one free-form text box, no prompts --- */
  .docform { width: 300px; }
  .docform-input {
    box-sizing: border-box; width: 100%; padding: 6px 8px; font-size: 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  }
  .docform-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .docform-input.invalid { border-color: var(--vscode-errorForeground, #c33); }
  .docform-text {
    resize: vertical; min-height: 160px; line-height: 1.45;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .docform-error {
    min-height: 14px; margin: 6px 0; font-size: 11px;
    color: var(--vscode-errorForeground, #c33);
  }
  .docform-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .docform-actions button {
    padding: 4px 14px; font-size: 12px; cursor: pointer; border: none; border-radius: 4px;
  }
  .docform-save { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .docform-save:hover { filter: brightness(1.1); }
  .docform-cancel {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .docform-cancel:hover { filter: brightness(1.15); }
  /* --- infrastructure overlay --- */
  #infra { position: absolute; left: 0; top: 0; pointer-events: none; }
  #infraEdges { position: absolute; left: 0; top: 0; overflow: visible; }
  #infraEdges line { stroke: var(--vscode-charts-blue, #5b8cff); stroke-width: 1.5; }
  #infraEdges .edgelabel { fill: var(--vscode-descriptionForeground); font-size: 10px; }
  .infranode {
    position: absolute; box-sizing: border-box; pointer-events: auto;
    padding: 8px 10px; border-radius: 8px; cursor: default; overflow: hidden;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background, #252526);
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
  .infranode .ikind {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--vscode-descriptionForeground);
  }
  .infranode .ilabel { font-size: 13px; font-weight: 600; margin-top: 2px; }
  .infranode .itech { font-size: 11px; color: var(--vscode-descriptionForeground); }
  /* a left accent bar tints the node by kind */
  .infranode { border-left-width: 4px; border-left-style: solid; }
  .infranode.k-frontend { border-left-color: #5b8cff; }
  .infranode.k-backend  { border-left-color: #36c275; }
  .infranode.k-database { border-left-color: #c9a227; }
  .infranode.k-cache    { border-left-color: #d1603d; }
  .infranode.k-queue    { border-left-color: #b06ad6; }
  .infranode.k-service  { border-left-color: #3db6c9; }
  .infranode.k-devops   { border-left-color: #e0507a; }
  .infranode.k-external { border-left-color: #8a93a3; }
  .infranode.k-group {
    border-style: dashed; border-left-style: dashed; background: rgba(127,127,127,0.05);
  }
  /* a selected flow dims the nodes/edges it doesn't touch and lights the rest */
  .infranode.flow-dim { opacity: .25; }
  .infranode.flow-active { box-shadow: 0 0 0 2px #ffb020, 0 2px 6px rgba(0,0,0,0.3); }
  #infraEdges line.flow-edge-dim { opacity: .12; }
  #infraEdges line.flow-arrow { stroke: #ffb020; stroke-width: 2; }
  #infraEdges line.flow-arrow-async { stroke-dasharray: 6 4; }
  #infraEdges line.flow-arrow-reply { stroke: #36c275; }
  #infraEdges polygon.flow-arrowhead { fill: #ffb020; }
  #infraEdges polygon.flow-arrowhead-reply { fill: #36c275; }
  #infraEdges circle.flow-step-num-bg { fill: var(--vscode-editor-background, #0f1115); stroke: #ffb020; stroke-width: 1.5; }
  #infraEdges text.flow-step-num { fill: #ffb020; font-size: 11px; font-weight: 700; text-anchor: middle; }
  #infraEdges text.flow-step-label { fill: var(--vscode-foreground); font-size: 11px; }
  /* --- infrastructure flow panel (overlay, top-left) --- */
  #flowbar {
    position: fixed; top: 42px; left: 12px; width: 300px; z-index: 55;
    max-height: calc(100% - 60px); overflow: auto; padding: 12px 14px; border-radius: 8px;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  #flowbar[hidden] { display: none; }
  #flowbar h3 {
    margin: 0 0 8px; font-size: 11px; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  #flowbar select {
    width: 100%; padding: 4px 6px; border-radius: 4px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  }
  .flow-desc { font-size: 12px; opacity: .85; margin: 10px 0 6px; }
  .flow-steps { list-style: none; padding: 0; margin: 8px 0; }
  .flow-steps li {
    display: flex; gap: 9px; padding: 7px 0; font-size: 12px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  .flow-steps li:first-child { border-top: none; }
  .flow-step-n {
    flex: none; width: 18px; height: 18px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; color: #0f1115; background: #ffb020;
  }
  .flow-step-route { font-weight: 600; }
  .flow-step-route .flow-arrow-tok { opacity: .6; margin: 0 4px; }
  .flow-step-text { opacity: .85; }
  .flow-step-endpoint {
    display: inline-block; margin-top: 3px; font-size: 11px;
    color: var(--vscode-textLink-foreground, #5b8cff); cursor: pointer;
  }
  .flow-step-endpoint:hover { text-decoration: underline; }
  .flow-actions { display: flex; gap: 8px; margin-top: 6px; }
  .flow-btn {
    font: inherit; font-size: 11px; cursor: pointer; padding: 5px 10px; border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .flow-btn:hover { filter: brightness(1.15); }
  /* --- endpoint timeline panel (git-graph + catch-up digest) --- */
  #timeline {
    position: fixed; top: 42px; right: 12px; bottom: 12px; width: 380px; z-index: 60;
    overflow: auto; padding: 12px 14px; border-radius: 8px;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  #timeline[hidden] { display: none; }
  #timeline h3 {
    margin: 16px 0 6px; font-size: 11px; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .tl-head { display: flex; align-items: center; justify-content: space-between; }
  .tl-head h2 { margin: 0; font-size: 14px; }
  .tl-close {
    border: none; background: transparent; cursor: pointer; padding: 2px 6px;
    border-radius: 4px; font-size: 13px; color: var(--vscode-foreground);
  }
  .tl-close:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.2)); }
  .tl-since { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  .tl-since label { color: var(--vscode-descriptionForeground); }
  .tl-since select {
    flex: 1; padding: 3px 6px; border-radius: 4px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  }
  .tl-group-title {
    display: flex; gap: 8px; align-items: center;
    font-size: 12px; font-weight: 600; margin: 10px 0 2px;
  }
  .tl-count {
    font-size: 10px; padding: 1px 7px; border-radius: 99px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .tl-item {
    display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap;
    padding: 4px 6px; border-radius: 4px; cursor: pointer;
  }
  .tl-item:hover { background: var(--vscode-list-hoverBackground); }
  .tl-method { font-size: 10px; font-weight: 700; color: var(--vscode-charts-blue, #5b8cff); }
  .tl-title { font-size: 12px; font-weight: 600; }
  .tl-path { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; opacity: .75; }
  .tl-graph { display: flex; flex-direction: column; }
  .tl-row { display: flex; gap: 10px; cursor: pointer; border-radius: 4px; padding: 0 4px; }
  .tl-row:hover { background: var(--vscode-list-hoverBackground); }
  .tl-rail { flex: none; display: block; }
  .tl-rail line { stroke: var(--vscode-panel-border, #3a4250); stroke-width: 2; }
  .tl-node-created { fill: var(--vscode-charts-green, #36c275); }
  .tl-node-modified { fill: var(--vscode-charts-blue, #5b8cff); }
  .tl-node-deleted { fill: var(--vscode-charts-red, #e0507a); }
  .tl-info { min-width: 0; padding: 5px 0; }
  .tl-info > div > * + * { margin-left: 6px; }
  .tl-action { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .tl-action-created { color: var(--vscode-charts-green, #36c275); }
  .tl-action-modified { color: var(--vscode-charts-blue, #5b8cff); }
  .tl-action-deleted { color: var(--vscode-charts-red, #e0507a); }
  .tl-log { font-size: 11px; opacity: .85; }
  .tl-meta { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .tl-empty { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div class="toolbar">
  <button id="zoomOut" title="Zoom out">−</button>
  <span id="zoomLabel">100%</span>
  <button id="zoomIn" title="Zoom in">+</button>
  <button id="zoomFit" title="Fit to width">Fit</button>
  <button id="toggleDocs" title="Show/hide API documentation" aria-pressed="true">Docs</button>
  <button id="toggleInfra" title="Show/hide infrastructure diagram" aria-pressed="false">Infra</button>
  <button id="toggleTimeline" title="Show/hide the endpoint timeline" aria-pressed="false">Timeline</button>
  <span class="hint">Ctrl/⌘ + scroll to zoom</span>
</div>
<div id="app"></div>
<div id="flowbar" hidden></div>
<div id="timeline" hidden></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Quick-pick of design elements that exist on the canvas. The backend can only
 * annotate elements the designer has already created — there is no "new element"
 * path here, which keeps the two sides from drifting.
 */
async function pickElement(cfg: FirebaseConfig): Promise<string | undefined> {
  let elements: Array<{ id: string; name: string; type: string }> = [];
  try {
    elements = await listElements(cfg);
  } catch {
    /* offline / unreachable */
  }

  if (!elements.length) {
    vscode.window.showWarningMessage(
      "No design elements found. Ask the designer to create one on the canvas first.",
    );
    return undefined;
  }

  const items: Array<vscode.QuickPickItem & { id: string }> = elements.map(
    (el) => ({
      label: el.name || el.id,
      description: el.type,
      detail: el.id,
      id: el.id,
    }),
  );
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: "Select the design element to annotate with this endpoint",
    matchOnDetail: true,
  });
  return choice?.id;
}
