import { z } from "zod";

/**
 * The data contract shared by the VS Code extension and the web canvas.
 *
 * Treat it as the single source of truth: if a shape changes, change it here once
 * and every surface follows. The server stores each layer as a validated JSON
 * column, so both the client and the backend speak the identical contract.
 *
 * Three layers, intentionally separate:
 *   1. DESIGN  — what a designer draws on the canvas (frames, shapes, text,
 *      components). This is the primary artefact and exists on its own.
 *   2. API BINDING — an OPTIONAL documentation note the backend attaches to a
 *      design element from VS Code. Most elements never get one.
 *   3. INFRASTRUCTURE — an OPTIONAL, PROJECT-SCOPED diagram of the tools,
 *      frameworks, databases and DevOps resources behind the project. Unlike an
 *      apiBinding it is not attached to any design element: it is its own graph
 *      of nodes + edges, rendered as a separate overlay.
 *
 * So: a design element MAY own an apiBinding; an endpoint is never a first-class
 * canvas object by itself; and the infrastructure graph stands entirely apart
 * from the design elements.
 */

// --------------------------------------------------------------------------
// String bounds
// --------------------------------------------------------------------------
// Upper bounds on user-authored strings. Generous — no legitimate value comes
// near them, so every already-stored row keeps parsing on read — but they stop
// a runaway client from persisting megabytes through a name field, which every
// list fetch and checkpoint snapshot would then drag along forever.

/** Ids, names, titles, labels and other one-liners. */
export const SHORT_TEXT_MAX = 500;
/** Markdown bodies, diff lines, change logs. */
export const LONG_TEXT_MAX = 100_000;

// --------------------------------------------------------------------------
// API binding (the backend documentation — pillar 2)
// --------------------------------------------------------------------------

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/**
 * Documentation a backend dev attaches to a design element from VS Code.
 *
 * Docs-first and framework-agnostic: `title` + Markdown `description` carry the
 * meaning for any kind of binding (REST, GraphQL, gRPC, CLI, a background job…).
 * Nothing here assumes Express or JavaScript.
 */
export const ApiBinding = z.object({
  title: z.string().min(1).max(SHORT_TEXT_MAX),
  description: z.string().max(LONG_TEXT_MAX).default(""),
});
export type ApiBinding = z.infer<typeof ApiBinding>;

// --------------------------------------------------------------------------
// Design layer (what the designer draws — pillar 1)
// --------------------------------------------------------------------------

export const ElementType = z.enum([
  "frame", // a container / screen
  "rectangle", // generic box (buttons, cards, inputs…)
  "ellipse", // a circle / oval (drawn within its bounding box)
  "text", // a text label
  "component", // a reusable master definition
  "instance", // a placed copy of a component
]);
export type ElementType = z.infer<typeof ElementType>;

/**
 * Per-corner border radius. Each corner is optional and, when absent, falls
 * back to the uniform `Style.radius`. Present only when a corner has been
 * customised away from the uniform value.
 */
export const CornerRadii = z
  .object({
    tl: z.number().nonnegative().describe("Top-left corner radius."),
    tr: z.number().nonnegative().describe("Top-right corner radius."),
    br: z.number().nonnegative().describe("Bottom-right corner radius."),
    bl: z.number().nonnegative().describe("Bottom-left corner radius."),
  })
  .partial();
export type CornerRadii = z.infer<typeof CornerRadii>;

/** Line style for an element's border. */
export const StrokeStyle = z.enum(["solid", "dashed", "dotted"]);
export type StrokeStyle = z.infer<typeof StrokeStyle>;

/**
 * Per-side border width. Each side is optional and, when absent, falls back to
 * the uniform `Style.strokeWidth`. Present only when a side has been customised
 * away from the uniform value.
 */
export const SideWidths = z
  .object({
    top: z.number().nonnegative().describe("Top border width."),
    right: z.number().nonnegative().describe("Right border width."),
    bottom: z.number().nonnegative().describe("Bottom border width."),
    left: z.number().nonnegative().describe("Left border width."),
  })
  .partial();
export type SideWidths = z.infer<typeof SideWidths>;

/** Visual styling — all optional, sensible defaults applied at render time. */
export const Style = z.object({
  fill: z.string().max(SHORT_TEXT_MAX).optional(),
  stroke: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Uniform border width. `strokeWidths` overrides individual sides when set. */
  strokeWidth: z
    .number()
    .nonnegative()
    .optional()
    .describe("Uniform border width for all four sides."),
  /** Per-side overrides; each side falls back to `strokeWidth` when omitted. */
  strokeWidths: SideWidths.optional().describe(
    "Per-side border widths {top,right,bottom,left}; each side falls back to `strokeWidth` when omitted. Use to weight sides independently; an empty {} clears overrides back to the uniform width.",
  ),
  /** Border line style; defaults to solid when omitted. */
  strokeStyle: StrokeStyle.optional().describe(
    "Border line style: solid (default), dashed, or dotted.",
  ),
  /** Uniform corner radius. `radii` overrides individual corners when set. */
  radius: z
    .number()
    .nonnegative()
    .optional()
    .describe("Uniform corner radius for all four corners."),
  /** Per-corner overrides; each corner falls back to `radius` when omitted. */
  radii: CornerRadii.optional().describe(
    "Per-corner radius overrides {tl,tr,br,bl}; each corner falls back to `radius` when omitted. Use to round corners independently; an empty {} clears overrides back to the uniform radius.",
  ),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().optional(),
  fontFamily: z.string().max(SHORT_TEXT_MAX).optional(),
  color: z.string().max(SHORT_TEXT_MAX).optional(),
});
export type Style = z.infer<typeof Style>;

