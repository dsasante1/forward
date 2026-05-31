import * as vscode from "vscode";
import {
  bindApiToElement,
  listElements,
  type FirebaseConfig,
} from "./firebase.js";
import { parseHighlightedCode } from "./parser.js";

export function activate(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand(
    "api-design-connector.connectEndpoint",
    connectEndpoint,
  );
  context.subscriptions.push(cmd);
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
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.document.getText(editor.selection);
  const payload = parseHighlightedCode(selection);
  if (!payload) {
    vscode.window.showWarningMessage(
      "No Express-style route found in the selection.",
    );
    return;
  }

  const cfg = readConfig();
  if (!cfg) return;

  // Backend devs annotate elements the designers already drew. Pick one.
  const elementId = await pickElement(cfg);
  if (!elementId) return;

  const changeLog = await vscode.window.showInputBox({
    prompt: `Change log for ${payload.method} ${payload.endpoint}`,
    value: "Update endpoint contract",
  });
  if (changeLog === undefined) return;

  try {
    await bindApiToElement(cfg, elementId, payload, {
      version: new Date().toISOString(),
      author: process.env.USER ?? "unknown",
      changeLog,
    });
    vscode.window.showInformationMessage(
      `Annotated ${elementId} with ${payload.method} ${payload.endpoint}`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
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
