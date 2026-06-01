import * as vscode from "vscode";
import {
  HttpMethod,
  InfraKind,
  type ApiBinding,
  type InfraEdge,
  type InfraNode,
} from "@adc/shared";
import {
  bindApiToElement,
  deleteInfraNode,
  fetchElements,
  fetchInfra,
  listElements,
  saveInfraEdge,
  saveInfraNode,
  unbindApiFromElement,
  type FirebaseConfig,
} from "./firebase.js";

const NO_METHOD = "— none (not an HTTP endpoint) —";
const POLL_MS = 1000;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "api-design-connector.connectEndpoint",
      connectEndpoint,
    ),
    vscode.commands.registerCommand("api-design-connector.openCanvas", () =>
      openCanvas(context),
    ),
    vscode.commands.registerCommand(
      "api-design-connector.removeDocumentation",
      removeDocumentationCommand,
    ),
    vscode.commands.registerCommand(
      "api-design-connector.addInfraNode",
      addInfraNode,
    ),
    vscode.commands.registerCommand(
      "api-design-connector.linkInfraNodes",
      linkInfraNodes,
    ),
    vscode.commands.registerCommand(
      "api-design-connector.removeInfraNode",
      removeInfraNode,
    ),
  );

  // Opt-in: open the canvas at startup, but only when it's actually configured
  // so we never throw a "set your config" toast on every launch.
  const c = vscode.workspace.getConfiguration("apiDesignConnector");
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
  const c = vscode.workspace.getConfiguration("apiDesignConnector");
  const databaseUrl = c.get<string>("firebaseDatabaseUrl") ?? "";
  const projectId = c.get<string>("projectId") ?? "";
  const authToken = c.get<string>("authToken") ?? "";
  if (!databaseUrl || !projectId) {
    vscode.window.showErrorMessage(
      "Set apiDesignConnector.firebaseDatabaseUrl and projectId in Settings (BYOD).",
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
      changeLog,
    });
    vscode.window.showInformationMessage(
      `Documented ${elementId}: ${binding.title}`,
    );
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
    "apiDesignConnector.canvas",
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
  // a change to one doesn't force a redraw of the other.
  let last = "";
  let lastInfra = "";
  let timer: ReturnType<typeof setInterval> | undefined;

  const poll = async () => {
    try {
      const elements = await fetchElements(cfg);
      const json = JSON.stringify(elements);
      if (json !== last) {
        last = json;
        void panel.webview.postMessage({
          type: "elements",
          elements,
          projectId: cfg.projectId,
        });
      }
    } catch (err) {
      console.warn("[canvas] poll failed:", err);
    }
    try {
      const infra = await fetchInfra(cfg);
      const infraJson = JSON.stringify(infra);
      if (infraJson !== lastInfra) {
        lastInfra = infraJson;
        void panel.webview.postMessage({
          type: "infra",
          nodes: infra.nodes,
          edges: infra.edges,
        });
      }
    } catch (err) {
      console.warn("[canvas] infra poll failed:", err);
    }
  };

  const refresh = () => {
    last = ""; // force the next poll to emit both layers
    lastInfra = "";
    void poll();
  };

  // The webview asks for the first frame once its script is live; it also
  // forwards the add/edit/delete actions the user triggers on the canvas.
  panel.webview.onDidReceiveMessage(
    async (msg: { type?: string; id?: string; title?: string }) => {
      switch (msg?.type) {
        case "ready":
          refresh();
          return;
        case "document":
        case "edit": {
          if (!msg.id) return;
          let existing: ApiBinding | undefined;
          if (msg.type === "edit") {
            try {
              existing = (await fetchElements(cfg)).find(
                (el) => el.id === msg.id,
              )?.apiBinding;
            } catch {
              /* fall back to a blank form */
            }
          }
          await documentElement(cfg, msg.id, existing);
          refresh();
          return;
        }
        case "delete":
          if (!msg.id) return;
          await removeDocumentation(cfg, msg.id, msg.title);
          refresh();
          return;
      }
    },
  );

  timer = setInterval(() => void poll(), POLL_MS);
  panel.onDidDispose(() => {
    if (timer) clearInterval(timer);
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
    background-attachment: fixed;
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
  .pin {
    position: absolute; top: -10px; right: -10px; z-index: 5;
    font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
    padding: 2px 5px; border: none; border-radius: 9px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .pin:hover { filter: brightness(1.15); }
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
  <span class="hint">Ctrl/⌘ + scroll to zoom</span>
</div>
<div id="app"></div>
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