/**
 * Where an element came from when it was generated rather than drawn. Only
 * `kind: "code"` exists today: the element was imported from a running
 * frontend (`forward capture` / `import_design_from_code`). Its presence marks
 * the element as a draft that re-importing the same code may update; a designer
 * "adopts" it by removing `origin`, after which import never touches it again.
 *
 * `hash` is the design hash ({@link designHash} in design-import.ts) of the
 * element as last imported. Re-import overwrites only while the element still
 * hashes to it, so a draft someone has edited is reported as a conflict instead.
 */
export const ElementOrigin = z.object({
  kind: z.literal("code"),
  /** The page route the element was captured on, e.g. "/login". */
  route: z.string().max(SHORT_TEXT_MAX),
  /** Viewport the route was captured at, e.g. "1440x900". */
  viewport: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Stable key of the source DOM node within the route (testid, id or path). */
  key: z.string().max(SHORT_TEXT_MAX),
  /** Source location when known, e.g. "src/Login.tsx:42". */
  source: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Frontend component that rendered it, when known (React dev builds). */
  component: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Design hash of the element as last imported. */
  hash: z.string().max(SHORT_TEXT_MAX),
  /** ISO-8601 time of the import that last wrote it (stamped by the backend). */
  importedAt: z.string().datetime(),
});
export type ElementOrigin = z.infer<typeof ElementOrigin>;

/**
 * A code draft someone deleted, remembered so the next import doesn't bring it
 * back (`.forward/dismissed/<id>.json`). It keeps what the draft looked like —
 * position relative to its page frame — so a draft whose key shifted can still
 * be recognised as the dismissed one. Importing with `restoreDismissed` brings
 * dismissed drafts back; pruning forgets the ones the code no longer renders.
 */
export const DismissedDraft = z.object({
  /** The deleted draft's element id. */
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  route: z.string().max(SHORT_TEXT_MAX),
  viewport: z.string().max(SHORT_TEXT_MAX).optional(),
  key: z.string().max(SHORT_TEXT_MAX),
  type: ElementType,
  name: z.string().max(SHORT_TEXT_MAX).default(""),
  text: z.string().max(LONG_TEXT_MAX).optional(),
  /** The parent it sat in, so look-alike siblings can still be told apart by order. */
  parentId: z.string().max(SHORT_TEXT_MAX).nullable().optional(),
  /** For a container: the text it held, so it isn't mistaken for a look-alike. */
  signature: z.string().max(LONG_TEXT_MAX).optional(),
  /** Offset from the page frame's top-left. */
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  dismissedAt: z.string().datetime(),
  /** Who deleted it (stamped by the backend). */
  by: z.string().max(SHORT_TEXT_MAX).default(""),
});
export type DismissedDraft = z.infer<typeof DismissedDraft>;

/**
 * A single element on the design canvas. Geometry is absolute (canvas space);
 * `parentId` records hierarchy/nesting. `apiBinding` is the optional backend
 * annotation. `componentId` links an instance back to its master component.
 */
export const DesignElement = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  type: ElementType,
  name: z.string().max(SHORT_TEXT_MAX).default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  parentId: z.string().nullable().default(null),
  /**
   * Stacking order among siblings: higher `z` paints later, i.e. on top. The
   * canvas assigns it at creation (and on bring-to-front / send-to-back) so the
   * true z-order is persisted rather than left implicit in load order — every
   * surface that reconstructs the design (canvas render, layers tree, history
   * previews) sorts by it. Defaults to 0 so pre-`z` records still parse.
   */
  z: z.number().default(0),
  text: z.string().max(LONG_TEXT_MAX).optional(),
  style: Style.optional(),
  /** Rotation in degrees, clockwise, about the element's center. */
  rotation: z.number().default(0),
  /** For type === "instance": the id of the source component element. */
  componentId: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Optional API documentation attached by the backend from VS Code. */
  apiBinding: ApiBinding.optional(),
  /** Set when the element was generated from frontend code; absent once adopted. */
  origin: ElementOrigin.optional(),
  /** ISO-8601 timestamp of the last write. */
  updatedAt: z.string().datetime(),
});
export type DesignElement = z.infer<typeof DesignElement>;

