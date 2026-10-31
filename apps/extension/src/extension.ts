import * as vscode from "vscode";
import {
  AgentNode,
  InfraFlow,
  InfraFlowStep,
  InfraKind,
  McpOrigin,
  McpServerNode,
  McpTransport,
  PRIORITY_LABELS,
  TYPE_LABELS,
  TaskPriority,
  TaskStatus,
  TaskType,
  applyTaskChange,
  digest,
  flattenTimelines,
  newTask,
  withoutBinding,
  type ApiBinding,
  type CheckpointInput,
  type CurrentLabel,
  type DesignElement,
  type Digest,
  type DigestItem,
  type Entity,
  type EntityRelation,
  type InfraEdge,
  type InfraNode,
  type InfraStepKind,
  type Task,
  type TaskPatch,
  type TimelineEvent,
} from "forward-core";
import {
  deleteAgentNode,
  deleteMcpServer,
  fetchAgents,
  saveAgentNode,
  saveMcpServer,
  bindApiToElement,
  createCheckpoint,
  deleteCheckpoint,
  deleteElement,
  deleteEntity,
  deleteEntityRelation,
  deleteInfraFlow,
  deleteInfraNode,
  deleteTask,
  fetchCheckpoints,
  fetchElements,
  fetchEntities,
  fetchFlows,
  fetchInfra,
  fetchProjectTimeline,
  fetchTasks,
  fetchTimelinesConditional,
  listElements,
  listMembers,
  restoreCheckpoint,
  saveElement,
  saveEntity,
  saveEntityRelation,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  saveTask,
  unbindApiFromElement,
  type ApiConfig,
} from "forward-core/api";
import {
  FORWARD_DIR,
  RepoStore,
  findRepoRoot,
  initRepo,
  repoConfig,
  resolveAuthor,
  validateRepo,
} from "forward-core/repo";
import { registerActionsView } from "./actionsView.js";
import { commentFor } from "./comment.js";
import { createRefresher } from "./refresher.js";
import {
  cycleWith,
  dayError,
  dueDateError,
  startDateError,
  taskName,
  taskPickItem,
} from "./task-fields.js";

// The canvas refreshes when `.forward/` or git's HEAD changes. The slow poll is a
// backstop for what a watcher can miss: a linked worktree (whose `.git` is a
// file), a network drive, or an OS out of watch handles.
const REFRESH_DEBOUNCE_MS = 100;
const FALLBACK_POLL_MS = 15_000;
const VALIDATE_DEBOUNCE_MS = 500;

export function activate(context: vscode.ExtensionContext): void {
  registerActionsView(context);
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "forward.connectEndpoint",
      connectEndpoint,
    ),
    vscode.commands.registerCommand("forward.insertAnchor", insertAnchor),
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
    vscode.commands.registerCommand("forward.addFlow", addFlow),
    vscode.commands.registerCommand("forward.addFlowStep", addFlowStep),
    vscode.commands.registerCommand("forward.removeFlow", removeFlow),
    vscode.commands.registerCommand("forward.addMcpServer", addMcpServer),
    vscode.commands.registerCommand("forward.removeMcpServer", removeMcpServer),
    vscode.commands.registerCommand("forward.addAgent", addAgent),
    vscode.commands.registerCommand("forward.removeAgent", removeAgent),
    vscode.commands.registerCommand("forward.createTask", createTask),
    vscode.commands.registerCommand(
      "forward.updateTaskStatus",
      updateTaskStatus,
    ),
    vscode.commands.registerCommand("forward.updateTask", updateTask),
    vscode.commands.registerCommand("forward.showTaskTimeline", () =>
      showTaskTimeline(context),
    ),
    vscode.commands.registerCommand("forward.validate", () => validateProject(true)),
    vscode.commands.registerCommand("forward.showHistory", showHistory),
    vscode.commands.registerCommand("forward.catchUp", catchUp),
    vscode.commands.registerCommand("forward.setupMcp", setupMcp),
    vscode.commands.registerCommand("forward.initRepo", initRepoCommand),
  );
  watchValidation(context);

  // Opt-in: open the canvas at startup, but only when it's actually configured
  // so we never throw a "set your config" toast on every launch.
  const c = vscode.workspace.getConfiguration("forward");
  if (
    c.get<boolean>("openCanvasOnStartup") &&
    activeRepoRoot()
  ) {
    void openCanvas(context);
  }
}

export function deactivate(): void {}

/**
 * The repository whose `.forward/` this workspace edits. There is no server,
 * sign-in or project picker: the project is the files, and git is the sync.
 */
function activeRepoRoot(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = findRepoRoot(folder.uri.fsPath);
    if (root) return root;
  }
  return undefined;
}

const repoConfigs = new Map<string, ApiConfig>();

/** Create `.forward/` in the first workspace folder. */
async function initRepoCommand(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage("Open a folder first — Forward stores the project in it.");
    return;
  }
  const { created, manifest } = initRepo(folder.uri.fsPath);
  repoConfigs.clear();
  validateProject();
  vscode.window.showInformationMessage(
    created
      ? `Created .forward/ for “${manifest.name}”. Commit it with your code; run “npx -y -p forward-mcp forward agents” to wire up AI agents.`
      : ".forward/ already exists in this workspace.",
  );
}

/**
 * Build the API config for a request: the workspace's `.forward/` project,
 * served in-process. Returns undefined (after offering to create a project)
 * when the workspace has none, so callers just bail.
 */
async function readConfig(): Promise<ApiConfig | undefined> {
  const repo = activeRepoRoot();
  if (!repo) {
    void vscode.window
      .showErrorMessage("No Forward project in this workspace.", "Initialize Forward here")
      .then((pick) => {
        if (pick) void vscode.commands.executeCommand("forward.initRepo");
      });
    return undefined;
  }
  let cfg = repoConfigs.get(repo);
  if (!cfg) {
    try {
      cfg = repoConfig(repo);
    } catch (err) {
      vscode.window.showErrorMessage(`Forward: ${(err as Error).message}`);
      return undefined;
    }
    repoConfigs.set(repo, cfg);
  }
  return cfg;
}

/**
 * Run a read a command depends on. The project is read in-process, so a failure
 * is real (an unreadable manifest, a permissions error), never "offline": show it
 * and return undefined so the caller stops, rather than reporting an empty project.
 */
