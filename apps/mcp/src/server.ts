import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ApiBinding,
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraFlowStep,
  InfraNode,
  ProjectRole,
  Style,
  Task,
  addMember,
  bindApiToElement,
  deleteElement,
  deleteInfraFlow,
  deleteInfraNode,
  deleteTask,
  digest,
  fetchElements,
  fetchFlows,
  fetchInfra,
  fetchTasks,
  fetchTimelinesConditional,
  flattenTimelines,
  flowToMermaid,
  infraToComponentMermaid,
  listMembers,
  patchElement,
  patchTask,
  removeMember,
  saveElement,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  saveTask,
  unbindApiFromElement,
  type CurrentLabel,
  type FirebaseConfig,
} from "forward-core";
import { findAnchorsInSource, scanPath } from "./anchor.js";
import { rankElements } from "./match.js";

/**
 * Forward — MCP server.
 *
 * The AI-native surface of the project: it exposes the same RTDB writer the VS
 * Code extension uses (`forward-core`) as a handful of tools any MCP-capable
 * agent (Claude Code, Cursor, …) can call. So a backend dev who just finished a
 * feature can say "document the login endpoint on the canvas" and the agent
 * finds the right design element and writes the docs — no quick-pick, no form.
 *
 * Trust boundary: this process holds the Firebase credentials (read from env);
 * the agent only ever sees the scoped tools below, never the token. Stdout is
 * reserved for the MCP protocol, so all logging goes to stderr.
 */

const AGENT = process.env.ADC_AGENT || "agent";

/**
 * Configuration from the environment. Thrown errors surface to the agent as a tool
 * error telling the user which variables to set, rather than crashing the server.
 */