/**
 * A design element as accepted by the writer clients' `saveElement`: the full
 * element MINUS `apiBinding`. The central server owns the binding through
 * `bind()`/`unbind()` (so it can version it) and deliberately ignores any binding
 * sent via `saveElement`. Encoding that here turns "don't persist a binding
 * through saveElement" from a comment (which drifts) into a **compile error** at
 * every call site. `apiBinding?: never` rather than a bare
 * `Omit` so passing a *bound* element is rejected structurally, not silently
 * widened away.
 */
export type SaveableElement = Omit<DesignElement, "apiBinding"> & {
  apiBinding?: never;
};

/**
 * Drop the binding so an element can legally go through `saveElement` (see
 * {@link SaveableElement}). Use at the call site to make the intent explicit:
 * geometry/style is saved here; documentation is saved via `bind()`/`unbind()`.
 */
export function withoutBinding(element: DesignElement): SaveableElement {
  const { apiBinding: _drop, ...rest } = element;
  return rest;
}

/**
 * Total order for stacking two design elements *within the same parent*: lower
 * `z` first (so a higher `z` paints later = on top). Ties fall back to text-last
 * — a label is never hidden behind an equal-`z` fill, which also keeps pre-`z`
 * snapshots (whose elements all default to `z = 0`) legible — then id, so the
 * order is deterministic and identical across every surface.
 */
export function compareStacking(a: DesignElement, b: DesignElement): number {
  if (a.z !== b.z) return a.z - b.z;
  const at = a.type === "text" ? 1 : 0;
  const bt = b.type === "text" ? 1 : 0;
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The canonical paint/stacking order for a flat set of design elements:
 * depth-first pre-order (each element immediately followed by its own subtree,
 * so a parent always paints *under* its children) with siblings sorted by
 * {@link compareStacking}. This is the single source of truth for "what draws on
 * top of what" — the canvas renders in it, the layers tree lists it, and the
 * history/checkpoint previews reuse it, so every surface agrees. An element whose
 * parent isn't in the set is treated as a root; a `parentId` cycle can neither
 * drop nor loop an element.
 */
export function paintOrder(elements: DesignElement[]): DesignElement[] {
  const present = new Set(elements.map((e) => e.id));
  const childrenByParent = new Map<string | null, DesignElement[]>();
  for (const el of elements) {
    const key = el.parentId && present.has(el.parentId) ? el.parentId : null;
    const list = childrenByParent.get(key);
    if (list) list.push(el);
    else childrenByParent.set(key, [el]);
  }
  for (const list of childrenByParent.values()) list.sort(compareStacking);
  const out: DesignElement[] = [];
  const seen = new Set<string>();
  const visit = (key: string | null): void => {
    for (const el of childrenByParent.get(key) ?? []) {
      if (seen.has(el.id)) continue; // guard against a parentId cycle
      seen.add(el.id);
      out.push(el);
      visit(el.id);
    }
  };
  visit(null);
  // Defensive: an element unreachable from any root (e.g. a cycle) still surfaces.
  for (const el of elements) if (!seen.has(el.id)) out.push(el);
  return out;
}

/**
 * Ids of every descendant of `id` (children, grandchildren, …) by `parentId`,
 * so a delete or move can cascade through a frame's whole subtree — the same
 * containment rule the canvas applies. The starting id itself is not included.
 */
export function descendantIds(
  id: string,
  elements: Array<Pick<DesignElement, "id" | "parentId">>,
): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const el of elements) {
      if (el.parentId === current && !out.includes(el.id)) {
        out.push(el.id);
        stack.push(el.id);
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Infrastructure layer (the architecture diagram — pillar 3)
// --------------------------------------------------------------------------

/** What a node represents — drives its colour/icon in the overlay. */
export const InfraKind = z.enum([
  "frontend", // web/mobile client
  "backend", // API server / app service
  "database", // SQL/NoSQL store
  "cache", // Redis, Memcached…
  "queue", // Kafka, SQS, RabbitMQ…
  "service", // internal microservice
  "devops", // CI/CD, container, IaC, monitoring
  "external", // third-party / SaaS dependency
  "actor", // a person — user/admin/human initiating a journey (not a system component)
  "group", // a container box that visually groups other nodes
]);
export type InfraKind = z.infer<typeof InfraKind>;

/** Which deployment environment a node lives in. Optional — many diagrams don't
 * distinguish, so old records (and nodes the author never tagged) simply omit it. */
export const InfraEnv = z.enum(["dev", "staging", "prod"]);
export type InfraEnv = z.infer<typeof InfraEnv>;

/**
 * One box in the infrastructure diagram. Project-scoped and standalone — it does
 * NOT reference a design element. Geometry mirrors DesignElement (absolute canvas
 * space) so the existing pan/zoom/geometry helpers apply unchanged; `parentId`
 * nests a node inside a "group" container.
 */
export const InfraNode = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  kind: InfraKind,
  /** Display name, e.g. "PostgreSQL", "GitHub Actions". */
  label: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Optional version/runtime tag, e.g. "v15", "Node 20". */
  tech: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Optional deployment environment (dev/staging/prod). */
  env: InfraEnv.optional(),
  /** Free-form Markdown notes (rendered with the same subset as apiBinding). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative().default(160),
  height: z.number().nonnegative().default(72),
  parentId: z.string().nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type InfraNode = z.infer<typeof InfraNode>;

/** A directed connection between two infra nodes (e.g. "reads/writes"). */
export const InfraEdge = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  from: z.string().min(1).max(SHORT_TEXT_MAX),
  to: z.string().min(1).max(SHORT_TEXT_MAX),
  label: z.string().max(SHORT_TEXT_MAX).optional(),
  updatedAt: z.string().datetime(),
});
export type InfraEdge = z.infer<typeof InfraEdge>;

