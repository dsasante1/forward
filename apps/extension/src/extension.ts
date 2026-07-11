import * as vscode from "vscode";
import {
  AgentNode,
  InfraFlow,
  InfraFlowStep,
  InfraKind,
  McpOrigin,
  McpServerNode,
  McpTransport,
  TaskStatus,
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
  type ProjectRole,
  type Task,
  type TimelineEvent,
} from "forward-core";
import {
  addMember,
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
  listProjects,
  removeMember,
  restoreCheckpoint,
  saveElement,
  saveEntity,
  saveEntityRelation,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  saveTask,
  unbindApiFromElement,
  updateMemberRole,
  type ApiConfig,
} from "forward-core/api";
import { registerActionsView } from "./actionsView.js";

const POLL_MS = 1000; // cadence each subscribed channel polls while visible

/** Key under which the Personal Access Token is held in VS Code SecretStorage. */
const PAT_SECRET_KEY = "forward.apiToken";

/**
 * The extension's secret store, set once in `activate`. The PAT lives here rather
 * than in settings.json (which is often committed): the token is the only
 * credential and must not leak — mirroring the server guard's "never in a query
 * string / never in logs" stance.
 */
let secrets: vscode.SecretStorage;

export function activate(context: vscode.ExtensionContext): void {
  secrets = context.secrets;
  registerActionsView(context);
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
    vscode.commands.registerCommand("forward.showHistory", showHistory),
    vscode.commands.registerCommand("forward.catchUp", catchUp),
    vscode.commands.registerCommand("forward.signIn", signIn),
    vscode.commands.registerCommand("forward.signOut", signOut),
    vscode.commands.registerCommand("forward.selectProject", selectProject),
  );

  // Opt-in: open the canvas at startup, but only when it's actually configured
  // so we never throw a "set your config" toast on every launch.
  const c = vscode.workspace.getConfiguration("forward");
  if (
    c.get<boolean>("openCanvasOnStartup") &&
    c.get<string>("apiBaseUrl") &&
    c.get<string>("projectId")
  ) {
    void openCanvas(context);
  }
}

export function deactivate(): void {}

/**
 * Build the API config for a request: base URL + project id from settings, and
 * the Personal Access Token from SecretStorage. Returns undefined (after showing
 * an actionable error) when anything required is missing, so callers just bail.
 */
async function readConfig(): Promise<ApiConfig | undefined> {
  const c = vscode.workspace.getConfiguration("forward");
  const baseUrl = c.get<string>("apiBaseUrl") ?? "";
  const projectId = c.get<string>("projectId") ?? "";
  if (!baseUrl) {
    vscode.window.showErrorMessage(
      "forward.apiBaseUrl is empty — restore the default Forward server URL in Settings.",
    );
    return undefined;
  }
  const token = await secrets.get(PAT_SECRET_KEY);
  if (!token) {
    void vscode.window
      .showErrorMessage(
        "Not signed in to Forward. Generate a token in the dashboard, then sign in.",
        "Sign in to Forward",
      )
      .then((pick) => {
        if (pick) void vscode.commands.executeCommand("forward.signIn");
      });
    return undefined;
  }
  if (!projectId) {
    void vscode.window
      .showErrorMessage("No Forward project selected.", "Select project")
      .then((pick) => {
        if (pick) void vscode.commands.executeCommand("forward.selectProject");
      });
    return undefined;
  }
  return { baseUrl, projectId, token };
}

/** Store a pasted PAT after verifying it can reach the server. */
async function signIn(): Promise<void> {
  const baseUrl =
    vscode.workspace.getConfiguration("forward").get<string>("apiBaseUrl") ?? "";
  if (!baseUrl) {
    vscode.window.showErrorMessage(
      "forward.apiBaseUrl is empty — restore the default Forward server URL in Settings before signing in.",
    );
    return;
  }
  const token = await vscode.window.showInputBox({
    title: "Sign in to Forward",
    prompt: "Paste a Personal Access Token (generate one in the dashboard → Account).",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "fwd_pat_…",
  });
  if (!token) return;
  try {
    // Validate by calling an authenticated account-level route.
    await listProjects(baseUrl, token);
  } catch {
    vscode.window.showErrorMessage(
      "That token was rejected by the server. Check the token and forward.apiBaseUrl.",
    );
    return;
  }
  await secrets.store(PAT_SECRET_KEY, token);
  vscode.window.showInformationMessage(
    "Signed in to Forward. Run “Forward: Select Project” to choose a project.",
  );
}

