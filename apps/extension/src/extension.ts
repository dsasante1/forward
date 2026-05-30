import * as vscode from "vscode";
import { parseHighlightedCode } from "./parser.js";
import { listNodeIds, pushEndpoint, type FirebaseConfig } from "./firebase.js";

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
  if (!databaseUrl || !projectId) {
    vscode.window.showErrorMessage(
      "Set apiDesignConnector.firebaseDatabaseUrl and projectId in Settings (BYOD).",
    );
    return undefined;
  }
  return { databaseUrl, projectId };
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

  // Let the user pick an existing canvas node or type a new id — avoids drift
  // between the editor and the canvas.
  const nodeId = await pickNodeId(cfg);
  if (!nodeId) return;

  const changeLog = await vscode.window.showInputBox({
    prompt: `Change log for ${payload.method} ${payload.endpoint}`,
    value: "Update endpoint contract",
  });
  if (changeLog === undefined) return;

  try {
    await pushEndpoint(cfg, nodeId, payload, {
      version: new Date().toISOString(),
      author: process.env.USER ?? "unknown",
      changeLog,
    });
    vscode.window.showInformationMessage(
      `Connected ${payload.method} ${payload.endpoint} → ${nodeId}`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

async function pickNodeId(cfg: FirebaseConfig): Promise<string | undefined> {
  let existing: string[] = [];
  try {
    existing = await listNodeIds(cfg);
  } catch {
    /* offline / empty project — fall through to free text */
  }
  const NEW = "$(add) New canvas node…";
  const choice = await vscode.window.showQuickPick([NEW, ...existing], {
    placeHolder: "Select a canvas node to bind this route to",
  });
  if (!choice) return undefined;
  if (choice !== NEW) return choice;
  return vscode.window.showInputBox({ prompt: "New canvas node id" });
}