/**
 * How a step calls across the wire — drives the arrowhead style on the overlay
 * and the arrow token in the exported Mermaid sequence diagram:
 *   sync  → a request that waits         (Mermaid `->>`)
 *   async → fire-and-forget / a publish  (Mermaid `-)`)
 *   reply → a response back to caller    (Mermaid `-->>`)
 */
export const InfraStepKind = z.enum(["sync", "async", "reply"]);
export type InfraStepKind = z.infer<typeof InfraStepKind>;

/**
 * One hop in an InfraFlow: node `from` does something to node `to`. `from`/`to`
 * are InfraNode ids (looked up in the same infraNodes map the overlay draws), so
 * a step duplicates no geometry — both renderers resolve it against the nodes.
 * The optional `endpointId` ties the hop to a design element's apiBinding, which
 * is what turns a generic arrow into "called by POST /auth/verify".
 */
export const InfraFlowStep = z.object({
  /** Source infra node id. */
  from: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Target infra node id. */
  to: z.string().min(1).max(SHORT_TEXT_MAX),
  /** What happens here, e.g. "writes verification token". */
  label: z.string().max(SHORT_TEXT_MAX).default(""),
  /** Call style — arrowhead on the overlay, arrow token in Mermaid. */
  kind: InfraStepKind.default("sync"),
  /** Optional design element id whose apiBinding drives this hop. */
  endpointId: z.string().max(SHORT_TEXT_MAX).optional(),
  /**
   * Optional branch guard, e.g. "token valid" or "409 duplicate". Consecutive
   * steps sharing the same `condition` are wrapped in one Mermaid `alt`/`else`
   * block, so an endpoint's success and error paths render as a single diagram
   * instead of separate flows. Steps with no `condition` stay unconditional.
   */
  condition: z.string().max(SHORT_TEXT_MAX).optional(),
});
export type InfraFlowStep = z.infer<typeof InfraFlowStep>;

/**
 * A narrated path through the infrastructure graph — the fourth pillar, layered
 * on top of the standalone infra nodes/edges. A flow is project-scoped and is a
 * pure function of its `steps` + the existing infraNodes map: the SVG overlay
 * highlights the steps' nodes and draws numbered arrows through them, and the
 * same steps serialise to a Mermaid `sequenceDiagram` for export/print. No
 * duplicated geometry — both renderers walk these steps.
 */
export const InfraFlow = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Display name, e.g. "User signup". */
  name: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Free-form Markdown overview (same subset as apiBinding/description). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  /** Ordered hops; rendered as numbered arrows + a numbered narrative. */
  steps: z.array(InfraFlowStep).default([]),
  updatedAt: z.string().datetime(),
});
export type InfraFlow = z.infer<typeof InfraFlow>;

// --------------------------------------------------------------------------
// Entity layer (the ER / data model — the structural data view)
// --------------------------------------------------------------------------
//
// A separate, project-scoped graph — like the infrastructure layer but for the
// DATA model rather than the runtime components. An `Entity` is a table/model;
// an `EntityRelation` is a crow's-foot association between two of them. It is its
// own standalone graph (it does NOT reference design elements or infra nodes) and
// serialises to a Mermaid `erDiagram` for export/print — the one diagram grammar the
// infra serializers don't cover. Geometry mirrors InfraNode/DesignElement so the
// same canvas pan/zoom/geometry helpers apply unchanged.

/** A key role an entity field can carry — PK (primary), FK (foreign), UK (unique). */
export const EntityKey = z.enum(["PK", "FK", "UK"]);
export type EntityKey = z.infer<typeof EntityKey>;

/** One attribute (column/field) of an entity. */
export const EntityField = z.object({
  name: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Free-form data type, e.g. "uuid", "varchar", "int". */
  type: z.string().max(SHORT_TEXT_MAX).default(""),
  /** Zero or more key roles; an empty array is a plain attribute. */
  keys: z.array(EntityKey).default([]),
  /** Optional comment, rendered in quotes after the attribute. */
  note: z.string().max(SHORT_TEXT_MAX).optional(),
});
export type EntityField = z.infer<typeof EntityField>;

