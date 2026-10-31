import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  AgentNode,
  ApiBinding,
  CaptureSnapshot,
  DesignElement,
  MAX_IMPORT_ELEMENTS,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraFlowStep,
  InfraNode,
  McpServerNode,
  Style,
  Task,
  agentsToComponentMermaid,
  applyTaskChange,
  commentOnTask,
  dayToIso,
  digest,
  entityToMermaid,
  findDependencyCycles,
  flattenTimelines,
  flowToMermaid,
  infraToComponentMermaid,
  mapSnapshot,
  newTask,
  placeSnapshots,
  taskSpan,
  tasksToMermaidGantt,
  withoutBinding,
  type CaptureNode,
  type CurrentLabel,
} from "forward-core";
import {
  bindApiToElement,
  deleteAgentNode,
  deleteElement,
  deleteEntity,
  deleteInfraFlow,
  deleteInfraNode,
  deleteMcpServer,
  deleteTask,
  fetchAgents,
  fetchElements,
  fetchEntities,
  fetchFlows,
  fetchInfra,
  fetchTasks,
  fetchTimelinesConditional,
  importDesign,
  listMembers,
  patchElement,
  saveAgentNode,
  saveElement,
  saveEntity,
  saveEntityRelation,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  saveMcpServer,
  saveTask,
  unbindApiFromElement,
  type ApiConfig,
} from "forward-core/api";
import {
  checkoutForwardAt,
  diffProjects,
  findRepoRoot,
  loadBundle,
  refExists,
  renderDiffMarkdown,
  repoConfig,
  resolveAuthor,
  validateRepo,
} from "forward-core/repo";
import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findAnchorsInSource, resolveAnchors, scanPath } from "./anchor.js";
import { captureLive, parseViewport } from "./capture.js";
import { insideRepo, parseSource, planAnchors, writeAnchors, type AnchorOutcome } from "./import-anchors.js";
import { VERSION } from "./version.js";
import type { AnchorElement } from "./anchor.js";
import { rankElements } from "./match.js";

/**
 * Forward — the agent tool surface.
 *
 * Every capability an AI agent has in Forward is registered here, once, on one
 * McpServer. Two front doors share it:
 *   - `server.ts` serves it over MCP stdio (Claude Code, Codex, Cursor, …);
 *   - `cli.ts` calls the very same tools in-process (`forward call <tool>`), so
 *     an agent without MCP — or a shell script, or CI — gets identical behaviour.
 *
 * Each tool talks to `forward-core/api`, served in-process from the `.forward/`
 * directory of the git repository. There is no server and no credential: an
 * agent's writes are ordinary file changes that git reviews and versions.
 * Stdout is reserved for the MCP protocol, so all logging goes to stderr.
 */

const AGENT = process.env.FORWARD_AGENT || process.env.ADC_AGENT || "agent";

/** Which project this process serves, resolved once from env + cwd. */
export type ForwardMode =
  | { kind: "repo"; root: string; projectId: string }
  | { kind: "unconfigured"; reason: string };

let cached: { cfg: ApiConfig; mode: ForwardMode } | undefined;

/**
 * The project is the nearest `.forward/forward.json` above the working
 * directory, or the repository `$FORWARD_REPO` points at, served straight from
 * disk. Thrown errors surface to the agent as a tool error saying what to do,
 * rather than crashing the server.
 */
export function getConfig(): ApiConfig {
  if (cached) return cached.cfg;
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new Error(
      "No Forward project found. Run `forward init` in the repository root to create " +
        ".forward/, or point FORWARD_REPO at a repository that has one.",
    );
  }
  const via = process.env.FORWARD_AGENT || process.env.ADC_AGENT;
  const author = via ? `${resolveAuthor(root)} via ${via}` : undefined;
  const cfg = repoConfig(root, author ? { author } : {});
  cached = { cfg, mode: { kind: "repo", root, projectId: cfg.projectId } };
  return cfg;
}

/** The resolved mode, without throwing. */
export function currentMode(): ForwardMode {
  try {
    getConfig();
    return cached!.mode;
  } catch (err) {
    return { kind: "unconfigured", reason: (err as Error).message };
  }
}

/** The repository root; a readable error when there is no project. */
function requireRepo(): string {
  const mode = currentMode();
  if (mode.kind === "repo") return mode.root;
  throw new Error(mode.reason);
}

/** Stable JSON tool result. */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Error tool result the agent can read and relay to the user. */
function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** A client-side id for a new infra node/edge, mirroring the canvas' scheme. */
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Catch-up baselines, matching the canvas timeline's window selector. */
const WINDOWS: Record<string, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
  all: Number.POSITIVE_INFINITY,
};

/**
 * Load every endpoint event as one chronological stream (oldest → newest), the
 * same shape the canvas timeline renders. Labels come from each entry's own
 * snapshot first, then the element's current binding for live endpoints.
 */
async function loadTimelineEvents(cfg: ApiConfig) {
  const [timelinesResult, elements] = await Promise.all([
    fetchTimelinesConditional(cfg, undefined),
    fetchElements(cfg),
  ]);
  const current: Record<string, CurrentLabel> = {};
  for (const el of elements) {
    if (el.apiBinding) {
      current[el.id] = { title: el.apiBinding.title };
    }
  }
  return flattenTimelines(timelinesResult?.timelines ?? {}, current);
}

export const server = new McpServer({
  name: "forward",
  version: VERSION,
});