function getConfig(): FirebaseConfig {
  const databaseUrl = process.env.ADC_FIREBASE_DATABASE_URL ?? "";
  const projectId = process.env.ADC_PROJECT_ID ?? "";
  const authToken = process.env.ADC_AUTH_TOKEN ?? "";
  if (!databaseUrl || !projectId) {
    throw new Error(
      "Missing configuration. Set ADC_FIREBASE_DATABASE_URL and ADC_PROJECT_ID " +
        "(and ADC_AUTH_TOKEN if your RTDB rules require auth) in the MCP server env.",
    );
  }
  return { databaseUrl, projectId, ...(authToken ? { authToken } : {}) };
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
async function loadTimelineEvents(cfg: FirebaseConfig) {
  const [timelinesResult, elements] = await Promise.all([
    fetchTimelinesConditional(cfg, undefined),
    fetchElements(cfg),
  ]);
  const current: Record<string, CurrentLabel> = {};
  for (const el of elements) {
    if (el.apiBinding) {
      current[el.id] = {
        title: el.apiBinding.title,
        ...(el.apiBinding.method ? { method: el.apiBinding.method } : {}),
        ...(el.apiBinding.endpoint ? { path: el.apiBinding.endpoint } : {}),
      };
    }
  }
  return flattenTimelines(timelinesResult?.timelines ?? {}, current);
}

const server = new McpServer({
  name: "forward",
  version: "0.1.0",
});

// --- read: what the designers drew ----------------------------------------
server.registerTool(
  "list_design_elements",
  {
    title: "List design elements",
    description:
      "List every design element on the canvas for this project (id, name, type, text, " +
      "and whether it already has API documentation). Start here to see what you can document.",
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
      "prefer this over fuzzy matching whenever the developer has anchored their code. The " +
      "result flags anchors whose elementId doesn't exist (typos / stale ids).",
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
      let byId = new Map<string, { name: string; type: string; documented: boolean }>();
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

      const resolved = anchors.map((a) => {
        const el = byId.get(a.elementId);
        return {
          ...a,
          exists: warning ? null : Boolean(el),
          ...(el ? { name: el.name, type: el.type, documented: el.documented } : {}),
        };
      });
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
      "code you just wrote. title + Markdown description carry the meaning; language/method/" +
      "endpoint/parameters are optional structured hints for REST endpoints (omit them for " +
      "GraphQL/gRPC/CLI/jobs). The change is appended to the element's version history. The " +
      "canvas updates live.",
    inputSchema: {
      elementId: z.string().min(1).describe("Target design element id (from find_element)."),
      title: ApiBinding.shape.title.describe("Short label for the endpoint/feature."),
      description: ApiBinding.shape.description.describe(
        "Markdown docs: what it does, params, request/response, gotchas.",
      ),
      language: ApiBinding.shape.language.describe(
        'Language/framework tag, e.g. "Python/FastAPI", "Go", "GraphQL".',
      ),
      method: ApiBinding.shape.method.describe("HTTP method, for REST endpoints only."),
      endpoint: ApiBinding.shape.endpoint.describe("HTTP path, e.g. /api/v1/users/login."),
      parameters: ApiBinding.shape.parameters.describe("Named parameters, if any."),
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
      "Also returns `componentDiagram`: the graph rendered as a UML component diagram (Mermaid) " +
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

// --- read: the narrated flows over the infra graph -------------------------
server.registerTool(
  "list_flows",
  {
    title: "List infrastructure flows",
    description:
      "Read the project's infrastructure flows — narrated paths through the architecture (e.g. " +
      '"User signup": web → API → Redis → …). Each flow returns its ordered steps and a ready ' +
      "UML **sequence diagram** as Mermaid (the `sequenceDiagram` field), the same one the canvas " +
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
      "the UML message style: sync (default, a solid request arrow), async (an open fire-and-" +
      "forget arrow), or reply (a dashed return arrow). Set endpointId to tie a step to a " +
      "documented design element. Pass an existing flow id to replace it, or omit to create. " +
      "Replaces all steps — use add_flow_step to append to an existing flow without resending them.",
    inputSchema: {
      id: InfraFlow.shape.id
        .optional()
        .describe("Existing flow id to replace; omit to create a new flow."),
      name: InfraFlow.shape.name.describe('Display name, e.g. "User signup".'),
      description: InfraFlow.shape.description.describe("Free-form Markdown overview."),
      steps: z
        .array(InfraFlowStep)
        .describe(
          "Ordered hops: { from, to, label, kind?: sync|async|reply, endpointId? }.",
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
        "UML message style: sync (default, solid request), async (open arrow), or reply (dashed return).",
      ),
      endpointId: InfraFlowStep.shape.endpointId.describe(
        "Optional design element id whose apiBinding drives this hop.",
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
      "input), text label, a reusable component, or an instance of one. Designers usually own " +
      "this, so prefer documenting existing elements; create when the design is genuinely " +
      "missing the thing you built. Set parentId to nest inside a frame; for an instance set " +
      "type:\"instance\" and componentId to the master component's id.",
    inputSchema: {
      type: DesignElement.shape.type.describe(
        "frame, rectangle, text, component, or instance.",
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
      style: Style.optional().describe("Optional fill/stroke/radius/font styling."),
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
      await saveElement(getConfig(), element);
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
      text: z.string().optional().describe("New text content."),
      parentId: z
        .string()
        .nullable()
        .optional()
        .describe("New parent frame id, or null to un-nest."),
      style: Style.optional().describe("Style fields to set."),
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

// --- read: the project's task tracker --------------------------------------
server.registerTool(
  "list_tasks",
  {
    title: "List tasks",
    description:
      "Read the project's task tracker — work items that stand apart from the design elements " +
      "but optionally link into them. Each task has a status (todo / in_progress / blocked / " +
      "done), optional assignees, and optional links: elementId (a design element), flowId (a " +
      "narrated infra flow), and endpointId (a documented endpoint element). Filter by status or " +
      "by any of the link ids to answer e.g. \"what's left to build for the signup flow?\". Start " +
      "here before updating to reuse a task id.",
    inputSchema: {
      status: Task.shape.status
        .optional()
        .describe("Only return tasks in this status."),
      elementId: z
        .string()
        .optional()
        .describe("Only return tasks linked to this design element id."),
      flowId: z
        .string()
        .optional()
        .describe("Only return tasks linked to this infra flow id."),
      endpointId: z
        .string()
        .optional()
        .describe("Only return tasks linked to this endpoint element id."),
    },
  },
  async ({ status, elementId, flowId, endpointId }) => {
    try {
      let tasks = await fetchTasks(getConfig());
      if (status) tasks = tasks.filter((t) => t.status === status);
      if (elementId) tasks = tasks.filter((t) => t.elementId === elementId);
      if (flowId) tasks = tasks.filter((t) => t.flowId === flowId);
      if (endpointId) tasks = tasks.filter((t) => t.endpointId === endpointId);
      return ok({ count: tasks.length, tasks });
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
      "free-form Markdown. status defaults to todo. The optional links tie the task to what it's " +
      "about: elementId (the design element), flowId (an infra flow it implements), endpointId " +
      "(the documented endpoint element). Links are independent — pass any, all, or none. Returns " +
      "the new task id (use it with update_task).",
    inputSchema: {
      title: Task.shape.title.describe("Short summary of the work to do."),
      description: Task.shape.description.describe("Markdown details, acceptance criteria, notes."),
      status: Task.shape.status.describe(
        "todo (default), in_progress, blocked, or done.",
      ),
      assignees: Task.shape.assignees.describe("uids from the project roster to assign."),
      elementId: Task.shape.elementId.describe("Design element this task concerns."),
      flowId: Task.shape.flowId.describe("Infra flow this task implements."),
      endpointId: Task.shape.endpointId.describe("Documented endpoint element this task concerns."),
    },
  },
  async (fields) => {
    try {
      const now = new Date().toISOString();
      const taskBody = Task.parse({
        ...fields,
        id: genId("task"),
        createdAt: now,
        updatedAt: now,
      });
      await saveTask(getConfig(), taskBody);
      return ok({ id: taskBody.id, status: taskBody.status, action: "created" });
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
      "or done, reassign it, edit the title/description, or set/clear a link. Only the fields you " +
      "pass are changed; createdAt is preserved. The most common call is just flipping status.",
    inputSchema: {
      taskId: z.string().min(1).describe("The task id to update (from list_tasks)."),
      title: z.string().min(1).optional().describe("New title."),
      description: z.string().optional().describe("New Markdown description."),
      status: Task.shape.status.optional().describe("New status."),
      assignees: Task.shape.assignees.optional().describe("Replace the assignee uid list."),
      priority: Task.shape.priority.optional().describe("New priority."),
      labels: Task.shape.labels.optional().describe("Replace the label list."),
      elementId: z.string().optional().describe("Link to a design element id."),
      flowId: z.string().optional().describe("Link to an infra flow id."),
      endpointId: z.string().optional().describe("Link to an endpoint element id."),
    },
  },
  async ({ taskId, ...patch }) => {
    try {
      // Drop keys the caller omitted so they don't clobber existing values.
      const clean = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      const next = await patchTask(getConfig(), taskId, clean);
      return ok({ id: next.id, status: next.status, action: "updated" });
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

// --- access control: the project member roster -----------------------------
server.registerTool(
  "list_members",
  {
    title: "List project members",
    description:
      "Read the project's access roster — the uids allowed to read/write this project, with " +
      "each one's role (owner/member) and when it was granted.",
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

server.registerTool(
  "add_member",
  {
    title: "Add a project member",
    description:
      "Enrol a uid into the project's roster so it can access the project (the REST-side of the " +
      "canvas' 👤 +Member control). The server's own credentials must be privileged enough for " +
      "the security rules to admit this write. Defaults the new uid to editor; pass role:\"owner\" " +
      "to grant ownership or role:\"viewer\" for read-only.",
    inputSchema: {
      uid: z.string().min(1).describe("The user id to grant access to."),
      role: ProjectRole.optional().describe(
        "viewer, editor or owner (default editor).",
      ),
    },
  },
  async ({ uid, role }) => {
    try {
      await addMember(getConfig(), uid, role);
      return ok({ uid, role: role ?? "editor", action: "added" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

server.registerTool(
  "remove_member",
  {
    title: "Remove a project member",
    description:
      "Revoke a uid's access by removing it from the project's roster. The design data is " +
      "untouched; the uid simply can no longer read or write the project.",
    inputSchema: {
      uid: z.string().min(1).describe("The user id to revoke."),
    },
  },
  async ({ uid }) => {
    try {
      await removeMember(getConfig(), uid);
      return ok({ uid, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[forward-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[forward-mcp] fatal:", err);
  process.exit(1);
});