/**
 * One box in the ER diagram — a table/model with its attributes. Project-scoped
 * and standalone (does NOT reference a design element or infra node). Geometry
 * mirrors InfraNode so the existing geometry helpers apply; `parentId` nests it
 * inside a "group"-style container if one is ever added to this layer.
 */
export const Entity = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Entity/table name, e.g. "Invoice", "VehicleOwnerProfile". */
  name: z.string().min(1).max(SHORT_TEXT_MAX),
  fields: z.array(EntityField).default([]),
  /** Free-form Markdown notes (same subset as apiBinding/description). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative().default(180),
  height: z.number().nonnegative().default(120),
  parentId: z.string().nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type Entity = z.infer<typeof Entity>;

/**
 * The multiplicity at one end of a relation, in crow's-foot terms. Maps to the
 * mirrored Mermaid glyphs (`|o`/`||`/`}o`/`}|` on the left, mirrored on the
 * right) in the ER serializer.
 */
export const RelationCardinality = z.enum([
  "zero-or-one",
  "exactly-one",
  "zero-or-many",
  "one-or-many",
]);
export type RelationCardinality = z.infer<typeof RelationCardinality>;

/**
 * A directed association between two entities. `from`/`to` are Entity ids; each
 * end carries its own cardinality. `identifying` picks the line style (solid when
 * the child cannot exist without the parent, dashed otherwise), mirroring the
 * crow's-foot convention. Relations touching a missing entity are skipped on
 * render — the same "skip dangling" rule the infra serializers use.
 */
export const EntityRelation = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Source entity id. */
  from: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Target entity id. */
  to: z.string().min(1).max(SHORT_TEXT_MAX),
  fromCardinality: RelationCardinality.default("exactly-one"),
  toCardinality: RelationCardinality.default("zero-or-many"),
  /** The relationship verb, e.g. "places", "holds", "billed". */
  label: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Solid (identifying) vs dashed (non-identifying) line. */
  identifying: z.boolean().default(true),
  updatedAt: z.string().datetime(),
});
export type EntityRelation = z.infer<typeof EntityRelation>;

// --------------------------------------------------------------------------
// Agent / MCP layer (the AI surface a project builds and consumes)
// --------------------------------------------------------------------------
// A standalone, project-scoped layer — like infra, it does NOT attach to a
// design element; geometry mirrors InfraNode so the existing pan/zoom/geometry
// helpers apply unchanged. The docs-first bodies (a tool's `description`, an
// agent's `systemPrompt`) are Markdown and version/diff exactly like an
// apiBinding.description, so this layer rides the same version_timeline +
// api-diff + History machinery the API layer already uses.

/** How an MCP server is reached — drives its icon in the overlay. */
export const McpTransport = z.enum(["stdio", "http", "sse"]);
export type McpTransport = z.infer<typeof McpTransport>;

/** Does the project *expose* this server, or *consume* a third-party one. */
export const McpOrigin = z.enum(["built", "consumed"]);
export type McpOrigin = z.infer<typeof McpOrigin>;

/**
 * One tool an MCP server exposes. The optional `endpointId` ties the tool to the
 * design element whose apiBinding it wraps — the same soft join
 * InfraFlowStep.endpointId uses, so "which documented endpoint does this tool
 * call" is a first-class, resolve-on-read reference (never an enforced FK).
 */
export const McpTool = z.object({
  name: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Free-form Markdown (rendered with the same subset as apiBinding). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  endpointId: z.string().max(SHORT_TEXT_MAX).optional(),
});
export type McpTool = z.infer<typeof McpTool>;

/**
 * One MCP server box in the Agents overlay. Project-scoped and standalone (does
 * NOT reference a design element). Geometry mirrors InfraNode (absolute canvas
 * space); `parentId` nests it inside a "group" container just like infra.
 */
export const McpServerNode = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Display name, e.g. "forward-mcp". */
  label: z.string().min(1).max(SHORT_TEXT_MAX),
  transport: McpTransport.default("stdio"),
  origin: McpOrigin.default("consumed"),
  /** Optional version/runtime tag, e.g. "Node 20". */
  tech: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Free-form Markdown notes (same subset as apiBinding). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  /** The tools this server exposes; each may wrap a documented endpoint. */
  tools: z.array(McpTool).default([]),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative().default(200),
  height: z.number().nonnegative().default(96),
  parentId: z.string().nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type McpServerNode = z.infer<typeof McpServerNode>;

/**
 * One agent box. `systemPrompt` is the diffable body (same role as
 * apiBinding.description); `mcpServerIds` wire the agent to the McpServerNodes it
 * can call (soft references resolved on read). Geometry mirrors InfraNode.
 */
