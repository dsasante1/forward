import * as vscode from "vscode";
import { HttpMethod, type ApiBinding } from "@adc/shared";
import {
  bindApiToElement,
  fetchElements,
  listElements,
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

  // The developer writes the documentation by hand — no parsing, no framework
  // assumptions. Only `title` is required; the HTTP hints are optional, so the
  // same flow documents a REST route, a GraphQL resolver or a CLI command.
  const binding = await gatherDocumentation();
  if (!binding) return;

  const changeLog = await vscode.window.showInputBox({
    prompt: `Change log for "${binding.title}"`,
    value: "Update API documentation",
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

/**
 * Prompt the developer for the documentation to attach. Title is mandatory;
 * everything else is optional. Cancelling any required step (Esc) returns
 * undefined so the caller aborts cleanly.
 */
async function gatherDocumentation(): Promise<ApiBinding | undefined> {
  const title = await vscode.window.showInputBox({
    prompt: "Title for this API / endpoint (required)",
    placeHolder: "e.g. Login, Fetch user profile, createOrder mutation",
    validateInput: (v) => (v.trim() ? undefined : "A title is required."),
  });
  if (!title?.trim()) return undefined;

  const description = await vscode.window.showInputBox({
    prompt: "Documentation (Markdown supported)",
    placeHolder: "What it does, params, request/response, gotchas…",
  });
  if (description === undefined) return undefined;

  const language = await vscode.window.showInputBox({
    prompt: "Language / framework (optional)",
    placeHolder: "e.g. Python/FastAPI, Go, Node/Express, GraphQL",
  });
  if (language === undefined) return undefined;

  // Optional HTTP hints. Picking "none" documents a non-HTTP API.
  const methodPick = await vscode.window.showQuickPick(
    [...HttpMethod.options, NO_METHOD],
    { placeHolder: "HTTP method (optional)" },
  );
  if (methodPick === undefined) return undefined;
  const isHttp = methodPick !== NO_METHOD;

  let endpoint: string | undefined;
  if (isHttp) {
    endpoint = await vscode.window.showInputBox({
      prompt: "Endpoint / path (optional)",
      placeHolder: "/api/v1/users/:id",
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
  let last = "";
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
  };

  // The webview asks for the first frame once its script is live; from then on
  // the interval keeps it fresh.
  panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
    if (msg?.type === "ready") {
      last = ""; // force the next poll to emit
      void poll();
    }
  });

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
  body { margin: 0; padding: 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  .empty { opacity: 0.6; }
  #app { position: relative; }
  .world { position: relative; }
  .el { position: absolute; box-sizing: border-box; border: 1px solid var(--vscode-panel-border); overflow: visible; }
  .el-frame { background: rgba(127,127,127,0.06); }
  .el-text { border: none; }
  .el .el-text { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 12px; }
  .pin {
    position: absolute; top: -10px; right: -10px; z-index: 5;
    font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
    padding: 2px 5px; border: none; border-radius: 9px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .pin:hover { filter: brightness(1.15); }
  .doccard {
    position: absolute; top: 18px; right: 0; z-index: 10; cursor: default;
    width: 260px; max-height: 320px; overflow: auto; text-align: left;
    padding: 10px 12px; border-radius: 6px;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    font-weight: 400; letter-spacing: normal;
  }
  .doccard h4 { margin: 0 0 6px; font-size: 13px; }
  .doccard .tag { display: inline-block; font-size: 11px; opacity: 0.7; margin-bottom: 4px; }
  .doccard .route { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; margin-bottom: 6px; }
  .doccard .params { font-size: 11px; opacity: 0.7; margin-bottom: 6px; }
  .doccard .doc { font-size: 12px; line-height: 1.45; }
  .doccard code { font-family: var(--vscode-editor-font-family, monospace); background: rgba(127,127,127,0.2); padding: 0 3px; border-radius: 3px; }
</style>
</head>
<body>
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