// --- orientation: where am I? ---------------------------------------------
server.registerTool(
  "project_info",
  {
    title: "Project info",
    description:
      "Start here. Reports which Forward project this server is connected to: the project " +
      "lives in .forward/ inside the git repository, and every write is a file change you " +
      "should commit with the code. Also returns counts per layer so you know what already exists.",
    inputSchema: {},
  },
  async () => {
    try {
      const cfg = getConfig();
      const mode = currentMode();
      const [elements, infra, entities, agents, tasks] = await Promise.all([
        fetchElements(cfg),
        fetchInfra(cfg),
        fetchEntities(cfg),
        fetchAgents(cfg),
        fetchTasks(cfg),
      ]);
      const flows = await fetchFlows(cfg);
      return ok({
        mode,
        projectId: cfg.projectId,
        counts: {
          designElements: elements.length,
          documentedEndpoints: elements.filter((e) => e.apiBinding).length,
          importedFromCode: elements.filter((e) => e.origin).length,
          infraNodes: infra.nodes.length,
          infraEdges: infra.edges.length,
          flows: flows.length,
          entities: entities.entities.length,
          relations: entities.relations.length,
          agents: agents.agents.length,
          mcpServers: agents.servers.length,
          tasks: tasks.length,
        },
        hint:
          "Writes land in .forward/ as one JSON file per record. Commit them alongside " +
          "the code they describe; run validate_project before committing.",
      });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

server.registerTool(
  "validate_project",
  {
    title: "Validate the .forward/ directory",
    description:
      "Checks every file in .forward/ against the Forward schema, that file " +
      "names match record ids, that ids are unique, and (as warnings) that cross-layer links " +
      "resolve, that task due dates are ISO dates, that task dependencies have no cycles, and that " +
      "task assignees are on the contributor roster. " +
      "Run it before committing; CI runs the same check on pull requests (`forward validate " +
      "--strict` fails on warnings too).",
    inputSchema: {},
  },
  async () => {
    try {
      const issues = validateRepo(requireRepo());
      const errors = issues.filter((i) => i.level === "error").length;
      return ok({ valid: errors === 0, errors, warnings: issues.length - errors, issues });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

server.registerTool(
  "get_changes_since_ref",
  {
    title: "What changed since a git ref",
    description:
      "Compares the project at a git ref (branch, tag or commit — e.g. " +
      "`origin/main` or `HEAD~5`) with the working tree: new / changed / removed endpoint docs " +
      "with line diffs, plus added/changed/removed records in every other layer. Use it to " +
      "brief a frontend dev, write a PR description, or check your own work before committing.",
    inputSchema: {
      ref: z.string().min(1).describe("Git ref to compare against, e.g. origin/main."),
      format: z
        .enum(["markdown", "json"])
        .default("markdown")
        .describe("markdown for a ready-to-paste digest, json for structured data."),
    },
  },
  async ({ ref, format }) => {
    try {
      const root = requireRepo();
      if (!refExists(root, ref)) return fail(`Unknown git ref "${ref}".`);
      const baseRoot = checkoutForwardAt(root, ref);
      try {
        const before = baseRoot && existsSync(join(baseRoot, ".forward", "forward.json"))
          ? loadBundle(baseRoot, { timeline: false })
          : undefined;
        const diff = diffProjects(before, loadBundle(root, { timeline: false }));
        return format === "json"
          ? ok(diff)
          : { content: [{ type: "text" as const, text: renderDiffMarkdown(diff, { title: `Forward changes since ${ref}` }) }] };
      } finally {
        if (baseRoot) rmSync(baseRoot, { recursive: true, force: true });
      }
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: what the designers drew ----------------------------------------
server.registerTool(
  "list_design_elements",
  {
    title: "List design elements",
    description:
      "List every design element on the canvas for this project (id, name, type, text, " +
      "whether it already has API documentation, and — for drafts generated from code — the " +
      "route/component it came from). Start here to see what you can document.",
    inputSchema: {},
  },
  async () => {
    try {
      const elements = await fetchElements(getConfig());
      return ok(
        elements.map((el) => ({
          id: el.id,
          name: el.name,
          type: el.type,
          ...(el.text ? { text: el.text } : {}),
          documented: Boolean(el.apiBinding),
          docTitle: el.apiBinding?.title,
          ...(el.origin ? { fromCode: { route: el.origin.route, ...(el.origin.component ? { component: el.origin.component } : {}) } } : {}),
        })),
      );
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- the linking step: feature description -> design element ---------------
server.registerTool(
  "find_element",
  {
    title: "Find a design element",
    description:
      "Find which design element best matches a feature you just built, by ranking the " +
      "canvas elements against a natural-language description (e.g. \"login form\", " +
      "\"user profile page\"). Returns candidates best-first with a match score. When the " +
      "top score is low or two candidates are close, confirm the element id with the user " +
      "before documenting.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("Natural-language description of the feature/endpoint to locate."),
      limit: z
        .number()
        .int()
        .positive()
        .max(20)
        .optional()
        .describe("Max candidates to return (default 5)."),
    },
  },
  async ({ query, limit }) => {
    try {
      const elements = await fetchElements(getConfig());
      const ranked = rankElements(query, elements).slice(0, limit ?? 5);
      return ok(ranked);
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- deterministic linking: in-code @adc anchors --------------------------
server.registerTool(
  "resolve_anchors",
  {
    title: "Resolve in-code @adc anchors",
    description:
      "Find `@adc <elementId>` anchors in source code and resolve each to its design element " +
      "— the deterministic alternative to find_element. Pass a file or directory `path` to " +
      "scan, or raw `source` text. Each anchor pins code to a design element unambiguously, so " +
      "prefer this over fuzzy matching whenever the developer has anchored their code. An anchor " +
      "may carry an optional quoted label (`@adc <id> \"Login button\"`); the result echoes it and " +
      "sets `labelDrifted` when it no longer matches the element's current name. The result also " +
      "flags anchors whose elementId doesn't exist (typos / stale ids).",
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe("File or directory to scan for @adc anchors."),
      source: z
        .string()
        .optional()
        .describe("Raw source text to scan, as an alternative to `path`."),
      file: z
        .string()
        .optional()
        .describe("Optional label for where `source` came from."),
    },
  },
  async ({ path, source, file }) => {
    try {
      if (!path && source == null) {
        return fail("Provide `path` (a file or directory to scan) or `source` text.");
      }
      const anchors = [
        ...(source != null ? findAnchorsInSource(source, file) : []),
        ...(path ? await scanPath(path) : []),
      ];

      // Cross-check each anchor against the live design elements so typos and
      // stale ids surface instead of silently writing nowhere. If the database
      // is unreachable we still return the anchors, just unvalidated.
      let byId = new Map<string, AnchorElement>();
      let warning: string | undefined;
      try {
        byId = new Map(
          (await fetchElements(getConfig())).map((e) => [
            e.id,
            { name: e.name, type: e.type, documented: Boolean(e.apiBinding) },
          ]),
        );
      } catch (err) {
        warning = `Anchors not validated against the canvas: ${(err as Error).message}`;
      }

      const resolved = resolveAnchors(anchors, byId, !warning);
      return ok({ count: resolved.length, ...(warning ? { warning } : {}), anchors: resolved });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read one element's current docs (before editing) ----------------------
server.registerTool(
  "get_documentation",
  {
    title: "Get documentation for an element",
    description:
      "Read the API documentation currently attached to one design element, or null if it " +
      "has none. Call this before write_documentation when editing, so you preserve what's there.",
    inputSchema: {
      elementId: z.string().min(1).describe("The design element id."),
    },
  },
  async ({ elementId }) => {
    try {
      const el = (await fetchElements(getConfig())).find((e) => e.id === elementId);
      if (!el) return fail(`No design element with id "${elementId}".`);
      return ok(el.apiBinding ?? null);
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: attach docs to a specific element ------------------------------
server.registerTool(
  "write_documentation",
  {
    title: "Write documentation onto an element",
    description:
      "Attach (or replace) API documentation on one design element, linking the design to the " +
      "code you just wrote. title + Markdown description carry the meaning, for any kind of " +
      "binding (REST, GraphQL, gRPC, CLI, jobs). The change is appended to the element's version " +
      "history. The canvas updates live.",
    inputSchema: {
      elementId: z.string().min(1).describe("Target design element id (from find_element)."),
      title: ApiBinding.shape.title.describe("Short label for the endpoint/feature."),
      description: ApiBinding.shape.description.describe(
        "Markdown docs: what it does, params, request/response, gotchas.",
      ),
      changeLog: z
        .string()
        .optional()
        .describe("One-line summary of this change for the version history."),
    },
  },
  async ({ elementId, changeLog, ...fields }) => {
    try {
      const cfg = getConfig();
      const existed = Boolean(
        (await fetchElements(cfg)).find((e) => e.id === elementId)?.apiBinding,
      );
      const binding = ApiBinding.parse(fields);
      await bindApiToElement(cfg, elementId, binding, {
        version: new Date().toISOString(),
        author: AGENT,
        action: existed ? "modified" : "created",
        changeLog:
          changeLog ?? (existed ? "Update API documentation" : "Add API documentation"),
      });
      return ok({ elementId, title: binding.title, action: existed ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove an element's docs ---------------------------------------
server.registerTool(
  "remove_documentation",
  {
    title: "Remove documentation from an element",
    description:
      "Strip the API documentation off one design element (the design element itself is " +
      "untouched). Records the removal in the version history.",
    inputSchema: {
      elementId: z.string().min(1).describe("The design element id to clear."),
      changeLog: z.string().optional().describe("Why it was removed."),
    },
  },
  async ({ elementId, changeLog }) => {
    try {
      const cfg = getConfig();
      // Snapshot the endpoint's title before removing so the timeline can still
      // label the deletion (its binding is about to be gone).
      const title = (await fetchElements(cfg)).find((e) => e.id === elementId)
        ?.apiBinding?.title;
      await unbindApiFromElement(cfg, elementId, {
        version: new Date().toISOString(),
        author: AGENT,
        action: "deleted",
        ...(title ? { endpoint: { title } } : {}),
        changeLog: changeLog ?? "Removed API documentation",
      });
      return ok({ elementId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: one element's version history -----------------------------------
server.registerTool(
  "get_history",
  {
    title: "Get an element's documentation history",
    description:
      "Read the append-only version history of one design element's API documentation " +
      "(every created / modified / deleted event, oldest → newest), including author, change " +
      "log, version and any structured diff. Use this to see how an endpoint's docs evolved; " +
      "for the project-wide \"what changed since…\" view use get_catchup_digest instead.",
    inputSchema: {
      elementId: z.string().min(1).describe("The design element id."),
    },
  },
  async ({ elementId }) => {
    try {
      const events = (await loadTimelineEvents(getConfig())).filter(
        (e) => e.elementId === elementId,
      );
      return ok({ elementId, count: events.length, events });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: project catch-up digest since a baseline ------------------------
server.registerTool(
  "get_catchup_digest",
  {
    title: "Catch up on endpoint changes since a baseline",
    description:
      "Collapse every endpoint change since a baseline into the net to-integrate / to-modify / " +
      "to-remove lists a frontend dev acts on — the same catch-up digest the canvas timeline " +
      "shows. An endpoint created-then-deleted in the window is a no-op; created-then-modified " +
      "is just \"new\". Use this to answer \"what API changes do I need to deal with?\"",
    inputSchema: {
      since: z
        .enum(["24h", "7d", "30d", "all"])
        .optional()
        .describe("Baseline window to measure changes from (default 7d)."),
    },
  },
  async ({ since }) => {
    try {
      const events = await loadTimelineEvents(getConfig());
      const winMs = WINDOWS[since ?? "7d"] ?? Number.POSITIVE_INFINITY;
      const sinceTs = Number.isFinite(winMs) ? Date.now() - winMs : 0;
      const d = digest(events, sinceTs);
      return ok({
        since: since ?? "7d",
        counts: {
          toIntegrate: d.toIntegrate.length,
          toModify: d.toModify.length,
          toRemove: d.toRemove.length,
        },
        ...d,
      });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: the infrastructure graph ----------------------------------------
server.registerTool(
  "list_infra",
  {
    title: "List the infrastructure diagram",
    description:
      "Read the project's infrastructure graph — the nodes (frontend / backend / database / " +
      "cache / queue / service / devops / external / group) and the directed edges between " +
      "them. This is the architecture overlay, separate from the design elements. Start here " +
      "before writing to see what already exists and to reuse node ids when connecting them. " +
      "Also returns `componentDiagram`: the graph rendered as a component diagram (Mermaid) " +
      "ready to paste into docs.",
    inputSchema: {},
  },
  async () => {
    try {
      const { nodes, edges } = await fetchInfra(getConfig());
      return ok({
        nodes,
        edges,
        componentDiagram: infraToComponentMermaid(nodes, edges),
      });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: create or update an infra node ---------------------------------
server.registerTool(
  "write_infra_node",
  {
    title: "Create or update an infrastructure node",
    description:
      "Add a box to the architecture diagram (or update one by passing its id), e.g. a " +
      "PostgreSQL database or a background worker. kind drives its colour/icon; label is the " +
      "display name. Geometry is optional — designers reposition nodes on the canvas — so omit " +
      "x/y to drop it at a default spot. Returns the node id (use it with connect_infra).",
    inputSchema: {
      id: InfraNode.shape.id
        .optional()
        .describe("Existing node id to update; omit to create a new node."),
      kind: InfraNode.shape.kind.describe(
        "Node category: frontend, backend, database, cache, queue, service, devops, external, group.",
      ),
      label: InfraNode.shape.label.describe('Display name, e.g. "PostgreSQL".'),
      tech: InfraNode.shape.tech.describe('Optional version/runtime tag, e.g. "v15".'),
      env: InfraNode.shape.env.describe(
        "Optional deployment environment: dev, staging, or prod.",
      ),
      description: InfraNode.shape.description.describe("Free-form Markdown notes."),
      x: z.number().optional().describe("Canvas x (default 80)."),
      y: z.number().optional().describe("Canvas y (default 80)."),
      width: InfraNode.shape.width.describe("Box width (default 160)."),
      height: InfraNode.shape.height.describe("Box height (default 72)."),
      parentId: InfraNode.shape.parentId.describe(
        'Id of a "group" node to nest inside, or null.',
      ),
    },
  },
  async ({ id, x, y, ...fields }) => {
    try {
      const node = InfraNode.parse({
        ...fields,
        id: id ?? genId("infra"),
        x: x ?? 80,
        y: y ?? 80,
        updatedAt: new Date().toISOString(),
      });
      await saveInfraNode(getConfig(), node);
      return ok({ id: node.id, action: id ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: connect two infra nodes ----------------------------------------
server.registerTool(
  "connect_infra",
  {
    title: "Connect two infrastructure nodes",
    description:
      "Draw a directed edge between two infra nodes (e.g. backend → database \"reads/writes\"). " +
      "Pass the from/to node ids (get them from list_infra or write_infra_node). Pass an " +
      "existing edge id to update its label. The edge is removed automatically if either node " +
      "is deleted.",
    inputSchema: {
      id: InfraEdge.shape.id
        .optional()
        .describe("Existing edge id to update; omit to create a new edge."),
      from: InfraEdge.shape.from.describe("Source node id."),
      to: InfraEdge.shape.to.describe("Target node id."),
      label: InfraEdge.shape.label.describe('Optional edge label, e.g. "reads/writes".'),
    },
  },
  async ({ id, ...fields }) => {
    try {
      const edge = InfraEdge.parse({
        ...fields,
        id: id ?? genId("edge"),
        updatedAt: new Date().toISOString(),
      });
      await saveInfraEdge(getConfig(), edge);
      return ok({ id: edge.id, action: id ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove an infra node (and its edges) ---------------------------
server.registerTool(
  "remove_infra_node",
  {
    title: "Remove an infrastructure node",
    description:
      "Delete a node from the architecture diagram and any edges touching it, so no dangling " +
      "connection is left behind. To remove only a connection, update the diagram via the canvas.",
    inputSchema: {
      nodeId: z.string().min(1).describe("The infra node id to delete."),
    },
  },
  async ({ nodeId }) => {
    try {
      await deleteInfraNode(getConfig(), nodeId);
      return ok({ nodeId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: the ER (data model) diagram -------------------------------------
server.registerTool(
  "list_entities",
  {
    title: "List the ER (data model) diagram",
    description:
      "Read the project's entity-relationship model — the entities (tables/models with their " +
      "fields) and the crow's-foot relations between them. This is the data-model diagram, " +
      "separate from both the design elements and the infrastructure graph. Start here before " +
      "writing to reuse entity ids when relating them. Also returns `erDiagram`: the model " +
      "rendered as an ER diagram (Mermaid) ready to paste into docs.",
    inputSchema: {},
  },
  async () => {
    try {
      const { entities, relations } = await fetchEntities(getConfig());
      return ok({
        entities,
        relations,
        erDiagram: entityToMermaid(entities, relations),
      });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: create or update an entity -------------------------------------
server.registerTool(
  "write_entity",
  {
    title: "Create or update an entity",
    description:
      "Add a table/model to the ER diagram (or update one by passing its id), e.g. an " +
      '"Invoice" with its fields. Each field has a name, a type, optional key roles (PK/FK/UK) ' +
      "and an optional note. Geometry is optional — omit x/y to drop it at a default spot. " +
      "Returns the entity id (use it with relate_entities).",
    inputSchema: {
      id: Entity.shape.id
        .optional()
        .describe("Existing entity id to update; omit to create a new entity."),
      name: Entity.shape.name.describe('Table/model name, e.g. "Invoice".'),
      fields: Entity.shape.fields.describe(
        "Attributes: each is { name, type, keys?: (PK|FK|UK)[], note? }.",
      ),
      description: Entity.shape.description.describe("Free-form Markdown notes."),
      x: z.number().optional().describe("Canvas x (default 80)."),
      y: z.number().optional().describe("Canvas y (default 80)."),
      width: Entity.shape.width.describe("Box width (default 180)."),
      height: Entity.shape.height.describe("Box height (default 120)."),
      parentId: Entity.shape.parentId.describe("Id of a container to nest in, or null."),
    },
  },
  async ({ id, x, y, ...fields }) => {
    try {
      const entity = Entity.parse({
        ...fields,
        id: id ?? genId("entity"),
        x: x ?? 80,
        y: y ?? 80,
        updatedAt: new Date().toISOString(),
      });
      await saveEntity(getConfig(), entity);
      return ok({ id: entity.id, action: id ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: relate two entities --------------------------------------------
server.registerTool(
  "relate_entities",
  {
    title: "Relate two entities",
    description:
      'Draw a crow\'s-foot association between two entities (e.g. Customer 1—* Order "places"). ' +
      "Pass the from/to entity ids (get them from list_entities or write_entity). Each end has a " +
      "cardinality (zero-or-one / exactly-one / zero-or-many / one-or-many); identifying picks a " +
      "solid vs dashed line. Pass an existing relation id to update it. The relation is removed " +
      "automatically if either entity is deleted.",
    inputSchema: {
      id: EntityRelation.shape.id
        .optional()
        .describe("Existing relation id to update; omit to create a new one."),
      from: EntityRelation.shape.from.describe("Source entity id."),
      to: EntityRelation.shape.to.describe("Target entity id."),
      fromCardinality: EntityRelation.shape.fromCardinality.describe(
        "Multiplicity at the from end.",
      ),
      toCardinality: EntityRelation.shape.toCardinality.describe(
        "Multiplicity at the to end.",
      ),
      label: EntityRelation.shape.label.describe('Relationship verb, e.g. "places".'),
      identifying: EntityRelation.shape.identifying.describe(
        "Solid (identifying) vs dashed (non-identifying) line.",
      ),
    },
  },
  async ({ id, ...fields }) => {
    try {
      const relation = EntityRelation.parse({
        ...fields,
        id: id ?? genId("rel"),
        updatedAt: new Date().toISOString(),
      });
      await saveEntityRelation(getConfig(), relation);
      return ok({ id: relation.id, action: id ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove an entity (and its relations) ---------------------------
server.registerTool(
  "remove_entity",
  {
    title: "Remove an entity",
    description:
      "Delete an entity from the ER diagram and any relations touching it, so no dangling " +
      "association is left behind.",
    inputSchema: {
      entityId: z.string().min(1).describe("The entity id to delete."),
    },
  },
  async ({ entityId }) => {
    try {
      await deleteEntity(getConfig(), entityId);
      return ok({ entityId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// ---------------------------------------------------------------------------
// Agent / MCP layer — the AI surface the project builds and consumes.
// ---------------------------------------------------------------------------

// --- read: the agents + MCP servers ----------------------------------------
server.registerTool(
  "list_agents",
  {
    title: "List the agents & MCP servers",
    description:
      "Read the project's Agent / MCP layer — the agents it defines (model + system prompt + the " +
      "MCP servers each is wired to) and the MCP servers it exposes or consumes (transport + the " +
      "tools they expose, each optionally wrapping a documented endpoint). Start here before " +
      "writing, to reuse agent/server ids. Also returns `wiringDiagram`: the layer rendered as a " +
      "component/wiring diagram (Mermaid) ready to paste into docs.",
    inputSchema: {},
  },
  async () => {
    try {
      const { agents, servers } = await fetchAgents(getConfig());
      return ok({
        agents,
        servers,
        wiringDiagram: agentsToComponentMermaid(agents, servers),
      });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: create or update an MCP server ---------------------------------
server.registerTool(
  "write_mcp_server",
  {
    title: "Create or update an MCP server",
    description:
      "Document an MCP server the project exposes or consumes (or update one by passing its id). " +
      "Each server has a transport (stdio/http/sse), an origin (built = the project exposes it; " +
      "consumed = a third-party server it uses) and a list of tools. A tool may set `endpointId` " +
      "to tie it to the design element whose apiBinding it wraps (see list_endpoints). Geometry is " +
      "optional. Returns the server id (use it in write_agent's mcpServerIds).",
    inputSchema: {
      id: McpServerNode.shape.id
        .optional()
        .describe("Existing server id to update; omit to create a new one."),
      label: McpServerNode.shape.label.describe('Server name, e.g. "forward-mcp".'),
      transport: McpServerNode.shape.transport.describe(
        "How it is reached: stdio | http | sse.",
      ),
      origin: McpServerNode.shape.origin.describe(
        "built (project exposes it) | consumed (third-party).",
      ),
      tech: z.string().optional().describe('Optional runtime tag, e.g. "Node 20".'),
      description: McpServerNode.shape.description.describe("Free-form Markdown notes."),
      tools: McpServerNode.shape.tools.describe(
        "Tools exposed: each is { name, description?, endpointId? }.",
      ),
      x: z.number().optional().describe("Canvas x (default 80)."),
      y: z.number().optional().describe("Canvas y (default 80)."),
      width: McpServerNode.shape.width.describe("Box width (default 200)."),
      height: McpServerNode.shape.height.describe("Box height (default 96)."),
      parentId: McpServerNode.shape.parentId.describe(
        "Id of a container to nest in, or null.",
      ),
    },
  },
  async ({ id, x, y, ...fields }) => {
    try {
      const server = McpServerNode.parse({
        ...fields,
        id: id ?? genId("mcp"),
        x: x ?? 80,
        y: y ?? 80,
        updatedAt: new Date().toISOString(),
      });
      await saveMcpServer(getConfig(), server);
      return ok({ id: server.id, action: id ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: create or update an agent --------------------------------------
server.registerTool(
  "write_agent",
  {
    title: "Create or update an agent",
    description:
      "Document an agent the project defines (or update one by passing its id): its model, its " +
      "system prompt (Markdown — diffed line-by-line in the History timeline like an API doc) and " +
      "the ids of the MCP servers it is wired to (mcpServerIds — get them from list_agents or " +
      "write_mcp_server). Geometry is optional. Returns the agent id.",
    inputSchema: {
      id: AgentNode.shape.id
        .optional()
        .describe("Existing agent id to update; omit to create a new one."),
      label: AgentNode.shape.label.describe('Agent name, e.g. "catch-up-digest agent".'),
      model: z.string().optional().describe('Model id, e.g. "claude-opus-4-8".'),
      systemPrompt: AgentNode.shape.systemPrompt.describe(
        "The agent's system prompt (Markdown).",
      ),
      mcpServerIds: AgentNode.shape.mcpServerIds.describe(
        "Ids of the MCP servers this agent can call.",
      ),
      description: AgentNode.shape.description.describe("Free-form Markdown notes."),
      x: z.number().optional().describe("Canvas x (default 80)."),
      y: z.number().optional().describe("Canvas y (default 80)."),
      width: AgentNode.shape.width.describe("Box width (default 200)."),
      height: AgentNode.shape.height.describe("Box height (default 96)."),
      parentId: AgentNode.shape.parentId.describe(
        "Id of a container to nest in, or null.",
      ),
    },
  },
  async ({ id, x, y, ...fields }) => {
    try {
      const agent = AgentNode.parse({
        ...fields,
        id: id ?? genId("agent"),
        x: x ?? 80,
        y: y ?? 80,
        updatedAt: new Date().toISOString(),
      });
      await saveAgentNode(getConfig(), agent);
      return ok({ id: agent.id, action: id ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove an MCP server (cascades out of agents' wiring) -----------
server.registerTool(
  "remove_mcp_server",
  {
    title: "Remove an MCP server",
    description:
      "Delete an MCP server and drop it from any agent's mcpServerIds, so no dangling wiring is " +
      "left behind.",
    inputSchema: {
      serverId: z.string().min(1).describe("The MCP server id to delete."),
    },
  },
  async ({ serverId }) => {
    try {
      await deleteMcpServer(getConfig(), serverId);
      return ok({ serverId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove an agent ------------------------------------------------
server.registerTool(
  "remove_agent",
  {
    title: "Remove an agent",
    description:
      "Delete an agent from the Agent / MCP layer. The MCP servers it referenced are left intact.",
    inputSchema: {
      agentId: z.string().min(1).describe("The agent id to delete."),
    },
  },
  async ({ agentId }) => {
    try {
      await deleteAgentNode(getConfig(), agentId);
      return ok({ agentId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: the narrated flows over the infra graph -------------------------
server.registerTool(
  "list_flows",
  {
    title: "List infrastructure flows",
    description:
      "Read the project's infrastructure flows — narrated paths through the architecture (e.g. " +
      '"User signup": web → API → Redis → …). Each flow returns its ordered steps and a ready ' +
      "**sequence diagram** as Mermaid (the `sequenceDiagram` field), the same one the canvas " +
      "renders. Step from/to are infra node ids (see list_infra); a step may " +
      "carry an endpointId linking it to a documented design element. Start here before writing " +
      "to reuse a flow id and see what's already documented.",
    inputSchema: {},
  },
  async () => {
    try {
      const cfg = getConfig();
      const [flows, { nodes }] = await Promise.all([fetchFlows(cfg), fetchInfra(cfg)]);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      return ok(
        flows.map((flow) => ({
          id: flow.id,
          name: flow.name,
          description: flow.description,
          steps: flow.steps.map((s, i) => ({
            n: i + 1,
            from: s.from,
            fromLabel: byId.get(s.from)?.label,
            to: s.to,
            toLabel: byId.get(s.to)?.label,
            label: s.label,
            kind: s.kind,
            ...(s.endpointId ? { endpointId: s.endpointId } : {}),
          })),
          sequenceDiagram: flowToMermaid(flow, byId),
        })),
      );
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: create or replace a whole flow ---------------------------------
server.registerTool(
  "write_flow",
  {
    title: "Create or replace an infrastructure flow",
    description:
      "Author a narrated flow over the architecture diagram — the AI-native way to capture " +
      '"how signup works" as one call. Pass an ordered list of steps; each step\'s from/to are ' +
      "infra node ids (from list_infra — create the nodes first with write_infra_node). kind sets " +
      "the message style: sync (default, a solid request arrow), async (an open fire-and-" +
      "forget arrow), or reply (a dashed return arrow). Set endpointId to tie a step to a " +
      "documented design element. Pass an existing flow id to replace it, or omit to create. " +
      "Replaces all steps — use add_flow_step to append to an existing flow without resending them. " +
      "Give consecutive steps the same `condition` (e.g. \"email free\" / \"email taken\") to wrap " +
      "them in a Mermaid alt/else block, so one endpoint's success and error paths render as a " +
      "single sequence diagram instead of separate flows.",
    inputSchema: {
      id: InfraFlow.shape.id
        .optional()
        .describe("Existing flow id to replace; omit to create a new flow."),
      name: InfraFlow.shape.name.describe('Display name, e.g. "User signup".'),
      description: InfraFlow.shape.description.describe("Free-form Markdown overview."),
      steps: z
        .array(InfraFlowStep)
        .describe(
          "Ordered hops: { from, to, label, kind?: sync|async|reply, endpointId?, condition? }. " +
            "Steps sharing a `condition` group into one alt block (adjacent differing conditions " +
            "become else branches).",
        ),
    },
  },
  async ({ id, ...fields }) => {
    try {
      const flow = InfraFlow.parse({
        ...fields,
        id: id ?? genId("flow"),
        updatedAt: new Date().toISOString(),
      });
      await saveInfraFlow(getConfig(), flow);
      return ok({ id: flow.id, steps: flow.steps.length, action: id ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: append one step to an existing flow ----------------------------
server.registerTool(
  "add_flow_step",
  {
    title: "Append a step to a flow",
    description:
      "Add one hop to the end of an existing flow without resending the others — e.g. \"document " +
      "Redis's role in signup\" becomes one call appending an API → Redis step. from/to are infra " +
      "node ids (see list_infra). The new step is appended after the current last step.",
    inputSchema: {
      flowId: z.string().min(1).describe("The flow id to append to (from list_flows)."),
      from: InfraFlowStep.shape.from.describe("Source infra node id."),
      to: InfraFlowStep.shape.to.describe("Target infra node id."),
      label: InfraFlowStep.shape.label.describe(
        'What happens, e.g. "store verification token".',
      ),
      kind: InfraFlowStep.shape.kind.describe(
        "message style: sync (default, solid request), async (open arrow), or reply (dashed return).",
      ),
      endpointId: InfraFlowStep.shape.endpointId.describe(
        "Optional design element id whose apiBinding drives this hop.",
      ),
      condition: InfraFlowStep.shape.condition.describe(
        'Optional branch guard, e.g. "token valid" or "409 duplicate". Steps sharing a ' +
          "condition render inside one Mermaid alt/else block.",
      ),
    },
  },
  async ({ flowId, ...stepFields }) => {
    try {
      const cfg = getConfig();
      const flow = (await fetchFlows(cfg)).find((f) => f.id === flowId);
      if (!flow) return fail(`No infrastructure flow with id "${flowId}".`);
      const step = InfraFlowStep.parse(stepFields);
      const next = InfraFlow.parse({
        ...flow,
        steps: [...flow.steps, step],
        updatedAt: new Date().toISOString(),
      });
      await saveInfraFlow(cfg, next);
      return ok({ flowId, steps: next.steps.length, action: "appended" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove a flow --------------------------------------------------
server.registerTool(
  "remove_flow",
  {
    title: "Remove an infrastructure flow",
    description:
      "Delete a narrated flow from the project. The infra nodes and edges it walked are left " +
      "untouched — only the flow (its name + steps) is removed.",
    inputSchema: {
      flowId: z.string().min(1).describe("The flow id to delete."),
    },
  },
  async ({ flowId }) => {
    try {
      await deleteInfraFlow(getConfig(), flowId);
      return ok({ flowId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: author the design layer ---------------------------------------
server.registerTool(
  "create_element",
  {
    title: "Create a design element",
    description:
      "Draw a new element on the canvas — a frame (container/screen), rectangle (button/card/" +
      "input), ellipse (circle/oval), text label, a reusable component, or an instance of one. Designers usually own " +
      "this, so prefer documenting existing elements; create when the design is genuinely " +
      "missing the thing you built. Set parentId to nest inside a frame; for an instance set " +
      "type:\"instance\" and componentId to the master component's id.",
    inputSchema: {
      type: DesignElement.shape.type.describe(
        "frame, rectangle, ellipse, text, component, or instance.",
      ),
      name: DesignElement.shape.name.describe("Display name for the element."),
      x: z.number().describe("Canvas x (top-left)."),
      y: z.number().describe("Canvas y (top-left)."),
      width: z.number().nonnegative().optional().describe("Width (default 120)."),
      height: z.number().nonnegative().optional().describe("Height (default 40)."),
      text: DesignElement.shape.text.describe('Text content, for type:"text".'),
      parentId: DesignElement.shape.parentId.describe(
        "Id of the frame to nest inside, or null for top level.",
      ),
      style: Style.optional().describe(
        "Optional fill/stroke/font styling, borders, and corner rounding. `radius` (or " +
          "`radii` {tl,tr,br,bl}) rounds corners; `strokeWidth` (or `strokeWidths` " +
          "{top,right,bottom,left}) sets border width per side; `strokeStyle` is solid/dashed/dotted.",
      ),
      rotation: z
        .number()
        .optional()
        .describe("Rotation in degrees clockwise about the element's center (default 0)."),
      componentId: DesignElement.shape.componentId.describe(
        'For type:"instance": the master component element id.',
      ),
    },
  },
  async ({ x, y, width, height, ...fields }) => {
    try {
      const element = DesignElement.parse({
        ...fields,
        id: genId("el"),
        x,
        y,
        width: width ?? 120,
        height: height ?? 40,
        updatedAt: new Date().toISOString(),
      });
      await saveElement(getConfig(), withoutBinding(element));
      return ok({ id: element.id, type: element.type, action: "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

server.registerTool(
  "update_element",
  {
    title: "Update a design element",
    description:
      "Change fields of an existing element without touching the rest (or its API docs): move " +
      "(x/y), resize (width/height), rename, restyle, re-parent (parentId), edit text, or " +
      "promote it to a component (type:\"component\"). Only the fields you pass are changed.",
    inputSchema: {
      elementId: z.string().min(1).describe("The design element id to update."),
      type: DesignElement.shape.type.optional().describe("New element type."),
      name: z.string().optional().describe("New display name."),
      x: z.number().optional().describe("New canvas x."),
      y: z.number().optional().describe("New canvas y."),
      width: z.number().nonnegative().optional().describe("New width."),
      height: z.number().nonnegative().optional().describe("New height."),
      rotation: z
        .number()
        .optional()
        .describe("New rotation in degrees clockwise about the element's center."),
      text: z.string().optional().describe("New text content."),
      parentId: z
        .string()
        .nullable()
        .optional()
        .describe("New parent frame id, or null to un-nest."),
      style: Style.optional().describe(
        "Style fields to set; merged over the existing style (corners and border sides merge " +
          "too), so you can change just the fill, one corner, or one side. `radius`/`radii` " +
          "({tl,tr,br,bl}) round corners; `strokeWidth`/`strokeWidths` ({top,right,bottom,left}) " +
          "set border width per side; `strokeStyle` is solid/dashed/dotted. An empty `radii: {}` " +
          "or `strokeWidths: {}` clears those overrides back to the uniform value.",
      ),
      componentId: z.string().optional().describe("New master component id (instances)."),
    },
  },
  async ({ elementId, ...patch }) => {
    try {
      // Drop keys the caller omitted so they don't clobber existing values.
      const clean = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      const next = await patchElement(getConfig(), elementId, clean);
      return ok({ id: next.id, type: next.type, action: "updated" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

server.registerTool(
  "delete_element",
  {
    title: "Delete a design element",
    description:
      "Remove an element from the canvas. By default this cascades to everything nested inside " +
      "it (deleting a frame removes its children), matching the canvas; pass cascade:false to " +
      "delete only the one element. Its version history is kept as a record.",
    inputSchema: {
      elementId: z.string().min(1).describe("The design element id to delete."),
      cascade: z
        .boolean()
        .optional()
        .describe("Also delete nested descendants (default true)."),
    },
  },
  async ({ elementId, cascade }) => {
    try {
      const removed = await deleteElement(getConfig(), elementId, { cascade });
      return ok({ removed, count: removed.length });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

/**
 * Rewrite every captured source location as a repository-relative path before
 * mapping. An absolute dev-machine path must not end up committed in
 * `.forward/` — and sources feed element keys, so they must read the same on
 * every checkout. Sources outside the repository are dropped and returned, so
 * the anchor report can say why those components got none.
 */
function repoRelativeSources(
  root: string,
  snapshot: CaptureSnapshot,
): { snapshot: CaptureSnapshot; outside: Array<{ component: string; file: string }> } {
  const outside = new Map<string, { component: string; file: string }>();
  const visit = (node: CaptureNode): CaptureNode => {
    const { source, children, ...rest } = node;
    let kept: string | undefined;
    if (source) {
      const loc = parseSource(normalizeSourcePath(source));
      const file = loc && localPath(loc.file) ? insideRepo(root, loc.file) : null;
      if (loc && file) kept = `${file}:${loc.line}`;
      else if (loc && node.component) outside.set(`${node.component}\u0000${loc.file}`, { component: node.component, file: loc.file });
    }
    return {
      ...rest,
      ...(kept ? { source: kept } : {}),
      ...(children ? { children: children.map(visit) } : {}),
    };
  };
  return { snapshot: { ...snapshot, root: visit(snapshot.root) }, outside: [...outside.values()] };
}

/**
 * Bundler and URL prefixes off a captured source path: `file://` and
 * `webpack:///./src/A.tsx` become plain paths. A Windows drive path, or any
 * other scheme, isn't a path in this checkout and is left to be rejected.
 */
function normalizeSourcePath(source: string): string {
  return source
    .replace(/^file:\/\//, "")
    .replace(/^webpack(?:-internal)?:\/\/\/?(?:\([^)]*\)\/)?(?:\.\/)?/, "");
}

/** A path this checkout can resolve: no drive letter, backslash or URL scheme. */
function localPath(file: string): boolean {
  return !/^[A-Za-z]:[\\/]|\\/.test(file) && !/^[A-Za-z][\w+.-]*:/.test(file);
}

/** Above this many elements a page is mostly noise in git; say so. */
const LARGE_PAGE = 1500;

server.registerTool(
  "import_design_from_code",
  {
    title: "Generate designs from frontend code",
    description:
      "For screens that were built without a design: capture the running frontend and turn what " +
      "the browser renders into canvas elements — one frame per route, boxes, text, and (React " +
      "dev builds) repeated components as a component + instances. Give `url` + `routes` to " +
      "capture live — with the project's Playwright, or a Chromium-based browser already installed " +
      "(Chrome, Edge, Brave, Chromium, Vivaldi, Opera; see `browser`) — or `snapshotPath` for snapshot " +
      "files made with `forward capture --script` in the browser's DevTools. The results are " +
      "drafts marked as generated from code: re-running updates drafts in place (stable ids, API " +
      "docs kept, even when the page around them changed) but never touches an element someone " +
      "edited (reported as a conflict) or adopted, and doesn't recreate drafts someone deleted. " +
      "Use dryRun first to see what would change. If the app can't run, read the components and " +
      "draw a rough wireframe with create_element instead.",
    inputSchema: {
      url: z.string().url().optional().describe("Base URL of the running app, e.g. http://localhost:5173 (live capture)."),
      routes: z
        .array(z.string().min(1))
        .optional()
        .describe('Routes to capture against `url`, e.g. ["/", "/login"] (default ["/"]).'),
      viewport: z.string().optional().describe('Viewport for live capture, e.g. "1440x900" (default) or "390x844".'),
      browser: z
        .string()
        .optional()
        .describe(
          'Which browser captures live: "auto" (default: the project\'s Playwright, else the first ' +
            'installed Chromium-based browser), "playwright", "chrome", "edge", "chromium", "brave", ' +
            '"vivaldi" or "opera" (a path only via FORWARD_BROWSER or the CLI). Firefox and Safari can\'t be ' +
            "driven; use the DevTools snippet in them.",
        ),
      storageState: z
        .string()
        .optional()
        .describe("Storage-state JSON (Playwright's format: cookies + localStorage) for pages behind a login."),
      waitMs: z.number().int().nonnegative().max(60_000).optional().describe("Extra settle time per route, in ms."),
      snapshotPath: z
        .array(z.string().min(1))
        .optional()
        .describe("Snapshot JSON files from the DevTools snippet (each holds one snapshot or an array)."),
      snapshot: z.unknown().optional().describe("A snapshot object (or array of them) passed inline."),
      detectComponents: z
        .boolean()
        .optional()
        .describe("Turn repeated frontend components into a component + instances (default true)."),
      prune: z
        .boolean()
        .optional()
        .describe(
          "Also remove drafts of these routes that the code no longer renders (reported as `stale` " +
            "otherwise). Never removes a documented, edited or adopted element.",
        ),
      restoreDismissed: z
        .boolean()
        .optional()
        .describe("Recreate drafts that someone deleted since they were imported (otherwise they stay deleted)."),
      writeAnchors: z
        .boolean()
        .optional()
        .describe(
          "Also insert `// @adc <id>` anchors above each component's declaration in your JS/TS " +
            "source (edits source files — off by default).",
        ),
      dryRun: z.boolean().optional().describe("Report what would change without writing anything."),
    },
  },
  async (input) => {
    try {
      const root = requireRepo();
      const cfg = getConfig();
      const raws: unknown[] = [];
      const push = (v: unknown) => raws.push(...(Array.isArray(v) ? v : [v]));
      if (input.snapshot !== undefined) push(input.snapshot);
      for (const p of input.snapshotPath ?? []) {
        push(JSON.parse(await readFile(resolve(process.cwd(), p), "utf8")));
      }
      let capturedWith: string | undefined;
      const liveNotes: string[] = [];
      if (input.url) {
        const browser = input.browser?.trim();
        // A path would let an MCP client start any program on this machine. Only
        // the user picks one — `forward capture --browser <path>`, or FORWARD_BROWSER.
        if (browser && /[\\/]/.test(browser)) {
          return fail(
            "`browser` takes a name here (auto, playwright, chrome, edge, chromium, brave, vivaldi, opera). " +
              "To use a browser by path, set FORWARD_BROWSER or run `forward capture --browser <path>`.",
          );
        }
        const live = await captureLive({
          url: input.url,
          routes: input.routes?.length ? input.routes : ["/"],
          viewport: parseViewport(input.viewport),
          ...(input.storageState ? { storageState: resolve(process.cwd(), input.storageState) } : {}),
          ...(input.waitMs ? { waitMs: input.waitMs } : {}),
          ...(browser ? { browser } : {}),
        });
        push(live.snapshots);
        capturedWith = live.capturedWith;
        liveNotes.push(...(live.notes ?? []));
      }
      if (!raws.length) {
        return fail(
          "Nothing to import. Give `url` (+ `routes`) to capture a running app, or `snapshotPath` " +
            "for files from `forward capture --script`.",
        );
      }

      const parsedSnapshots = raws.map((raw, i) => {
        let res: ReturnType<typeof CaptureSnapshot.safeParse>;
        try {
          res = CaptureSnapshot.safeParse(raw);
        } catch (err) {
          if (err instanceof RangeError) {
            throw new Error(`Snapshot ${i + 1} nests too deeply to import; capture it with the Forward collector, which stops at 200 levels.`);
          }
          throw err;
        }
        if (res.success) return res.data;
        const issue = res.error.issues[0];
        const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
        throw new Error(`Snapshot ${i + 1} is not a Forward capture${where}: ${issue?.message ?? "bad shape"}`);
      });
      const outsideSources: Array<{ component: string; file: string }> = [];
      const snapshots = parsedSnapshots.map((s) => {
        const { snapshot, outside } = repoRelativeSources(root, s);
        outsideSources.push(...outside);
        return snapshot;
      });
      const pages = new Set<string>();
      for (const s of snapshots) {
        const page = `${s.route} @ ${Math.round(s.viewport.width)}x${Math.round(s.viewport.height)}`;
        if (pages.has(page)) throw new Error(`Two snapshots capture the same page (${page}); keep one.`);
        pages.add(page);
      }

      const places = placeSnapshots(snapshots, await fetchElements(cfg));
      const mapped = snapshots.map((s, i) =>
        mapSnapshot(s, {
          x: places[i]?.x ?? 0,
          y: places[i]?.y ?? 0,
          detectComponents: input.detectComponents !== false,
        }),
      );
      for (const [i, m] of mapped.entries()) {
        if (m.elements.length > MAX_IMPORT_ELEMENTS) {
          throw new Error(
            `${snapshots[i]?.route} produced ${m.elements.length} elements; the limit is ` +
              `${MAX_IMPORT_ELEMENTS} per import. Capture a simpler state of the page.`,
          );
        }
      }

      // A page that wasn't really captured — cut off, an error page, or a
      // redirect (an expired login lands on /login) — must not prune the
      // drafts of the route it was meant to be.
      const warnings: string[] = [];
      for (const snap of snapshots) {
        if (snap.truncated) warnings.push(`${snap.route}: only partly captured (node limit reached).`);
        if (snap.status !== undefined && snap.status >= 400) warnings.push(`${snap.route}: the page answered HTTP ${snap.status}.`);
        // Only a live capture navigated to the route; a DevTools snapshot was
        // taken by hand on whatever page was open (and its route may be a
        // pattern like /users/:id given with --route).
        if (snap.url && snap.status !== undefined) {
          try {
            const where = (u: URL) =>
              (u.pathname.replace(/\/+$/, "") || "/") + (snap.route.includes("#") ? u.hash : "");
            const landed = where(new URL(snap.url));
            const wanted = where(new URL(snap.route, snap.url));
            if (landed !== wanted) warnings.push(`${snap.route}: the page ended up on ${landed} (a redirect — is the login state expired?).`);
          } catch {
            // an unparsable url is just not checked
          }
        }
      }
      const prune = input.prune === true && warnings.length === 0;
      if (input.prune === true && !prune) warnings.push("Not pruning, because a page above may not be the real page.");

      // Not a reason to distrust the capture, just worth knowing.
      const notes: string[] = [...liveNotes];
      for (const [i, m] of mapped.entries()) {
        if (m.elements.length > LARGE_PAGE) {
          notes.push(
            `${snapshots[i]?.route} produced ${m.elements.length} elements (one file each in git). ` +
              "Consider capturing a simpler state of the page.",
          );
        }
      }

      const elements = mapped.flatMap((m) => m.elements);
      const dryRun = input.dryRun === true;
      const report = await importDesign(cfg, {
        elements,
        prune,
        dryRun,
        ...(input.restoreDismissed ? { restoreDismissed: true } : {}),
      });

      // Anchors: written on request; otherwise only counted, so the choice is
      // informed. They name the ids the import settled on (a re-matched draft
      // keeps its old id; a dismissed one gets none).
      const settled = elements.flatMap((el) => {
        const final = el.id in report.idMap ? report.idMap[el.id] : el.id;
        return final ? [{ ...el, id: final }] : [];
      });
      const plan = planAnchors(root, settled);
      const anchorRun = await writeAnchors(root, plan.targets, { dryRun: dryRun || !input.writeAnchors });
      let anchors: AnchorOutcome | undefined;
      if (input.writeAnchors) {
        const outside = outsideSources.flatMap(({ component, file }) => {
          const el = settled.find((e) => e.origin.component === component && e.type !== "text");
          return el ? [{ elementId: el.id, file, reason: "file is outside the repository" }] : [];
        });
        anchors = { written: anchorRun.written, skipped: [...plan.skipped, ...outside, ...anchorRun.skipped] };
      }
      const next: string[] = [];
      if (report.stale.length && !prune) {
        next.push(`${report.stale.length} draft(s) are no longer in the code — run again with prune to remove them.`);
      }
      if (report.dismissed.length) {
        next.push(`${report.dismissed.length} deleted draft(s) were not recreated — use restoreDismissed to bring them back.`);
      }
      if (!input.writeAnchors && anchorRun.written.length) {
        next.push(
          `writeAnchors would add ${anchorRun.written.length} \`// @adc\` anchor(s) to your source, linking components to their drafts.`,
        );
      }

      const limit = 50;
      return ok({
        dryRun,
        ...(capturedWith ? { capturedWith } : {}),
        pages: mapped.map((m, i) => ({
          route: snapshots[i]?.route,
          viewport: m.viewport,
          frameId: m.frameId,
          elements: m.elements.length,
          ...(snapshots[i]?.truncated ? { truncated: true } : {}),
        })),
        counts: {
          created: report.created.length,
          updated: report.updated.length,
          unchanged: report.unchanged.length,
          skipped: report.skipped.length,
          conflicts: report.conflicts.length,
          rematched: report.rematched.length,
          dismissed: report.dismissed.length,
          restored: report.restored.length,
          stale: report.stale.length,
          removed: report.removed.length,
          kept: report.kept.length,
          forgotten: report.forgotten.length,
        },
        ...(report.conflicts.length ? { conflicts: report.conflicts.slice(0, limit) } : {}),
        ...(report.kept.length ? { kept: report.kept.slice(0, limit) } : {}),
        ...(anchors ? { anchors } : {}),
        ...(warnings.length ? { warnings } : {}),
        ...(notes.length ? { notes } : {}),
        ...(next.length ? { next } : {}),
        hint: dryRun
          ? "Dry run — nothing was written. Run again without dryRun to apply."
          : "These are drafts generated from code. Review them on the canvas (`forward serve`), " +
            "rename or restyle what you keep — an edited draft is never overwritten by a later " +
            "import — and commit .forward/ with the code. Conflicts are drafts someone edited; " +
            "skipped are hand-drawn or adopted elements.",
      });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: the project's task tracker --------------------------------------
server.registerTool(
  "list_tasks",
  {
    title: "List tasks",
    description:
      "Read the project's task tracker — work items that stand apart from the design elements " +
      "but optionally link into them. Each task carries a type (bug / feature / task / milestone), status " +
      "(todo / in_progress / blocked / done), priority, labels, assignees, a reporter, optional " +
      "start and due dates, dependencies on other tasks, a running activity/comment feed, and optional links: " +
      "elementId (a design element), flowId (a narrated infra flow), and endpointId (a documented " +
      "endpoint element). Filter by any " +
      "of these to answer e.g. \"what high-priority bugs are left for the signup flow?\". Returns a " +
      "summary per task; call get_task for one task's full body + activity. Start here to reuse ids.",
    inputSchema: {
      // unwrap() drops the field's default: zod 4 would fill it into an omitted
      // optional filter, so a bare list_tasks would list only todo tasks.
      status: Task.shape.status.unwrap().optional().describe("Only tasks in this status."),
      type: Task.shape.type.unwrap().optional().describe("Only tasks of this type."),
      priority: Task.shape.priority.unwrap().optional().describe("Only tasks at this priority."),
      label: z.string().optional().describe("Only tasks carrying this label."),
      assignee: z.string().optional().describe("Only tasks assigned to this uid."),
      elementId: z.string().optional().describe("Only tasks linked to this design element id."),
      flowId: z.string().optional().describe("Only tasks linked to this infra flow id."),
      endpointId: z.string().optional().describe("Only tasks linked to this endpoint element id."),
    },
  },
  async ({ status, type, priority, label, assignee, elementId, flowId, endpointId }) => {
    try {
      let tasks = await fetchTasks(getConfig());
      if (status) tasks = tasks.filter((t) => t.status === status);
      if (type) tasks = tasks.filter((t) => t.type === type);
      if (priority) tasks = tasks.filter((t) => t.priority === priority);
      if (label) tasks = tasks.filter((t) => t.labels.includes(label));
      if (assignee) tasks = tasks.filter((t) => t.assignees.includes(assignee));
      if (elementId) tasks = tasks.filter((t) => t.elementId === elementId);
      if (flowId) tasks = tasks.filter((t) => t.flowId === flowId);
      if (endpointId) tasks = tasks.filter((t) => t.endpointId === endpointId);
      // Keep the list light: omit the activity feed (read it with get_task).
      const summary = tasks.map(({ activity, ...rest }) => ({
        ...rest,
        activityCount: activity.length,
      }));
      return ok({ count: summary.length, tasks: summary });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: one task in full, including its activity feed --------------------
server.registerTool(
  "get_task",
  {
    title: "Get a task",
    description:
      "Read one task in full — every field plus its chronological activity/comment feed. Call this " +
      "to catch up on the discussion and history before commenting or changing a task, so you act " +
      "on the current state rather than a stale summary from list_tasks.",
    inputSchema: {
      taskId: z.string().min(1).describe("The task id to read (from list_tasks)."),
    },
  },
  async ({ taskId }) => {
    try {
      const task = (await fetchTasks(getConfig())).find((t) => t.id === taskId);
      if (!task) return fail(`No task with id "${taskId}".`);
      return ok({ task });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read: the task timeline (Gantt) -----------------------------------------
server.registerTool(
  "get_task_timeline",
  {
    title: "Get the task timeline",
    description:
      "The project's tasks laid out on a calendar, the same schedule the canvas Timeline view " +
      "draws: each task runs from its startDate (else the day it was created) to its ISO dueDate " +
      "(else a single day); a milestone is one date. Returns `ganttDiagram`, a Mermaid gantt chart " +
      "ready to paste into docs or a PR, the per-task spans, and `warnings` for schedule problems: " +
      "due dates that aren't ISO dates, dependency cycles, missing dependencies, and tasks that " +
      "start before a task they depend on is due. Use it to plan, or to check a schedule you set.",
    inputSchema: {
      title: z.string().optional().describe("Optional chart title."),
    },
  },
  async ({ title }) => {
    try {
      const tasks = await fetchTasks(getConfig());
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const name = (t: { id: string; key?: string }) => t.key ?? t.id;
      const warnings: string[] = [];
      const spans = tasks.map((t) => {
        const s = taskSpan(t);
        if (s.dueUnparsed) {
          warnings.push(`${name(t)}: due date "${t.dueDate}" isn't an ISO date (YYYY-MM-DD), so it can't be plotted.`);
        }
        return s;
      });
      const spanById = new Map(spans.map((s) => [s.task.id, s]));
      for (const s of spans) {
        for (const d of s.task.dependsOn) {
          const dep = spanById.get(d);
          if (!dep) warnings.push(`${name(s.task)}: dependency "${d}" not found.`);
          else if (d !== s.task.id && dep.end > s.start) {
            warnings.push(
              `${name(s.task)} starts ${dayToIso(s.start)}, before ${name(dep.task)} is due (${dayToIso(dep.end)}).`,
            );
          }
        }
      }
      for (const cycle of findDependencyCycles(tasks)) {
        const keys = cycle.map((id) => name(byId.get(id)!));
        warnings.push(`Dependency cycle: ${[...keys, keys[0]].join(" → ")}.`);
      }
      return ok({
        count: tasks.length,
        ganttDiagram: tasksToMermaidGantt(tasks, title ? { title } : {}),
        tasks: spans.map((s) => ({
          id: s.task.id,
          key: s.task.key,
          title: s.task.title,
          type: s.task.type,
          status: s.task.status,
          start: dayToIso(s.start),
          end: dayToIso(s.end),
          milestone: s.milestone,
          dependsOn: s.task.dependsOn,
        })),
        warnings,
      });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: create a task --------------------------------------------------
server.registerTool(
  "create_task",
  {
    title: "Create a task",
    description:
      "File a new work item on the project's task tracker. title is the core; description is " +
      "free-form Markdown. type defaults to task, status to todo, priority to medium. The reporter " +
      "is recorded as you (the git author, via this agent) and a sequential FWD-NN key is assigned. The optional links tie the " +
      "task to what it's about: elementId (the design element), flowId (an infra flow it implements), " +
      "endpointId (the documented endpoint element) — pass any, all, or none. Returns the new task id.",
    inputSchema: {
      title: Task.shape.title.describe("Short summary of the work to do."),
      description: Task.shape.description.describe("Markdown details, acceptance criteria, notes."),
      type: Task.shape.type.describe(
        "bug, feature, task (default), or milestone (a zero-duration marker date).",
      ),
      status: Task.shape.status.describe("todo (default), in_progress, blocked, or done."),
      priority: Task.shape.priority.describe("low, medium (default), high, or urgent."),
      labels: Task.shape.labels.describe("Free-form label names, e.g. backend, bug."),
      assignees: Task.shape.assignees.describe("uids from list_members to assign."),
      startDate: Task.shape.startDate.describe(
        "Planned start, ISO yyyy-mm-dd. Without it the timeline starts the task on the day it was created.",
      ),
      dueDate: Task.shape.dueDate.describe(
        "Due date, ISO yyyy-mm-dd — for a milestone, its target date. A free-form label like " +
          "\"next week\" is rejected.",
      ),
      dependsOn: Task.shape.dependsOn.describe(
        "Task ids this one depends on (finish-to-start) — drives the timeline connectors.",
      ),
      elementId: Task.shape.elementId.describe("Design element this task concerns."),
      flowId: Task.shape.flowId.describe("Infra flow this task implements."),
      endpointId: Task.shape.endpointId.describe("Documented endpoint element this task concerns."),
    },
  },
  async (fields) => {
    try {
      const cfg = getConfig();
      const existingKeys = (await fetchTasks(cfg)).map((t) => t.key);
      const task = newTask(fields, { actor: AGENT, existingKeys });
      await saveTask(cfg, task);
      return ok({ id: task.id, key: task.key, status: task.status, action: "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: update a task --------------------------------------------------
server.registerTool(
  "update_task",
  {
    title: "Update a task",
    description:
      "Change fields of an existing task without touching the rest — e.g. move it to in_progress " +
      "or done, retype/reprioritize it, reassign it, relabel it, set start/due dates, edit the " +
      "title/description, or set a link. Only the fields you pass change; the rest (and createdAt) " +
      "are preserved, and each change is recorded in the task's activity feed attributed to the " +
      "agent. The most common call is just flipping status.",
    inputSchema: {
      taskId: z.string().min(1).describe("The task id to update (from list_tasks)."),
      title: z.string().min(1).optional().describe("New title."),
      description: z.string().optional().describe("New Markdown description."),
      // unwrap() drops each field's default: zod 4 would fill it into an omitted
      // optional field, so every update would reset what it didn't mention.
      type: Task.shape.type.unwrap().optional().describe("New type (incl. milestone)."),
      status: Task.shape.status.unwrap().optional().describe("New status."),
      priority: Task.shape.priority.unwrap().optional().describe("New priority."),
      labels: Task.shape.labels.unwrap().optional().describe("Replace the label list."),
      assignees: Task.shape.assignees.unwrap().optional().describe("Replace the assignee uid list."),
      startDate: z
        .string()
        .optional()
        .describe("New start date, ISO yyyy-mm-dd; an empty string clears it."),
      dueDate: Task.shape.dueDate.describe(
        "New due date, ISO yyyy-mm-dd; an empty string clears it. A task filed before due dates had " +
          "to be ISO keeps its old label until you change it.",
      ),
      dependsOn: Task.shape.dependsOn.unwrap().optional().describe("Replace the dependency task-id list."),
      elementId: z.string().optional().describe("Link to a design element id."),
      flowId: z.string().optional().describe("Link to an infra flow id."),
      endpointId: z.string().optional().describe("Link to an endpoint element id."),
    },
  },
  async ({ taskId, ...patch }) => {
    try {
      const cfg = getConfig();
      const prev = (await fetchTasks(cfg)).find((t) => t.id === taskId);
      if (!prev) return fail(`No task with id "${taskId}".`);
      // Drop keys the caller omitted so they don't clobber existing values.
      const clean: Record<string, unknown> = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      // An empty start date clears it (the key stays so the change is logged).
      if (patch.startDate === "") clean.startDate = undefined;
      const next = applyTaskChange(prev, clean, AGENT);
      await saveTask(cfg, next);
      return ok({ id: next.id, status: next.status, action: "updated" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: comment on a task ----------------------------------------------
server.registerTool(
  "comment_task",
  {
    title: "Comment on a task",
    description:
      "Add a comment to a task's activity feed — the same thread humans use on the canvas. Use " +
      "it to report progress, ask a question, or record a decision so teammates see it in context. " +
      "The comment is attributed to the agent and sanitized server-side. Read the thread first with " +
      "get_task so your comment lands in context.",
    inputSchema: {
      taskId: z.string().min(1).describe("The task id to comment on (from list_tasks)."),
      body: z.string().min(1).describe("The comment text (Markdown)."),
    },
  },
  async ({ taskId, body }) => {
    try {
      const cfg = getConfig();
      const prev = (await fetchTasks(cfg)).find((t) => t.id === taskId);
      if (!prev) return fail(`No task with id "${taskId}".`);
      const next = commentOnTask(prev, AGENT, body);
      await saveTask(cfg, next);
      return ok({ id: next.id, action: "commented" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove a task --------------------------------------------------
server.registerTool(
  "delete_task",
  {
    title: "Delete a task",
    description:
      "Remove a work item from the project's task tracker. The design elements and infra flows " +
      "it linked to are left untouched — only the task is deleted.",
    inputSchema: {
      taskId: z.string().min(1).describe("The task id to delete."),
    },
  },
  async ({ taskId }) => {
    try {
      await deleteTask(getConfig(), taskId);
      return ok({ taskId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- contributors (read-only, from git history) ----------------------------
server.registerTool(
  "list_members",
  {
    title: "List contributors",
    description:
      "Read who has worked on the project: everyone who has committed to .forward/, from git " +
      "history, with .mailmap applied. A member's uid is what a task's assignees hold; bot marks an " +
      "automation account. shallow means this is a shallow clone, so the list may be missing people. " +
      "Access itself is managed by the git host (repository permissions), not here.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await listMembers(getConfig()));
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);