export const AgentNode = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Display name, e.g. "catch-up-digest agent". */
  label: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Model id the agent runs on, e.g. "claude-opus-4-8". */
  model: z.string().max(SHORT_TEXT_MAX).optional(),
  /** The agent's system prompt — Markdown, diffed line-by-line in History. */
  systemPrompt: z.string().max(LONG_TEXT_MAX).default(""),
  /** Ids of the McpServerNodes this agent is wired to. */
  mcpServerIds: z.array(z.string().max(SHORT_TEXT_MAX)).default([]),
  /** Free-form Markdown notes (same subset as apiBinding). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative().default(200),
  height: z.number().nonnegative().default(96),
  parentId: z.string().nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type AgentNode = z.infer<typeof AgentNode>;

// --------------------------------------------------------------------------
// Task layer (the work tracker — pillar 4)
// --------------------------------------------------------------------------

/** Lifecycle of a work item. Drives the column/colour in the task panel. */
export const TaskStatus = z.enum(["todo", "in_progress", "blocked", "done"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * What kind of work the item is — colours the type dot/badge in the tracker.
 * A `milestone` is a zero-duration marker (a target date rather than a span);
 * the timeline renders it as a diamond instead of a bar.
 */
export const TaskType = z.enum(["bug", "feature", "task", "milestone"]);
export type TaskType = z.infer<typeof TaskType>;

/** How urgent the work is. Independent of status. */
export const TaskPriority = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

/**
 * One entry in a task's history feed. Two kinds share the shape:
 *   - `comment` — a human note (`body`, free-form Markdown).
 *   - `event`   — a system-style record of a change (`verb`, with an optional
 *                 `target` value and/or short `badge` chip), e.g.
 *                 verb "changed status to" target "In progress", or
 *                 verb "added label" badge "bug".
 * Activity is embedded on the task (oldest first) and written by whichever
 * surface mutates the task, so the feed travels with the work item.
 */
export const TaskActivityKind = z.enum(["comment", "event"]);
export type TaskActivityKind = z.infer<typeof TaskActivityKind>;

export const TaskActivity = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  kind: TaskActivityKind,
  /** uid of who did it (resolved to a display name on read against the roster). */
  actor: z.string().max(SHORT_TEXT_MAX),
  /** ISO-8601 timestamp of the entry. */
  at: z.string().datetime(),
  /** comment: the Markdown body. */
  body: z.string().max(LONG_TEXT_MAX).optional(),
  /** event: the verb phrase, e.g. "changed status to". */
  verb: z.string().max(SHORT_TEXT_MAX).optional(),
  /** event: a free-text value the verb acts on, e.g. a person or a date. */
  target: z.string().max(SHORT_TEXT_MAX).optional(),
  /** event: short chip text (a label or priority name). */
  badge: z.string().max(SHORT_TEXT_MAX).optional(),
});
export type TaskActivity = z.infer<typeof TaskActivity>;

/**
 * A project-scoped work item — the fourth, optional layer. Like the infra graph
 * it stands apart from the design elements rather than being attached to one,
 * but it optionally LINKS into the other layers so work tracks against what it's
 * about. All three links are independent and OPTIONAL:
 *   - `elementId`  → the DesignElement this task concerns.
 *   - `flowId`     → the narrated InfraFlow this task implements.
 *   - `endpointId` → the design element whose apiBinding defines the endpoint
 *                    (the same join InfraFlowStep.endpointId uses).
 * Links are soft references (stored ids, resolved lazily on read) — the layers
 * sync independently, so a task may briefly point at a deleted element; renderers
 * tolerate that rather than enforcing referential integrity.
 */
export const Task = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Short human-facing key, e.g. "FWD-12" — assigned on create. */
  key: z.string().max(SHORT_TEXT_MAX).optional(),
  title: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Free-form Markdown notes (same subset as apiBinding/description). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  type: TaskType.default("task"),
  status: TaskStatus.default("todo"),
  priority: TaskPriority.default("medium"),
  /** Free-form label names (e.g. "bug", "backend"). */
  labels: z.array(z.string().max(SHORT_TEXT_MAX)).default([]),
  /** uids from the project's `project_members` roster doing the work. */
  assignees: z.array(z.string().max(SHORT_TEXT_MAX)).default([]),
  /** uid of the member who filed the task. */
  reporter: z.string().max(SHORT_TEXT_MAX).optional(),
  /**
   * Optional planned start, a calendar date `YYYY-MM-DD`. The timeline (Gantt)
   * view starts the task's bar here; without it the bar starts on the day the
   * task was created. Strict, unlike `dueDate`, so every stored value plots.
   */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be an ISO date (YYYY-MM-DD).")
    .refine((s) => {
      const ms = Date.parse(`${s}T00:00:00Z`);
      return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(s);
    }, "Start date must be a real calendar date.")
    .optional(),
  /**
   * Due date, `YYYY-MM-DD`. Read leniently on purpose: tasks filed before due
   * dates had to be ISO may hold a label like "Jun 24", and a stricter schema
   * would make the store skip those files entirely. `RepoStore.saveTask`
   * rejects a new or changed non-ISO value; `forward validate` warns on old ones.
   */
  dueDate: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Optional link to the design element this task concerns. */
  elementId: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Optional link to the narrated infra flow this task implements. */
  flowId: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Optional link to the element whose apiBinding defines the endpoint. */
  endpointId: z.string().max(SHORT_TEXT_MAX).optional(),
  /**
   * Ids of other tasks this one depends on (finish-to-start): they should
   * complete before this one starts. Drives the timeline's dependency
   * connectors. Soft references resolved on read, like the layer links —
   * a dangling id (deleted task) is simply ignored, not an error.
   */
  dependsOn: z.array(z.string().max(SHORT_TEXT_MAX)).default([]),
  /** Chronological history of comments + events (oldest first). */
  activity: z.array(TaskActivity).default([]),
  /** ISO-8601 timestamp the task was created. */
  createdAt: z.string().datetime(),
  /** ISO-8601 timestamp of the last write. */
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof Task>;