/** Forget the stored PAT. */
async function signOut(): Promise<void> {
  await secrets.delete(PAT_SECRET_KEY);
  vscode.window.showInformationMessage("Signed out of Forward.");
}

/** Pick from the projects the token can access and persist it to settings. */
async function selectProject(): Promise<void> {
  const c = vscode.workspace.getConfiguration("forward");
  const baseUrl = c.get<string>("apiBaseUrl") ?? "";
  const token = await secrets.get(PAT_SECRET_KEY);
  if (!baseUrl || !token) {
    void vscode.window
      .showErrorMessage(
        "Sign in to Forward first (and set forward.apiBaseUrl).",
        "Sign in to Forward",
      )
      .then((pick) => {
        if (pick) void vscode.commands.executeCommand("forward.signIn");
      });
    return;
  }
  let projects: Awaited<ReturnType<typeof listProjects>>;
  try {
    projects = await listProjects(baseUrl, token);
  } catch {
    vscode.window.showErrorMessage("Could not list projects from the server.");
    return;
  }
  if (projects.length === 0) {
    vscode.window.showWarningMessage(
      "You aren't a member of any Forward projects yet.",
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    projects.map((p) => ({ label: p.name, description: `${p.role} · ${p.id}`, id: p.id })),
    { title: "Select Forward project", placeHolder: "Annotate elements under…" },
  );
  if (!pick) return;
  await c.update("projectId", pick.id, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Forward project set to “${pick.label}”.`);
}

async function connectEndpoint(): Promise<void> {
  const cfg = await readConfig();
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
      author: process.env.USER ?? "unknown",
      action: existing ? "modified" : "created",
      changeLog,
      ...(breaking ? { breaking } : {}),
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
  cfg: ApiConfig,
  elementId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return; // the form validates this, but guard the host too.

  const newline = trimmed.indexOf("\n");
  const title = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim();
  const description = newline === -1 ? "" : trimmed.slice(newline + 1).trim();
  const binding: ApiBinding = { title, description };

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
  const cfg = await readConfig();
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

  return {
    title: title.trim(),
    description,
  };
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
    /* offline — fall back to the first slot */
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
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
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
    /* offline — fall back to the first slot */
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
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
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

  let servers: McpServerNode[] = [];
  try {
    servers = (await fetchAgents(cfg)).servers;
  } catch {
    /* offline / unreachable */
  }
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

  let agents: AgentNode[] = [];
  try {
    agents = (await fetchAgents(cfg)).agents;
  } catch {
    /* offline / unreachable */
  }
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
  const cfg = await readConfig();
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

// ==========================================================================
// Narrated flows (pillar 3b) — sequence diagrams authored from the palette.
// A flow walks existing infra nodes, so add the nodes first; both canvases and
// the Flows view render the result read-only. Mirrors the MCP write_flow /
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
  return InfraFlowStep.parse({
    from: from.id,
    to: to.id,
    label: label.trim(),
    kind: kindPick.stepKind,
  });
}

/**
 * Author a narrated flow: name it, then add steps one at a time until done.
 * Saved as an InfraFlow that renders as a sequence diagram.
 */
async function addFlow(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  let nodes: InfraNode[] = [];
  try {
    nodes = (await fetchInfra(cfg)).nodes;
  } catch {
    /* offline / unreachable */
  }
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
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

/** Append one step to the end of an existing flow. */
async function addFlowStep(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  let flows: InfraFlow[] = [];
  let nodes: InfraNode[] = [];
  try {
    flows = await fetchFlows(cfg);
    nodes = (await fetchInfra(cfg)).nodes;
  } catch {
    /* offline / unreachable */
  }
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
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

/** Pick a flow, confirm, then delete it (infra nodes/edges are left intact). */
async function removeFlow(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  let flows: InfraFlow[] = [];
  try {
    flows = await fetchFlows(cfg);
  } catch {
    /* offline / unreachable */
  }
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
// the design element the dev is documenting. Mirrors the MCP create_task /
// update_task tools so the surfaces stay at parity.
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

// The extension is a trusted admin client with no per-user identity; activity it
// writes to a task's feed is attributed to "extension".
const TASK_ACTOR = "extension";

/** Read the project's tasks, swallowing offline errors into an empty list. */
async function safeFetchTasks(cfg: ApiConfig): Promise<Task[]> {
  try {
    return await fetchTasks(cfg);
  } catch {
    return [];
  }
}

/**
 * File a new task. Title is mandatory; everything else optional. The task can be
 * linked to a design element — pre-selected from an `@adc` anchor under the
 * cursor when present, otherwise picked from the canvas elements.
 */
async function createTask(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

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

  const statusPick = await vscode.window.showQuickPick(STATUS_PICKS, {
    placeHolder: "Status",
  });
  if (!statusPick) return;

  // Optionally link the task to a design element. Default to the anchored id
  // (from an `@adc` marker under the cursor) when there is one.
  let elementId = anchoredElementId();
  if (!elementId) {
    const elements = await safeListElements(cfg);
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

  // Read existing tasks so the new one gets the next FWD-NN key.
  const existing = await safeFetchTasks(cfg);
  const task = newTask(
    {
      title: title.trim(),
      description,
      status: statusPick.status,
      ...(elementId ? { elementId } : {}),
    },
    { actor: TASK_ACTOR, existingKeys: existing.map((t) => t.key) },
  );
  try {
    await saveTask(cfg, task);
    vscode.window.showInformationMessage(`Created task: ${task.title}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Push failed: ${(err as Error).message}`);
  }
}

/** Pick a task, then move it to a new status (the common "mark done" path). */
async function updateTaskStatus(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;

  let tasks: Task[] = [];
  try {
    tasks = await fetchTasks(cfg);
  } catch {
    /* offline / unreachable */
  }
  if (!tasks.length) {
    vscode.window.showWarningMessage(
      'No tasks yet — create one with "Forward: Create Task".',
    );
    return;
  }

  const choice = await vscode.window.showQuickPick(
    tasks.map((t) => ({
      label: t.title,
      description: t.status,
      detail: t.elementId ? `linked to ${t.elementId}` : undefined,
      id: t.id,
    })),
    { placeHolder: "Update which task?" },
  );
  if (!choice) return;

  const statusPick = await vscode.window.showQuickPick(STATUS_PICKS, {
    placeHolder: "New status",
  });
  if (!statusPick) return;

  const prev = tasks.find((t) => t.id === choice.id);
  if (!prev) return;

  try {
    // Apply through the shared helper so the change is recorded in the task's
    // activity feed, exactly as the dashboard and canvas do.
    await saveTask(cfg, applyTaskChange(prev, { status: statusPick.status }, TASK_ACTOR));
    vscode.window.showInformationMessage(
      `"${choice.label}" → ${statusPick.status}`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Update failed: ${(err as Error).message}`);
  }
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

/** Read design elements, swallowing offline errors into an empty list. */
async function safeListElements(
  cfg: ApiConfig,
): Promise<Array<{ id: string; name: string; type: string }>> {
  try {
    return await listElements(cfg);
  } catch {
    return [];
  }
}

/** The messages the canvas webview's bridge posts to the host. */
interface BridgeMessage {
  kind?: "sub" | "unsub" | "rpc";
  channel?: string;
  method?: string;
  id?: number;
  args?: unknown[];
}

/**
 * Open the design canvas in a webview. Rather than a bespoke viewer, this mounts
 * the real `forward-canvas` editor — identical toolbar and full authoring
 * (Layers / Data / Flows / Tasks / Infra / checkpoints) to the dashboard's canvas —
 * and drives it through a postMessage bridge. The webview's CanvasSource forwards
 * every subscription and mutation here; the host answers them against the Forward
 * server. The access token never leaves the extension process (the webview makes
 * no network calls of its own) and the CSP forbids remote connections.
 */
async function openCanvas(context: vscode.ExtensionContext): Promise<void> {
  const cfg = await readConfig();
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
  // The breadcrumb wants the project's display name; fall back silently to the id.
  let projectName: string | null = null;
  try {
    projectName =
      (await listProjects(cfg.baseUrl, cfg.token)).find((p) => p.id === cfg.projectId)
        ?.name ?? null;
  } catch {
    /* offline / unreachable — the canvas still mounts with the id */
  }
  panel.webview.html = canvasHtml(panel.webview, scriptUri, cfg.projectId, projectName);

  let disposed = false;

  // --- read side: one poller per subscribed channel ----------------------
  // The canvas subscribes to each data channel once; we poll the server and post
  // a `snap` only when that channel's snapshot actually changed (mirroring
  // ServerSource), so an in-progress edit isn't clobbered. Polling pauses while
  // the tab is hidden and resumes when it returns.
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

  interface Poller {
    timer?: ReturnType<typeof setTimeout>;
    lastJson: string;
  }
  const pollers = new Map<Channel, Poller>();

  const pollChannel = async (channel: Channel): Promise<void> => {
    const poller = pollers.get(channel);
    if (!poller || disposed) return;
    poller.timer = undefined; // mark idle so a resume can re-arm it
    try {
      const data = await fetchers[channel]();
      const json = JSON.stringify(data);
      if (json !== poller.lastJson) {
        poller.lastJson = json;
        void panel.webview.postMessage({ kind: "snap", channel, data });
      }
    } catch (err) {
      console.warn(`[canvas] ${channel} poll failed:`, err);
    }
    if (disposed || !panel.visible) return;
    poller.timer = setTimeout(() => void pollChannel(channel), POLL_MS);
  };

  const startChannel = (channel: Channel): void => {
    if (pollers.has(channel)) return;
    pollers.set(channel, { lastJson: "" });
    void pollChannel(channel);
  };
  const stopChannel = (channel: Channel): void => {
    const poller = pollers.get(channel);
    if (poller?.timer) clearTimeout(poller.timer);
    pollers.delete(channel);
  };

  // --- write side: dispatch a bridge RPC to the matching server call ------
  const rpcHandlers: Record<string, (args: unknown[]) => Promise<unknown>> = {
    saveElement: ([el]) => saveElement(cfg, withoutBinding(el as DesignElement)),
    documentElement: ([id, binding, version]) =>
      bindApiToElement(cfg, id as string, binding as ApiBinding, {
        ...(version as { version: string; changeLog: string; action: "created" | "modified" }),
        author: process.env.USER ?? "unknown",
      }),
    undocumentElement: ([id, version]) =>
      unbindApiFromElement(cfg, id as string, {
        ...(version as { version: string; changeLog: string; title?: string }),
        author: process.env.USER ?? "unknown",
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
    addMember: ([uid, role]) => addMember(cfg, uid as string, role as ProjectRole | undefined),
    listMembers: () => listMembers(cfg),
    updateMemberRole: ([uid, role]) =>
      updateMemberRole(cfg, uid as string, role as ProjectRole),
    removeMember: ([uid]) => removeMember(cfg, uid as string),
  };

  panel.webview.onDidReceiveMessage(async (msg: BridgeMessage) => {
    if (msg?.kind === "sub" && msg.channel) {
      startChannel(msg.channel as Channel);
      return;
    }
    if (msg?.kind === "unsub" && msg.channel) {
      stopChannel(msg.channel as Channel);
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
  });

  // Resume the active channels' polling when the tab returns to the foreground
  // (it pauses itself while hidden, since pollChannel bails on !panel.visible).
  panel.onDidChangeViewState(() => {
    if (disposed || !panel.visible) return;
    for (const [channel, poller] of pollers) {
      if (!poller.timer) void pollChannel(channel);
    }
  });

  panel.onDidDispose(() => {
    disposed = true;
    for (const channel of [...pollers.keys()]) stopChannel(channel);
  });
}

/**
 * The webview shell: a full-bleed mount point plus the bundled canvas script.
 * The project id/name are injected as a global so the editor mounts immediately
 * without an extra round-trip. The CSP allows the canvas's inline Shadow-DOM
 * styles and Mermaid's `eval`, but no remote origins — all I/O is bridged.
 */
function canvasHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  projectId: string,
  projectName: string | null,
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
  const config = JSON.stringify({ projectId, projectName }).replace(/</g, "\\u003c");

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
async function pickElement(cfg: ApiConfig): Promise<string | undefined> {
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