async function load<T>(what: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (err) {
    vscode.window.showErrorMessage(`Forward: couldn't read ${what}: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Who is writing: the identity the store stamps on every write (`$FORWARD_AUTHOR`,
 * then git `user.name`, then the OS user). The store re-stamps a task's reporter
 * and activity, and a history entry's `author`, regardless.
 */
function currentAuthor(): string {
  const root = activeRepoRoot();
  return root ? resolveAuthor(root) : "unknown";
}

// ==========================================================================
// Validation — `forward validate` in the Problems panel, so what CI would flag
// (bad files, dangling links, non-ISO due dates, dependency cycles) shows up
// while editing.
// ==========================================================================

const diagnostics = vscode.languages.createDiagnosticCollection("forward");

/**
 * Validate the project into the Problems panel. `report` (the command) also says
 * what it found and opens the panel; the background run on file changes is silent.
 */
function validateProject(report = false): void {
  const root = activeRepoRoot();
  diagnostics.clear();
  if (!root) {
    if (report) void readConfig(); // offers to initialize
    return;
  }
  let issues: ReturnType<typeof validateRepo>;
  try {
    issues = validateRepo(root);
  } catch (err) {
    if (report) vscode.window.showErrorMessage(`Forward: validation failed: ${(err as Error).message}`);
    return;
  }
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const issue of issues) {
    const d = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      issue.message,
      issue.level === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    d.source = "forward";
    const list = byFile.get(issue.file) ?? [];
    list.push(d);
    byFile.set(issue.file, list);
  }
  for (const [file, list] of byFile) {
    diagnostics.set(vscode.Uri.joinPath(vscode.Uri.file(root), file), list);
  }
  if (!report) return;
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  if (!issues.length) {
    vscode.window.showInformationMessage("Forward: the project is valid.");
    return;
  }
  vscode.window.showWarningMessage(
    `Forward: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}` +
      (errors ? " — CI's forward validate will fail." : " — CI fails these only with --strict."),
  );
  void vscode.commands.executeCommand("workbench.actions.view.problems");
}

/** Validate on activation, then again whenever a `.forward/` file changes. */
function watchValidation(context: vscode.ExtensionContext): void {
  context.subscriptions.push(diagnostics);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => validateProject(), VALIDATE_DEBOUNCE_MS);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${FORWARD_DIR}/**`);
  watcher.onDidCreate(schedule);
  watcher.onDidChange(schedule);
  watcher.onDidDelete(schedule);
  context.subscriptions.push(watcher, { dispose: () => timer && clearTimeout(timer) });
  validateProject();
}

/**
 * Copy a ready-to-paste `claude mcp add forward …` command. The MCP server finds
 * `.forward/` from its working directory, so there is no URL or token to pass.
 */
async function setupMcp(): Promise<void> {
  await vscode.env.clipboard.writeText("claude mcp add forward -- npx -y forward-mcp");
  vscode.window.showInformationMessage(
    "Copied “claude mcp add forward -- npx -y forward-mcp”. Run it in this repository, then " +
      "restart your agent session. For Cursor, VS Code and Codex configs plus AGENTS.md, run " +
      "“npx -y -p forward-mcp forward agents”.",
  );
}

async function connectEndpoint(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  // Backend devs document elements the designers already drew. Pick one.
  const picked = await pickElement(cfg);
  if (!picked) return;
  await documentElement(cfg, picked.id);
}

/**
 * Insert an `@adc` anchor for a design element at the cursor, so the developer
 * never has to discover or transcribe the opaque element id. They pick the
 * element by name; we write a comment in the file's own syntax, carrying the
 * id (the stable link) plus the element name as a human-readable label:
 *
 *     // @adc el_mretvz0t "Celebrity sign-up"
 *
 * Resolution is always by id; the quoted label is for humans reading the diff
 * and lets `resolve_anchors` flag drift if the design is later renamed.
 */
async function insertAnchor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "Open the file where you implemented the endpoint, then run this command.",
    );
    return;
  }
  const cfg = await readConfig();
  if (!cfg) return;

  const picked = await pickElement(cfg, "Select the design element to anchor here");
  if (!picked) return;

  // A quoted label can't contain a double-quote (the anchor grammar ends it),
  // so soften any in the name to keep the anchor well-formed.
  const label = picked.name.trim().replace(/"/g, "'");
  const anchor = `@adc ${picked.id}${label ? ` "${label}"` : ""}`;

  const pos = editor.selection.active;
  const lineText = editor.document.lineAt(pos.line).text;
  const indent = lineText.match(/^[ \t]*/)?.[0] ?? "";
  const comment = commentFor(editor.document.languageId, anchor);

  await editor.edit((b) =>
    b.insert(new vscode.Position(pos.line, 0), `${indent}${comment}\n`),
  );
}

/**
 * Add or edit the documentation on one element. When `existing` is passed (an
 * edit), the prompts are pre-filled with the current values. The developer
 * writes the documentation by hand — no parsing, no framework assumptions —
 * so the same flow documents a REST route, a GraphQL resolver or a CLI command.
 */