// --------------------------------------------------------------------------
// Checkpoints (pillar 5) — manual, named snapshots of the canvas
// --------------------------------------------------------------------------
//
// Unlike the append-only endpoint `version_timeline` (automatic, per-element doc
// history), a checkpoint is a deliberate, whole-canvas save a member takes from
// the editor: a title + note describing *what changed and why*, and a frozen copy
// of the design + infra graph so it can be restored later. It stands apart from
// the design elements like the task tracker does — its own project-scoped subtree.

/** How a checkpoint is classified in the History view. */
export const CheckpointTag = z.enum(["milestone", "checkpoint", "wip"]);
export type CheckpointTag = z.infer<typeof CheckpointTag>;

/** A per-layer change-count chip shown on a checkpoint card (e.g. DESIGN +8). */
export const CheckpointChange = z.object({
  layer: z.enum(["API", "INFRA", "DESIGN", "FLOW"]),
  n: z.number().int().nonnegative(),
});
export type CheckpointChange = z.infer<typeof CheckpointChange>;

/**
 * The frozen project state a checkpoint captures. Theme + grid are per-user view
 * settings (localStorage), not project data, so they are intentionally excluded —
 * a restore only rewinds the shared design + infra graph.
 */
export const CheckpointSnapshot = z.object({
  elements: z.array(DesignElement).default([]),
  infraNodes: z.array(InfraNode).default([]),
  infraEdges: z.array(InfraEdge).default([]),
  infraFlows: z.array(InfraFlow).default([]),
});
export type CheckpointSnapshot = z.infer<typeof CheckpointSnapshot>;

export const Checkpoint = z.object({
  id: z.string().min(1).max(SHORT_TEXT_MAX),
  title: z.string().min(1).max(SHORT_TEXT_MAX),
  /** Free-form Markdown note (same subset as task/apiBinding descriptions). */
  description: z.string().max(LONG_TEXT_MAX).default(""),
  tag: CheckpointTag.default("checkpoint"),
  /** uid of the member who saved it — stamped by the server from the session. */
  author: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Per-layer change counts, for the card chips. */
  changes: z.array(CheckpointChange).default([]),
  /** The frozen design + infra state, replayed on restore. */
  snapshot: CheckpointSnapshot,
  /** ISO-8601 timestamp the checkpoint was saved. */
  createdAt: z.string().datetime(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

/**
 * What the editor sends to *create* a checkpoint. The server assembles the
 * snapshot, change counts, author, id and timestamp from the project's current
 * state, so a checkpoint always reflects the truly-persisted canvas, not whatever
 * the client happened to have in memory.
 */
export const CheckpointInput = z.object({
  title: z.string().min(1).max(SHORT_TEXT_MAX),
  description: z.string().max(LONG_TEXT_MAX).default(""),
  tag: CheckpointTag.default("checkpoint"),
});
export type CheckpointInput = z.infer<typeof CheckpointInput>;

// --------------------------------------------------------------------------
// Versioning + config
// --------------------------------------------------------------------------

/**
 * What an entry did to the endpoint's documentation. Drives the create/modify/
 * delete colouring in the project timeline (the git-graph view). Defaulted so
 * old entries written before this field existed still parse — `actionOf()` in
 * timeline.ts infers the real action for them from the change log.
 */
export const VersionAction = z.enum(["created", "modified", "deleted"]);
export type VersionAction = z.infer<typeof VersionAction>;

/**
 * A denormalised snapshot of the endpoint at the moment of the entry, so the
 * timeline can still label a *deleted* endpoint (whose apiBinding is gone, and
 * so can't be read back) with its method + path + title.
 */
export const EndpointSnapshot = z.object({
  title: z.string().max(SHORT_TEXT_MAX),
  method: HttpMethod.optional(),
  path: z.string().max(SHORT_TEXT_MAX).optional(),
});
export type EndpointSnapshot = z.infer<typeof EndpointSnapshot>;

/**
 * What a single diff row did to a documentation field. `added` / `removed`
 * colour the row green / red in the timeline's expanded diff; `unchanged` rows
 * give the change context (the surrounding field that stayed the same).
 */
export const DiffOp = z.enum(["added", "removed", "unchanged"]);
export type DiffOp = z.infer<typeof DiffOp>;

/**
 * One line of a documentation diff. `cols` are the cells of a small fixed table
 * (e.g. name / type / note), kept as free-form strings so any binding shape —
 * REST params, response codes, GraphQL fields — renders through the same view.
 */
export const DiffRow = z.object({
  op: DiffOp.default("unchanged"),
  cols: z.array(z.string().max(LONG_TEXT_MAX)).default([]),
});
export type DiffRow = z.infer<typeof DiffRow>;

/** A labelled group of diff rows, e.g. "request · body.email" or "responses". */
export const DiffSection = z.object({
  label: z.string().max(SHORT_TEXT_MAX),
  rows: z.array(DiffRow).default([]),
});
export type DiffSection = z.infer<typeof DiffSection>;

/**
 * The structured documentation diff for a history entry — what the timeline
 * expands to show. Entirely OPTIONAL: entries written before diffs existed (or
 * by tools that don't produce one) simply omit it and the timeline falls back
 * to the change-log line.
 */
export const VersionDiff = z.object({
  /** Counts surfaced as the `+a −r` badge on the collapsed card. */
  added: z.number().int().nonnegative().default(0),
  removed: z.number().int().nonnegative().default(0),
  /** If set, the change breaks clients — rendered as a warning callout. */
  breaking: z.string().max(SHORT_TEXT_MAX).optional(),
  sections: z.array(DiffSection).default([]),
});
export type VersionDiff = z.infer<typeof VersionDiff>;

/** One immutable entry in an element's append-only history. */
export const VersionEntry = z.object({
  version: z.string().max(SHORT_TEXT_MAX),
  timestamp: z.number().int(),
  author: z.string().max(SHORT_TEXT_MAX),
  action: VersionAction.default("modified"),
  commitHash: z.string().max(SHORT_TEXT_MAX).optional(),
  changeLog: z.string().max(LONG_TEXT_MAX).default(""),
  /** The version this entry superseded, for a "v1.1.0 → v1.2.0" transition. */
  previousVersion: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Endpoint method/path/title at write time — needed to render deletions. */
  endpoint: EndpointSnapshot.optional(),
  /** Optional structured diff the timeline expands to show (see VersionDiff). */
  diff: VersionDiff.optional(),
});
export type VersionEntry = z.infer<typeof VersionEntry>;

/**
 * Which data layer a project-timeline event belongs to, driving the History
 * view's Design / API / Infra / Flows / Agents grouping + per-domain colouring.
 * `design`/`api` come from design-element + binding changes, `infra` from the
 * node/edge graph, `flow` from the narrated flows, `agent` from the agent/MCP
 * server nodes.
 */
export const TimelineDomain = z.enum(["design", "api", "infra", "flow", "agent"]);
export type TimelineDomain = z.infer<typeof TimelineDomain>;

/**
 * One entry in the unified, project-wide activity feed the History timeline reads
 * — every create/modify/delete across the four layers, domain-tagged and stamped
 * by the server with `author` + `timestamp`. Unlike the per-element
 * `version_timeline` (API doc history only), this captures design, infra and flow
 * changes too, so the History view has a real event for each domain. `seq` is the
 * server's monotonic insert order, used as a stable id for selection/paging.
 */
export const ProjectTimelineEvent = z.object({
  seq: z.number().int(),
  domain: TimelineDomain,
  action: VersionAction.default("modified"),
  /** The element / node / edge / flow id this event is about. */
  targetId: z.string().max(SHORT_TEXT_MAX),
  /** Human label — the element/node/flow name, or the endpoint for `api`. */
  title: z.string().max(SHORT_TEXT_MAX).default(""),
  /** One-line context (e.g. "Linked payments-db to checkout-svc"). */
  detail: z.string().max(LONG_TEXT_MAX).default(""),
  author: z.string().max(SHORT_TEXT_MAX).default(""),
  /** Epoch ms the change landed. */
  timestamp: z.number().int(),
});
export type ProjectTimelineEvent = z.infer<typeof ProjectTimelineEvent>;

// --------------------------------------------------------------------------
// Contributor roster
// --------------------------------------------------------------------------

/**
 * A contributor's role, shown on the canvas Member view. In repo mode access is
 * whatever the git host grants; the roster is derived from git history (the
 * current author is `owner`, other contributors `editor`), so this is a label,
 * not an enforcement mechanism.
 */
export const ProjectRole = z.enum(["viewer", "editor", "owner"]);
export type ProjectRole = z.infer<typeof ProjectRole>;