async function documentElement(
  cfg: ApiConfig,
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

  // Only an edit can break clients; let the author flag it (left blank = none).
  // The structured doc diff is computed by the writer — we just supply the flag.
  const breaking = existing
    ? await vscode.window.showInputBox({
        prompt: "Breaking change? Describe it for clients, or leave blank.",
        placeHolder: "e.g. removed the `token` field from the response",
      })
    : undefined;

  try {
    await bindApiToElement(cfg, elementId, binding, {
      version: new Date().toISOString(),
      author: currentAuthor(),
      action: existing ? "modified" : "created",
      changeLog,
      ...(breaking ? { breaking } : {}),
    });
    vscode.window.showInformationMessage(
      `Documented ${elementId}: ${binding.title}`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/** Palette entry point: pick a documented element, then remove its docs. */
async function removeDocumentationCommand(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const elements = await load("the design elements", () => fetchElements(cfg));
  if (!elements) return;
  const documented = elements
    .filter((el) => el.apiBinding)
    .map((el) => ({ id: el.id, title: el.apiBinding?.title ?? el.id }));
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
  cfg: ApiConfig,
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
      author: currentAuthor(),
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

  return {
    title: title.trim(),
    description,
  };
}

// ==========================================================================
// Infrastructure layer (pillar 3) — project-scoped architecture diagram.
// Authored from the palette here, or on the canvas's Infra view.
// ==========================================================================

/**
 * Add one node (a tool / framework / database / DevOps resource) to the
 * project's infrastructure diagram. New nodes are tiled across the canvas so
 * several added in a row don't stack on the same spot.
 */
async function addInfraNode(): Promise<void> {
  const cfg = await readConfig();
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
    /* only the tiling slot is lost; the save below reports a real problem */
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
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/**
 * Document an MCP server the project exposes or consumes on the Agent / MCP
 * layer. New servers are tiled across the canvas so several added in a row don't
 * stack. Tools are added later (from the canvas drawer or an AI agent).
 */
async function addMcpServer(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const label = await vscode.window.showInputBox({
    prompt: "MCP server name (required)",
    placeHolder: "e.g. forward-mcp, github-mcp",
    validateInput: (v) => (v.trim() ? undefined : "A name is required."),
  });
  if (!label?.trim()) return;

  const transport = await vscode.window.showQuickPick([...McpTransport.options], {
    placeHolder: "How is this server reached?",
  });
  if (transport === undefined) return;

  const origin = await vscode.window.showQuickPick([...McpOrigin.options], {
    placeHolder: "Does the project expose (built) or consume this server?",
  });
  if (origin === undefined) return;

  const description = await vscode.window.showInputBox({
    prompt: "Notes (Markdown supported, optional)",
    placeHolder: "What it's for, auth, gotchas…",
  });
  if (description === undefined) return;

  let existing = 0;
  try {
    existing = (await fetchAgents(cfg)).servers.length;
  } catch {
    /* only the tiling slot is lost; the save below reports a real problem */
  }
  const server = McpServerNode.parse({
    id: `mcp_${Date.now().toString(36)}`,
    label: label.trim(),
    transport: McpTransport.parse(transport),
    origin: McpOrigin.parse(origin),
    description,
    tools: [],
    x: 80 + (existing % 5) * 220,
    y: 80,
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveMcpServer(cfg, server);
    vscode.window.showInformationMessage(`Added MCP server: ${server.label}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/**
 * Document an agent the project defines on the Agent / MCP layer — its model and
 * system prompt. Wiring to MCP servers (mcpServerIds) is added later from the
 * canvas or an AI agent.
 */
async function addAgent(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const label = await vscode.window.showInputBox({
    prompt: "Agent name (required)",
    placeHolder: "e.g. catch-up-digest agent",
    validateInput: (v) => (v.trim() ? undefined : "A name is required."),
  });
  if (!label?.trim()) return;

  const model = await vscode.window.showInputBox({
    prompt: "Model id (optional)",
    placeHolder: "e.g. claude-opus-4-8",
  });
  if (model === undefined) return;

  const systemPrompt = await vscode.window.showInputBox({
    prompt: "System prompt (Markdown, optional)",
    placeHolder: "The agent's instructions…",
  });
  if (systemPrompt === undefined) return;

  let existing = 0;
  try {
    existing = (await fetchAgents(cfg)).agents.length;
  } catch {
    /* only the tiling slot is lost; the save below reports a real problem */
  }
  const agent = AgentNode.parse({
    id: `agent_${Date.now().toString(36)}`,
    label: label.trim(),
    ...(model.trim() ? { model: model.trim() } : {}),
    systemPrompt,
    mcpServerIds: [],
    x: 80 + (existing % 5) * 220,
    y: 260,
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveAgentNode(cfg, agent);
    vscode.window.showInformationMessage(`Added agent: ${agent.label}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/**
 * Pick an MCP server, confirm, then remove it. The server drops it from any
 * agent's `mcpServerIds` so no dangling wiring is left behind — mirroring the
 * MCP `remove_mcp_server` tool.
 */
async function removeMcpServer(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const servers = await load("the MCP servers", async () => (await fetchAgents(cfg)).servers);
  if (!servers) return;
  if (!servers.length) {
    vscode.window.showWarningMessage("No MCP servers to remove.");
    return;
  }

  const choice = await vscode.window.showQuickPick(
    servers.map((s) => ({ label: s.label, description: s.transport, id: s.id })),
    { placeHolder: "Remove which MCP server?" },
  );
  if (!choice) return;

  const confirm = await vscode.window.showWarningMessage(
    `Remove MCP server "${choice.label}"?`,
    { modal: true },
    "Remove",
  );
  if (confirm !== "Remove") return;

  try {
    await deleteMcpServer(cfg, choice.id);
    vscode.window.showInformationMessage(`Removed MCP server: ${choice.label}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Remove failed: ${(err as Error).message}`);
  }
}

/** Pick an agent, confirm, then remove it (its MCP servers are left intact). */
async function removeAgent(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const agents = await load("the agents", async () => (await fetchAgents(cfg)).agents);
  if (!agents) return;
  if (!agents.length) {
    vscode.window.showWarningMessage("No agents to remove.");
    return;
  }

  const choice = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: a.label,
      description: a.model ?? "",
      id: a.id,
    })),
    { placeHolder: "Remove which agent?" },
  );
  if (!choice) return;

  const confirm = await vscode.window.showWarningMessage(
    `Remove agent "${choice.label}"?`,
    { modal: true },
    "Remove",
  );
  if (confirm !== "Remove") return;

  try {
    await deleteAgentNode(cfg, choice.id);
    vscode.window.showInformationMessage(`Removed agent: ${choice.label}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Remove failed: ${(err as Error).message}`);
  }
}

/** Draw a directed edge between two existing infra nodes. */
async function linkInfraNodes(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const nodes = await load("the infrastructure", async () => (await fetchInfra(cfg)).nodes);
  if (!nodes) return;
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
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/** Pick an infra node, confirm, then remove it along with its edges. */
async function removeInfraNode(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const nodes = await load("the infrastructure", async () => (await fetchInfra(cfg)).nodes);
  if (!nodes) return;
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

// ==========================================================================
// Narrated flows (pillar 3b) — sequence diagrams authored from the palette.
// A flow walks existing infra nodes, so add the nodes first; the canvas's Flows
// view renders and edits the result too. Mirrors the MCP write_flow /
// add_flow_step / remove_flow tools so the surfaces stay at parity.
// ==========================================================================

// `stepKind` (not `kind`) deliberately: QuickPickItem already reserves `kind`
// for its separator enum, and intersecting the two collapses the type to never.
const STEP_KIND_PICKS: (vscode.QuickPickItem & { stepKind: InfraStepKind })[] = [
  { label: "sync", description: "Solid request arrow (default)", stepKind: "sync" },
  { label: "async", description: "Open fire-and-forget arrow", stepKind: "async" },
  { label: "reply", description: "Dashed return arrow", stepKind: "reply" },
];

/**
 * Prompt for one flow step — from → to (both existing infra nodes), a label, and
 * a message style. Returns undefined if the user escapes any prompt.
 */
async function promptForStep(
  nodes: InfraNode[],
): Promise<InfraFlowStep | undefined> {
  const item = (n: InfraNode): vscode.QuickPickItem & { id: string } => ({
    label: n.label,
    description: n.kind,
    id: n.id,
  });
  const from = await vscode.window.showQuickPick(nodes.map(item), {
    placeHolder: "Step FROM which node?",
  });
  if (!from) return undefined;
  const to = await vscode.window.showQuickPick(nodes.map(item), {
    placeHolder: `"${from.label}" → TO which node?`,
  });
  if (!to) return undefined;
  const label = await vscode.window.showInputBox({
    prompt: "What happens in this step? (optional)",
    placeHolder: "e.g. POST /api/v1/users/login, check session, verify credentials",
  });
  if (label === undefined) return undefined;
  const kindPick = await vscode.window.showQuickPick(STEP_KIND_PICKS, {
    placeHolder: "Message style for this step",
  });
  if (!kindPick) return undefined;
  const condition = await vscode.window.showInputBox({
    prompt: "Branch guard? (optional — steps sharing one render as a Mermaid alt/else block)",
    placeHolder: "e.g. token valid, 409 duplicate — leave empty for an unconditional step",
  });
  if (condition === undefined) return undefined;
  return InfraFlowStep.parse({
    from: from.id,
    to: to.id,
    label: label.trim(),
    kind: kindPick.stepKind,
    ...(condition.trim() ? { condition: condition.trim() } : {}),
  });
}

/**
 * Author a narrated flow: name it, then add steps one at a time until done.
 * Saved as an InfraFlow that renders as a sequence diagram.
 */
async function addFlow(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const nodes = await load("the infrastructure", async () => (await fetchInfra(cfg)).nodes);
  if (!nodes) return;
  if (!nodes.length) {
    vscode.window.showWarningMessage(
      "Add at least one infra node before authoring a flow.",
    );
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Name of this flow (required)",
    placeHolder: "e.g. User login, Checkout, Webhook delivery",
    validateInput: (v) => (v.trim() ? undefined : "A name is required."),
  });
  if (!name?.trim()) return;

  const description = await vscode.window.showInputBox({
    prompt: "Overview (Markdown supported, optional)",
    placeHolder: "What this flow does end to end…",
  });
  if (description === undefined) return;

  // Collect ordered steps until the user picks "Done" (or escapes).
  const steps: InfraFlowStep[] = [];
  for (;;) {
    const step = await promptForStep(nodes);
    if (!step) break; // escape → stop and save what's there
    steps.push(step);
    const more = await vscode.window.showQuickPick(
      ["Add another step", "Done"],
      { placeHolder: `${steps.length} step(s) so far. Add another?` },
    );
    if (more !== "Add another step") break;
  }

  const flow: InfraFlow = InfraFlow.parse({
    id: `flow_${Date.now().toString(36)}`,
    name: name.trim(),
    description,
    steps,
    updatedAt: new Date().toISOString(),
  });
  try {
    await saveInfraFlow(cfg, flow);
    vscode.window.showInformationMessage(
      `Added flow "${flow.name}" (${steps.length} step${steps.length === 1 ? "" : "s"}).`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/** Append one step to the end of an existing flow. */
async function addFlowStep(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const flows = await load("the flows", () => fetchFlows(cfg));
  if (!flows) return;
  const nodes = await load("the infrastructure", async () => (await fetchInfra(cfg)).nodes);
  if (!nodes) return;
  if (!flows.length) {
    vscode.window.showWarningMessage(
      'No flows yet — create one with "Forward: Add Flow".',
    );
    return;
  }
  if (!nodes.length) {
    vscode.window.showWarningMessage("Add infra nodes before adding steps.");
    return;
  }

  const choice = await vscode.window.showQuickPick(
    flows.map((f) => ({
      label: f.name,
      description: `${f.steps.length} step(s)`,
      id: f.id,
    })),
    { placeHolder: "Append a step to which flow?" },
  );
  if (!choice) return;
  const flow = flows.find((f) => f.id === choice.id);
  if (!flow) return;

  const step = await promptForStep(nodes);
  if (!step) return;

  const next: InfraFlow = InfraFlow.parse({
    ...flow,
    steps: [...flow.steps, step],
    updatedAt: new Date().toISOString(),
  });
  try {
    await saveInfraFlow(cfg, next);
    vscode.window.showInformationMessage(
      `Added step to "${flow.name}" (${next.steps.length} total).`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/** Pick a flow, confirm, then delete it (infra nodes/edges are left intact). */
async function removeFlow(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const flows = await load("the flows", () => fetchFlows(cfg));
  if (!flows) return;
  if (!flows.length) {
    vscode.window.showWarningMessage("No flows to remove.");
    return;
  }

  const choice = await vscode.window.showQuickPick(
    flows.map((f) => ({
      label: f.name,
      description: `${f.steps.length} step(s)`,
      id: f.id,
    })),
    { placeHolder: "Remove which flow?" },
  );
  if (!choice) return;

  const confirm = await vscode.window.showWarningMessage(
    `Remove flow "${choice.label}"? (Infra nodes and edges are left intact.)`,
    { modal: true },
    "Remove",
  );
  if (confirm !== "Remove") return;

  try {
    await deleteInfraFlow(cfg, choice.id);
    vscode.window.showInformationMessage(`Removed flow: ${choice.label}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Remove failed: ${(err as Error).message}`);
  }
}

// ==========================================================================
// Task tracker (pillar 4) — project-scoped work items that optionally link to
// the design element the dev is documenting, with optional start/due dates and
// dependencies that the canvas draws as a timeline (Gantt). Mirrors the MCP
// create_task / update_task tools so the surfaces stay at parity.
// ==========================================================================

// `@adc <elementId>` source marker — the same anchor the MCP server resolves.
// The `@` must not be part of a larger token (so an email like user@adc.io is
// not mistaken for an anchor).
const ANCHOR_RE = /(?<![\w@])@adc[ \t]+([A-Za-z0-9_-]+)/;

/**
 * Pre-fill the task's element link from an `@adc <id>` anchor near the cursor in
 * the active editor — so filing a task from the endpoint you just anchored picks
 * the right element automatically. Returns the anchored id, or undefined.
 */
function anchoredElementId(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  // Look at the selection if there is one, else the whole current line.
  const sel = editor.selection;
  const range = sel.isEmpty ? editor.document.lineAt(sel.active.line).range : sel;
  const match = ANCHOR_RE.exec(editor.document.getText(range));
  return match?.[1];
}

const STATUS_PICKS: (vscode.QuickPickItem & { status: TaskStatus })[] = [
  { label: "todo", description: "Not started", status: "todo" },
  { label: "in_progress", description: "Being worked on", status: "in_progress" },
  { label: "blocked", description: "Waiting on something", status: "blocked" },
  { label: "done", description: "Complete", status: "done" },
];

/** Quick-pick rows for an enum with `first` on top, so Enter keeps it. */
function enumPicks<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  first: T,
  firstNote: string,
): (vscode.QuickPickItem & { value: T })[] {
  return [first, ...values.filter((v) => v !== first)].map((value) => ({
    label: labels[value],
    ...(value === first ? { description: firstNote } : {}),
    value,
  }));
}

/**
 * Ask for an optional ISO date. Returns "" when left empty (skip, or clear on an
 * update) and undefined when escaped.
 */
function askDay(
  prompt: string,
  value: string | undefined,
  validateInput: (v: string) => string | undefined,
): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    placeHolder: "YYYY-MM-DD — leave empty for none",
    value: value ?? "",
    validateInput,
  });
}

/**
 * Multi-pick the tasks one waits on. Returns undefined when escaped. Ids that no
 * longer match a task (a soft link to a deleted one) can't be shown, so they are
 * kept rather than silently dropped; `forward validate` reports them.
 */
async function askDependsOn(
  tasks: Task[],
  selfId: string | undefined,
  current: string[],
): Promise<string[] | undefined> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const others = tasks.filter((t) => t.id !== selfId);
  if (!others.length) return current;
  const picks = await vscode.window.showQuickPick(
    others.map((t) => ({ ...taskPickItem(t, byId), id: t.id, picked: current.includes(t.id) })),
    {
      canPickMany: true,
      placeHolder: "Depends on which tasks? (optional — pick none to skip)",
      matchOnDescription: true,
    },
  );
  if (!picks) return undefined;
  return [...picks.map((p) => p.id), ...current.filter((id) => !byId.has(id))];
}

/** Quick-pick a task. Returns undefined when there are none or the user escapes. */
async function pickTask(tasks: Task[], placeHolder: string): Promise<Task | undefined> {
  if (!tasks.length) {
    vscode.window.showWarningMessage('No tasks yet — create one with "Forward: Create Task".');
    return undefined;
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const choice = await vscode.window.showQuickPick(
    tasks.map((t) => ({ ...taskPickItem(t, byId), id: t.id })),
    { placeHolder, matchOnDescription: true, matchOnDetail: true },
  );
  return choice && byId.get(choice.id);
}

/**
 * File a new task. Title is mandatory; everything else optional — Enter keeps
 * each default, an empty date skips it. The task can be linked to a design
 * element — pre-selected from an `@adc` anchor under the cursor when present,
 * otherwise picked from the canvas elements.
 */
async function createTask(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;
  // Read first: the dependency picker lists them, and the new key follows theirs.
  const existing = await load("the tasks", () => fetchTasks(cfg));
  if (!existing) return;

  const title = await vscode.window.showInputBox({
    prompt: "Task title (required)",
    placeHolder: "e.g. Implement POST /auth/verify, wire signup flow",
    validateInput: (v) => (v.trim() ? undefined : "A title is required."),
  });
  if (!title?.trim()) return;

  const description = await vscode.window.showInputBox({
    prompt: "Details (Markdown supported, optional)",
    placeHolder: "Acceptance criteria, notes, links…",
  });
  if (description === undefined) return;

  const typePick = await vscode.window.showQuickPick(
    enumPicks(TaskType.options, TYPE_LABELS, "task", "default"),
    { placeHolder: "Type — a milestone is a single date on the timeline" },
  );
  if (!typePick) return;
  const milestone = typePick.value === "milestone";

  const statusPick = await vscode.window.showQuickPick(STATUS_PICKS, {
    placeHolder: "Status",
  });
  if (!statusPick) return;

  const priorityPick = await vscode.window.showQuickPick(
    enumPicks(TaskPriority.options, PRIORITY_LABELS, "medium", "default"),
    { placeHolder: "Priority" },
  );
  if (!priorityPick) return;

  // A milestone is one date, stored as its due date; a span gets start and due.
  let startDate = "";
  if (!milestone) {
    const start = await askDay("Start date (optional — defaults to today on the timeline)", "", dayError);
    if (start === undefined) return;
    startDate = start.trim();
  }
  const due = await askDay(
    milestone ? "Milestone date (optional)" : "Due date (optional)",
    "",
    (v) => dueDateError(v, startDate || undefined),
  );
  if (due === undefined) return;
  const dueDate = due.trim();

  const dependsOn = await askDependsOn(existing, undefined, []);
  if (!dependsOn) return;

  // Optionally link the task to a design element. Default to the anchored id
  // (from an `@adc` marker under the cursor) when there is one.
  let elementId = anchoredElementId();
  if (!elementId) {
    const elements = await load("the design elements", () => listElements(cfg));
    if (!elements) return;
    if (elements.length) {
      const items: Array<vscode.QuickPickItem & { id?: string }> = [
        { label: "— no design element —", id: undefined },
        ...elements.map((el) => ({
          label: el.name || el.id,
          description: el.type,
          detail: el.id,
          id: el.id,
        })),
      ];
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: "Link this task to a design element? (optional)",
        matchOnDetail: true,
      });
      if (!choice) return; // escaped — abort cleanly
      elementId = choice.id;
    }
  } else {
    vscode.window.showInformationMessage(
      `Linking task to anchored element ${elementId}.`,
    );
  }

  const task = newTask(
    {
      title: title.trim(),
      description,
      type: typePick.value,
      status: statusPick.status,
      priority: priorityPick.value,
      ...(startDate ? { startDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
      ...(elementId ? { elementId } : {}),
    },
    { actor: currentAuthor(), existingKeys: existing.map((t) => t.key) },
  );
  try {
    await saveTask(cfg, task);
    vscode.window.showInformationMessage(`Created task ${taskName(task)}: ${task.title}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Save failed: ${(err as Error).message}`);
  }
}

/** Save a changed task through the shared helper, so its activity feed records it. */
async function saveTaskChange(
  cfg: ApiConfig,
  prev: Task,
  patch: TaskPatch,
  done: string,
): Promise<void> {
  try {
    await saveTask(cfg, applyTaskChange(prev, patch, currentAuthor()));
    vscode.window.showInformationMessage(`${taskName(prev)}: ${done}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Update failed: ${(err as Error).message}`);
  }
}

/** Pick a task, then move it to a new status (the common "mark done" path). */
async function updateTaskStatus(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const tasks = await load("the tasks", () => fetchTasks(cfg));
  if (!tasks) return;
  const prev = await pickTask(tasks, "Update which task?");
  if (!prev) return;

  const statusPick = await vscode.window.showQuickPick(STATUS_PICKS, {
    placeHolder: "New status",
  });
  if (!statusPick) return;
  await saveTaskChange(cfg, prev, { status: statusPick.status }, `status → ${statusPick.status}`);
}

type TaskField = "status" | "startDate" | "dueDate" | "dependsOn" | "priority" | "type";

/**
 * Pick a task, then one field to change: status, schedule (start/due), the tasks
 * it depends on, priority or type. Mirrors the MCP update_task tool.
 */
async function updateTask(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const tasks = await load("the tasks", () => fetchTasks(cfg));
  if (!tasks) return;
  const prev = await pickTask(tasks, "Update which task?");
  if (!prev) return;

  const milestone = prev.type === "milestone";
  const deps = prev.dependsOn.length;
  const fields: (vscode.QuickPickItem & { field: TaskField })[] = [
    { label: "Status", description: prev.status, field: "status" },
    ...(milestone
      ? []
      : [{ label: "Start date", description: prev.startDate ?? "not set", field: "startDate" as const }]),
    {
      label: milestone ? "Milestone date" : "Due date",
      description: prev.dueDate ?? "not set",
      field: "dueDate",
    },
    { label: "Depends on", description: deps ? `${deps} task${deps === 1 ? "" : "s"}` : "none", field: "dependsOn" },
    { label: "Priority", description: PRIORITY_LABELS[prev.priority], field: "priority" },
    { label: "Type", description: TYPE_LABELS[prev.type], field: "type" },
  ];
  const pick = await vscode.window.showQuickPick(fields, { placeHolder: `Change what on ${taskName(prev)}?` });
  if (!pick) return;

  switch (pick.field) {
    case "status": {
      const s = await vscode.window.showQuickPick(STATUS_PICKS, { placeHolder: "New status" });
      if (s) await saveTaskChange(cfg, prev, { status: s.status }, `status → ${s.status}`);
      return;
    }
    case "startDate": {
      const v = await askDay("Start date — empty to clear", prev.startDate, (x) =>
        startDateError(x, prev.dueDate),
      );
      if (v === undefined) return;
      const startDate = v.trim() || undefined;
      await saveTaskChange(cfg, prev, { startDate }, startDate ? `starts ${startDate}` : "start date cleared");
      return;
    }
    case "dueDate": {
      // A legacy free-text due date is shown as-is; it must become an ISO date or
      // be cleared to save, the rule RepoStore.saveTask applies to any change.
      const v = await askDay(
        `${milestone ? "Milestone" : "Due"} date — empty to clear`,
        prev.dueDate,
        (x) => dueDateError(x, prev.startDate),
      );
      if (v === undefined) return;
      const dueDate = v.trim() || undefined;
      await saveTaskChange(cfg, prev, { dueDate }, dueDate ? `due ${dueDate}` : "due date cleared");
      return;
    }
    case "dependsOn": {
      const dependsOn = await askDependsOn(tasks, prev.id, prev.dependsOn);
      if (!dependsOn) return;
      const cycle = cycleWith(tasks, prev, dependsOn);
      if (cycle) {
        const go = await vscode.window.showWarningMessage(
          `This makes a dependency cycle: ${cycle}. Nothing in it can finish first, and forward validate will warn. Save anyway?`,
          { modal: true },
          "Save anyway",
        );
        if (go !== "Save anyway") return;
      }
      await saveTaskChange(cfg, prev, { dependsOn }, `depends on ${dependsOn.length} task${dependsOn.length === 1 ? "" : "s"}`);
      return;
    }
    case "priority": {
      const p = await vscode.window.showQuickPick(
        enumPicks(TaskPriority.options, PRIORITY_LABELS, prev.priority, "current"),
        { placeHolder: "Priority" },
      );
      if (p) await saveTaskChange(cfg, prev, { priority: p.value }, `priority → ${PRIORITY_LABELS[p.value]}`);
      return;
    }
    case "type": {
      const t = await vscode.window.showQuickPick(
        enumPicks(TaskType.options, TYPE_LABELS, prev.type, "current"),
        { placeHolder: "Type — a milestone is a single date on the timeline" },
      );
      if (t) await saveTaskChange(cfg, prev, { type: t.value }, `type → ${TYPE_LABELS[t.value]}`);
      return;
    }
  }
}

/** Open the canvas on its task timeline (Gantt), or switch an open one to it. */
async function showTaskTimeline(context: vscode.ExtensionContext): Promise<void> {
  await openCanvas(context, "timeline");
}

// ==========================================================================
// Documentation history + catch-up digest (the timeline pillar). Read-only
// views over the append-only version_timeline — the same data the canvas
// History tab and the MCP get_history / get_catchup_digest tools serve, so a
// backend dev can answer "how did this endpoint evolve?" and "what API changes
// do I need to deal with?" without leaving the editor.
// ==========================================================================

/** Catch-up baselines, matching the canvas timeline's window selector. */
const CATCHUP_WINDOWS: Record<string, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
  all: Number.POSITIVE_INFINITY,
};

/**
 * Load every endpoint event as one chronological stream (oldest → newest), the
 * same shape the canvas timeline renders. Labels come from each entry's own
 * snapshot first, then the element's current binding for live endpoints —
 * mirroring the MCP server's `loadTimelineEvents`.
 */
async function loadTimelineEvents(cfg: ApiConfig): Promise<TimelineEvent[]> {
  const [timelinesResult, elements] = await Promise.all([
    fetchTimelinesConditional(cfg, undefined),
    fetchElements(cfg),
  ]);
  const current: Record<string, CurrentLabel> = {};
  for (const el of elements) {
    if (el.apiBinding) current[el.id] = { title: el.apiBinding.title };
  }
  return flattenTimelines(timelinesResult?.timelines ?? {}, current);
}

/** Open text in a throwaway read-only markdown editor tab. */
async function showMarkdownDoc(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/** Render one endpoint's version history as Markdown, newest first. */
function renderHistory(title: string, events: TimelineEvent[]): string {
  const verb = (a: TimelineEvent["action"]): string =>
    a === "created" ? "Created" : a === "deleted" ? "Removed" : "Modified";
  const lines = [`# History — ${title}`, ""];
  for (const e of [...events].reverse()) {
    const when = new Date(e.timestamp).toLocaleString();
    const bump = e.previousVersion ? `v${e.previousVersion} → v${e.version}` : `v${e.version}`;
    lines.push(`## ${verb(e.action)} · ${bump}`, `*${when} — ${e.author}*`, "");
    const route = [e.method, e.path].filter(Boolean).join(" ");
    if (route) lines.push(`\`${route}\``, "");
    if (e.changeLog) lines.push(e.changeLog, "");
    lines.push("---", "");
  }
  return lines.join("\n");
}

/** Show the version history of one documented endpoint. */
async function showHistory(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  let events: TimelineEvent[] = [];
  try {
    events = await loadTimelineEvents(cfg);
  } catch (err) {
    vscode.window.showErrorMessage(`Couldn't load history: ${(err as Error).message}`);
    return;
  }
  if (!events.length) {
    vscode.window.showInformationMessage("No documentation history yet.");
    return;
  }

  // Group by element; label each from its most recent event.
  const byElement = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const list = byElement.get(e.elementId) ?? [];
    list.push(e);
    byElement.set(e.elementId, list);
  }
  const picks = [...byElement.values()].map((evs) => {
    const latest = evs[evs.length - 1] as TimelineEvent;
    return {
      label: latest.title,
      description: `${evs.length} version${evs.length === 1 ? "" : "s"}`,
      id: latest.elementId,
    };
  });
  const choice = await vscode.window.showQuickPick(picks, {
    placeHolder: "Show documentation history for which endpoint?",
  });
  if (!choice) return;

  await showMarkdownDoc(renderHistory(choice.label, byElement.get(choice.id) ?? []));
}

/** Render a catch-up digest as Markdown. */
function renderDigest(windowLabel: string, d: Digest): string {
  const section = (heading: string, items: DigestItem[]): string[] => {
    if (!items.length) return [`## ${heading} (0)`, "_None._", ""];
    const rows = items.map((it) => {
      const when = new Date(it.at.timestamp).toLocaleString();
      const route = [it.method, it.path].filter(Boolean).join(" ");
      return `- **${it.title}**${route ? ` — \`${route}\`` : ""} · ${it.at.author} · ${when}`;
    });
    return [`## ${heading} (${items.length})`, ...rows, ""];
  };
  return [
    `# Catch-up digest — ${windowLabel}`,
    "",
    "Net API changes to act on since the baseline (an endpoint created then " +
      "deleted in the window is a no-op).",
    "",
    ...section("To integrate — new endpoints", d.toIntegrate),
    ...section("To modify — changed endpoints", d.toModify),
    ...section("To remove — deleted endpoints", d.toRemove),
  ].join("\n");
}

/** Collapse endpoint changes since a chosen baseline into a catch-up digest. */
async function catchUp(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  const windowPick = await vscode.window.showQuickPick(
    [
      { label: "Last 24 hours", win: "24h" },
      { label: "Last 7 days", win: "7d" },
      { label: "Last 30 days", win: "30d" },
      { label: "All time", win: "all" },
    ],
    { placeHolder: "Catch up on endpoint changes since…" },
  );
  if (!windowPick) return;

  let events: TimelineEvent[] = [];
  try {
    events = await loadTimelineEvents(cfg);
  } catch (err) {
    vscode.window.showErrorMessage(`Couldn't load history: ${(err as Error).message}`);
    return;
  }

  const winMs = CATCHUP_WINDOWS[windowPick.win] ?? Number.POSITIVE_INFINITY;
  const sinceTs = Number.isFinite(winMs) ? Date.now() - winMs : 0;
  const d = digest(events, sinceTs);
  if (!d.toIntegrate.length && !d.toModify.length && !d.toRemove.length) {
    vscode.window.showInformationMessage(
      `No endpoint changes in the ${windowPick.label.toLowerCase()}.`,
    );
    return;
  }
  await showMarkdownDoc(renderDigest(windowPick.label, d));
}

/** The messages the canvas webview's bridge posts to the host. */
interface BridgeMessage {
  kind?: "sub" | "unsub" | "rpc";
  channel?: string;
  method?: string;
  id?: number;
  args?: unknown[];
}

/** The canvas task tracker's layout (forward-canvas's `TasksMode`). */
type TasksMode = "list" | "timeline";

/** The open canvas panel. There is one per window, so its refreshes never double up. */
let canvasPanel: vscode.WebviewPanel | undefined;

/**
 * Open the design canvas in a webview, or reveal the one already open. Rather
 * than a bespoke viewer, this mounts the real `forward-canvas` editor — identical
 * toolbar and full authoring (Layers / Data / Flows / Tasks / Infra / checkpoints)
 * to the canvas `forward serve` opens — and drives it through a postMessage
 * bridge. The webview's CanvasSource forwards every subscription and mutation
 * here, and the host answers them from the workspace's `.forward/` files. The
 * webview makes no requests of its own; the CSP forbids remote connections.
 * `tasksMode` opens (or switches) it to the task tracker in that layout.
 */
async function openCanvas(
  context: vscode.ExtensionContext,
  tasksMode?: TasksMode,
): Promise<void> {
  if (canvasPanel) {
    canvasPanel.reveal();
    if (tasksMode) void canvasPanel.webview.postMessage({ kind: "show-tasks", mode: tasksMode });
    return;
  }
  const cfg = await readConfig();
  const root = activeRepoRoot();
  if (!cfg || !root) return;

  const panel = vscode.window.createWebviewPanel(
    "forward.canvas",
    "Design Canvas",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  canvasPanel = panel;

  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
  );
  // The breadcrumb wants the project's display name; fall back silently to the id.
  let projectName: string | null = null;
  try {
    projectName = new RepoStore(root).manifest().name;
  } catch {
    /* unreadable manifest — the canvas still mounts with the id */
  }
  panel.webview.html = canvasHtml(panel.webview, scriptUri, {
    projectId: cfg.projectId,
    projectName,
    tasksMode: tasksMode ?? null,
  });

  // --- read side: refresh the subscribed channels when the files change -----
  // The canvas subscribes to each data channel once; the refresher posts a `snap`
  // only for a channel whose snapshot changed. Refreshes follow changes to
  // `.forward/` and to git's HEAD (the project timeline is git log) rather than a
  // fast poll: the timeline runs git synchronously, which blocks every extension
  // in the host while it runs.
  type Channel =
    | "elements"
    | "infra"
    | "entities"
    | "agents"
    | "tasks"
    | "checkpoints"
    | "timeline";

  const fetchers: Record<Channel, () => Promise<unknown>> = {
    elements: async () => {
      const [elements, { timelines }] = await Promise.all([
        fetchElements(cfg),
        fetchTimelinesConditional(cfg, undefined),
      ]);
      return elements.map((element) => ({
        element,
        timeline: timelines[element.id] ?? [],
      }));
    },
    infra: async () => {
      const [{ nodes, edges }, flows] = await Promise.all([
        fetchInfra(cfg),
        fetchFlows(cfg),
      ]);
      return { nodes, edges, flows };
    },
    entities: () => fetchEntities(cfg),
    agents: () => fetchAgents(cfg),
    tasks: () => fetchTasks(cfg),
    checkpoints: () => fetchCheckpoints(cfg),
    timeline: () => fetchProjectTimeline(cfg),
  };

  const refresher = createRefresher<Channel>({
    read: (channel) => fetchers[channel](),
    post: (channel, data) => void panel.webview.postMessage({ kind: "snap", channel, data }),
    visible: () => panel.visible,
    debounceMs: REFRESH_DEBOUNCE_MS,
    onError: (channel, err) => console.warn(`[canvas] ${channel} refresh failed:`, err),
  });
  const schedule = refresher.schedule;

  const watchers = [
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, `${FORWARD_DIR}/**`)),
    // A commit, checkout or reset appends to HEAD's reflog.
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, ".git/logs/HEAD")),
  ];
  for (const w of watchers) {
    w.onDidCreate(schedule);
    w.onDidChange(schedule);
    w.onDidDelete(schedule);
  }
  const fallback = setInterval(schedule, FALLBACK_POLL_MS);

  // --- write side: dispatch a bridge RPC to the matching server call ------
  const rpcHandlers: Record<string, (args: unknown[]) => Promise<unknown>> = {
    saveElement: ([el]) => saveElement(cfg, withoutBinding(el as DesignElement)),
    documentElement: ([id, binding, version]) =>
      bindApiToElement(cfg, id as string, binding as ApiBinding, {
        ...(version as { version: string; changeLog: string; action: "created" | "modified" }),
        author: currentAuthor(),
      }),
    undocumentElement: ([id, version]) =>
      unbindApiFromElement(cfg, id as string, {
        ...(version as { version: string; changeLog: string; title?: string }),
        author: currentAuthor(),
      }),
    deleteElement: ([id]) => deleteElement(cfg, id as string),
    saveInfraNode: ([n]) => saveInfraNode(cfg, n as InfraNode),
    deleteInfraNode: ([id]) => deleteInfraNode(cfg, id as string),
    saveInfraEdge: ([e]) => saveInfraEdge(cfg, e as InfraEdge),
    saveInfraFlow: ([f]) => saveInfraFlow(cfg, f as InfraFlow),
    deleteInfraFlow: ([id]) => deleteInfraFlow(cfg, id as string),
    saveEntity: ([e]) => saveEntity(cfg, e as Entity),
    deleteEntity: ([id]) => deleteEntity(cfg, id as string),
    saveEntityRelation: ([r]) => saveEntityRelation(cfg, r as EntityRelation),
    deleteEntityRelation: ([id]) => deleteEntityRelation(cfg, id as string),
    saveAgentNode: ([a]) => saveAgentNode(cfg, a as AgentNode),
    deleteAgentNode: ([id]) => deleteAgentNode(cfg, id as string),
    saveMcpServer: ([s]) => saveMcpServer(cfg, s as McpServerNode),
    deleteMcpServer: ([id]) => deleteMcpServer(cfg, id as string),
    saveTask: ([t]) => saveTask(cfg, t as Task),
    deleteTask: ([id]) => deleteTask(cfg, id as string),
    createCheckpoint: ([input]) => createCheckpoint(cfg, input as CheckpointInput),
    restoreCheckpoint: ([id]) => restoreCheckpoint(cfg, id as string),
    deleteCheckpoint: ([id]) => deleteCheckpoint(cfg, id as string),
    listMembers: () => listMembers(cfg),
  };

  panel.webview.onDidReceiveMessage(async (msg: BridgeMessage) => {
    if (msg?.kind === "sub" && msg.channel && Object.hasOwn(fetchers, msg.channel)) {
      refresher.subscribe(msg.channel as Channel);
      return;
    }
    if (msg?.kind === "unsub" && msg.channel) {
      refresher.unsubscribe(msg.channel as Channel);
      return;
    }
    if (msg?.kind !== "rpc" || typeof msg.id !== "number" || !msg.method) return;
    const handler = rpcHandlers[msg.method];
    if (!handler) {
      void panel.webview.postMessage({
        kind: "rpc-result",
        id: msg.id,
        ok: false,
        error: `Unknown method "${msg.method}".`,
      });
      return;
    }
    try {
      const value = await handler(msg.args ?? []);
      void panel.webview.postMessage({ kind: "rpc-result", id: msg.id, ok: true, value });
    } catch (err) {
      void panel.webview.postMessage({
        kind: "rpc-result",
        id: msg.id,
        ok: false,
        error: (err as Error).message,
      });
    }
    // Echo the stored result (stamped updatedAt, cascades) without waiting on a
    // watcher event.
    schedule();
  });

  // Catch up on what changed while the tab was hidden.
  panel.onDidChangeViewState(() => refresher.resume());

  panel.onDidDispose(() => {
    canvasPanel = undefined;
    clearInterval(fallback);
    for (const w of watchers) w.dispose();
    refresher.dispose();
  });
}

/**
 * The webview shell: a full-bleed mount point plus the bundled canvas script.
 * The mount config (project id/name, the task layout to open on) is injected as
 * a global so the editor mounts immediately without an extra round-trip. The
 * CSP allows the canvas's inline Shadow-DOM styles and Mermaid's `eval`, but no
 * remote origins — all I/O is bridged.
 */
function canvasHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  mount: { projectId: string; projectName: string | null; tasksMode: TasksMode | null },
): string {
  const nonce = Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join("");
  const csp =
    `default-src 'none'; ` +
    `img-src ${webview.cspSource} data: blob:; ` +
    `font-src ${webview.cspSource} data:; ` +
    `style-src ${webview.cspSource} 'unsafe-inline'; ` +
    `script-src 'nonce-${nonce}' 'unsafe-eval';`;
  // Escape `<` so the JSON can't break out of the inline <script>.
  const config = JSON.stringify(mount).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  #app { position: fixed; inset: 0; }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">window.__FORWARD_CONFIG__ = ${config};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Quick-pick of design elements that exist on the canvas. The backend can only
 * annotate elements the designer has already created — there is no "new element"
 * path here, which keeps the two sides from drifting.
 */
type PickedElement = { id: string; name: string; type: string };

async function pickElement(
  cfg: ApiConfig,
  placeHolder = "Select the design element to annotate with this endpoint",
): Promise<PickedElement | undefined> {
  const elements = await load("the design elements", () => listElements(cfg));
  if (!elements) return;

  if (!elements.length) {
    vscode.window.showWarningMessage(
      "No design elements found. Ask the designer to create one on the canvas first.",
    );
    return undefined;
  }

  const items: Array<vscode.QuickPickItem & { el: PickedElement }> = elements.map(
    (el) => ({
      label: el.name || el.id,
      description: el.type,
      detail: el.id,
      el,
    }),
  );
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDetail: true,
  });
  return choice?.el;
}
