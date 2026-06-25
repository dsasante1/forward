import { z } from "zod";

/**
 * The data contract shared by the VS Code extension and the web canvas.
 *
 * Mirrors the Firebase Realtime Database JSON tree. Keep this flat (Firebase
 * favours shallow trees) and treat it as the single source of truth: if a shape
 * changes, change it here once and both apps follow.
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
// API binding (the backend documentation — pillar 2)
// --------------------------------------------------------------------------

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/**
 * Documentation a backend dev attaches to a design element from VS Code.
 *
 * Docs-first and framework-agnostic. `title` + Markdown `description` are the
 * core and carry the meaning; `language`, `method`, `endpoint` and `parameters`
 * are OPTIONAL structured hints for REST-style HTTP endpoints. A GraphQL, gRPC,
 * CLI or background-job binding just fills in `title` + `language` + the docs
 * and leaves the HTTP fields blank — nothing here assumes Express or JavaScript.
 */
export const ApiBinding = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  /** Free-form language/framework tag, e.g. "Python/FastAPI", "Go", "GraphQL". */
  language: z.string().optional(),
  /** Optional HTTP hints — present for REST endpoints, omitted otherwise. */
  method: HttpMethod.optional(),
  endpoint: z.string().optional(),
  parameters: z.array(z.string()).default([]),
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

/** Visual styling — all optional, sensible defaults applied at render time. */
export const Style = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  radius: z.number().nonnegative().optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
});
export type Style = z.infer<typeof Style>;

/**
 * A single element on the design canvas. Geometry is absolute (canvas space);
 * `parentId` records hierarchy/nesting. `apiBinding` is the optional backend
 * annotation. `componentId` links an instance back to its master component.
 */
export const DesignElement = z.object({
  id: z.string().min(1),
  type: ElementType,
  name: z.string().default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  parentId: z.string().nullable().default(null),
  text: z.string().optional(),
  style: Style.optional(),
  /** Rotation in degrees, clockwise, about the element's center. */
  rotation: z.number().default(0),
  /** For type === "instance": the id of the source component element. */
  componentId: z.string().optional(),
  /** Optional API documentation attached by the backend from VS Code. */
  apiBinding: ApiBinding.optional(),
  /** ISO-8601 timestamp of the last write. */
  updatedAt: z.string().datetime(),
});
export type DesignElement = z.infer<typeof DesignElement>;

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
  "group", // a container box that visually groups other nodes
]);
export type InfraKind = z.infer<typeof InfraKind>;

/**
 * One box in the infrastructure diagram. Project-scoped and standalone — it does
 * NOT reference a design element. Geometry mirrors DesignElement (absolute canvas
 * space) so the existing pan/zoom/geometry helpers apply unchanged; `parentId`
 * nests a node inside a "group" container.
 */
export const InfraNode = z.object({
  id: z.string().min(1),
  kind: InfraKind,
  /** Display name, e.g. "PostgreSQL", "GitHub Actions". */
  label: z.string().min(1),
  /** Optional version/runtime tag, e.g. "v15", "Node 20". */
  tech: z.string().optional(),
  /** Free-form Markdown notes (rendered with the same subset as apiBinding). */
  description: z.string().default(""),
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
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
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
  from: z.string().min(1),
  /** Target infra node id. */
  to: z.string().min(1),
  /** What happens here, e.g. "writes verification token". */
  label: z.string().default(""),
  /** Call style — arrowhead on the overlay, arrow token in Mermaid. */
  kind: InfraStepKind.default("sync"),
  /** Optional design element id whose apiBinding drives this hop. */
  endpointId: z.string().optional(),
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
  id: z.string().min(1),
  /** Display name, e.g. "User signup". */
  name: z.string().min(1),
  /** Free-form Markdown overview (same subset as apiBinding/description). */
  description: z.string().default(""),
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
// serialises to a Mermaid `erDiagram` for export/print — the one UML grammar the
// infra serializers don't cover. Geometry mirrors InfraNode/DesignElement so the
// same canvas pan/zoom/geometry helpers apply unchanged.

/** A key role an entity field can carry — PK (primary), FK (foreign), UK (unique). */
export const EntityKey = z.enum(["PK", "FK", "UK"]);
export type EntityKey = z.infer<typeof EntityKey>;

/** One attribute (column/field) of an entity. */
export const EntityField = z.object({
  name: z.string().min(1),
  /** Free-form data type, e.g. "uuid", "varchar", "int". */
  type: z.string().default(""),
  /** Zero or more key roles; an empty array is a plain attribute. */
  keys: z.array(EntityKey).default([]),
  /** Optional comment, rendered in quotes after the attribute. */
  note: z.string().optional(),
});
export type EntityField = z.infer<typeof EntityField>;

/**
 * One box in the ER diagram — a table/model with its attributes. Project-scoped
 * and standalone (does NOT reference a design element or infra node). Geometry
 * mirrors InfraNode so the existing geometry helpers apply; `parentId` nests it
 * inside a "group"-style container if one is ever added to this layer.
 */
export const Entity = z.object({
  id: z.string().min(1),
  /** Entity/table name, e.g. "Invoice", "VehicleOwnerProfile". */
  name: z.string().min(1),
  fields: z.array(EntityField).default([]),
  /** Free-form Markdown notes (same subset as apiBinding/description). */
  description: z.string().default(""),
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
 * UML/crow's-foot convention. Relations touching a missing entity are skipped on
 * render — the same "skip dangling" rule the infra serializers use.
 */
export const EntityRelation = z.object({
  id: z.string().min(1),
  /** Source entity id. */
  from: z.string().min(1),
  /** Target entity id. */
  to: z.string().min(1),
  fromCardinality: RelationCardinality.default("exactly-one"),
  toCardinality: RelationCardinality.default("zero-or-many"),
  /** The relationship verb, e.g. "places", "holds", "billed". */
  label: z.string().optional(),
  /** Solid (identifying) vs dashed (non-identifying) line. */
  identifying: z.boolean().default(true),
  updatedAt: z.string().datetime(),
});
export type EntityRelation = z.infer<typeof EntityRelation>;

// --------------------------------------------------------------------------
// Task layer (the work tracker — pillar 4)
// --------------------------------------------------------------------------

/** Lifecycle of a work item. Drives the column/colour in the task panel. */
export const TaskStatus = z.enum(["todo", "in_progress", "blocked", "done"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** What kind of work the item is — colours the type dot/badge in the tracker. */
export const TaskType = z.enum(["bug", "feature", "task"]);
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
  id: z.string().min(1),
  kind: TaskActivityKind,
  /** uid of who did it (resolved to a display name on read against the roster). */
  actor: z.string(),
  /** ISO-8601 timestamp of the entry. */
  at: z.string().datetime(),
  /** comment: the Markdown body. */
  body: z.string().optional(),
  /** event: the verb phrase, e.g. "changed status to". */
  verb: z.string().optional(),
  /** event: a free-text value the verb acts on, e.g. a person or a date. */
  target: z.string().optional(),
  /** event: short chip text (a label or priority name). */
  badge: z.string().optional(),
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
  id: z.string().min(1),
  /** Short human-facing key, e.g. "FWD-12" — assigned on create. */
  key: z.string().optional(),
  title: z.string().min(1),
  /** Free-form Markdown notes (same subset as apiBinding/description). */
  description: z.string().default(""),
  type: TaskType.default("task"),
  status: TaskStatus.default("todo"),
  priority: TaskPriority.default("medium"),
  /** Free-form label names (e.g. "bug", "backend"). */
  labels: z.array(z.string()).default([]),
  /** uids from the project's `project_members` roster doing the work. */
  assignees: z.array(z.string()).default([]),
  /** uid of the member who filed the task. */
  reporter: z.string().optional(),
  /** Free-form due-date label (an ISO date or a short label like "Jun 24"). */
  dueDate: z.string().optional(),
  /** Optional link to the design element this task concerns. */
  elementId: z.string().optional(),
  /** Optional link to the narrated infra flow this task implements. */
  flowId: z.string().optional(),
  /** Optional link to the element whose apiBinding defines the endpoint. */
  endpointId: z.string().optional(),
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
  layer: z.enum(["API", "INFRA", "DESIGN", "UML"]),
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
  id: z.string().min(1),
  title: z.string().min(1),
  /** Free-form Markdown note (same subset as task/apiBinding descriptions). */
  description: z.string().default(""),
  tag: CheckpointTag.default("checkpoint"),
  /** uid of the member who saved it — stamped by the server from the session. */
  author: z.string().optional(),
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
  title: z.string().min(1),
  description: z.string().default(""),
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
  title: z.string(),
  method: HttpMethod.optional(),
  path: z.string().optional(),
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
  cols: z.array(z.string()).default([]),
});
export type DiffRow = z.infer<typeof DiffRow>;

/** A labelled group of diff rows, e.g. "request · body.email" or "responses". */
export const DiffSection = z.object({
  label: z.string(),
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
  breaking: z.string().optional(),
  sections: z.array(DiffSection).default([]),
});
export type VersionDiff = z.infer<typeof VersionDiff>;

/** One immutable entry in an element's append-only history. */
export const VersionEntry = z.object({
  version: z.string(),
  timestamp: z.number().int(),
  author: z.string(),
  action: VersionAction.default("modified"),
  commitHash: z.string().optional(),
  changeLog: z.string().default(""),
  /** The version this entry superseded, for a "v1.1.0 → v1.2.0" transition. */
  previousVersion: z.string().optional(),
  /** Endpoint method/path/title at write time — needed to render deletions. */
  endpoint: EndpointSnapshot.optional(),
  /** Optional structured diff the timeline expands to show (see VersionDiff). */
  diff: VersionDiff.optional(),
});
export type VersionEntry = z.infer<typeof VersionEntry>;

/**
 * Which of the four data layers a project-timeline event belongs to, driving the
 * History view's Design / API / Infra / UML grouping + per-domain colouring.
 * `design`/`api` come from design-element + binding changes, `infra` from the
 * node/edge graph, `uml` from the narrated flows.
 */
export const TimelineDomain = z.enum(["design", "api", "infra", "uml"]);
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
  targetId: z.string(),
  /** Human label — the element/node/flow name, or the endpoint for `api`. */
  title: z.string().default(""),
  /** One-line context (e.g. "Linked payments-db to checkout-svc"). */
  detail: z.string().default(""),
  author: z.string().default(""),
  /** Epoch ms the change landed. */
  timestamp: z.number().int(),
});
export type ProjectTimelineEvent = z.infer<typeof ProjectTimelineEvent>;

export const UserConfig = z.object({
  repositoryUrl: z.string().url().optional(),
  projectName: z.string().min(1),
});
export type UserConfig = z.infer<typeof UserConfig>;

// --------------------------------------------------------------------------
// Access control (per-project membership)
// --------------------------------------------------------------------------

/**
 * Role of a uid within a project, in increasing privilege:
 *   - `viewer` — read-only: may read every layer, may not mutate anything.
 *   - `editor` — read + write design/binding/infra/tasks; may not manage members.
 *   - `owner`  — everything an editor can do, plus managing the roster + invites.
 * The first authenticated user to create a project claims it as `owner`. Write
 * vs read is enforced server-side (the centralized backend), not by convention.
 */
export const ProjectRole = z.enum(["viewer", "editor", "owner"]);
export type ProjectRole = z.infer<typeof ProjectRole>;

/** Roles that may write (mutate) project data — everything above read-only. */
export const WRITE_ROLES: readonly ProjectRole[] = ["editor", "owner"];

/** One entry in a project's member roster: `project_members/$projectId/$uid`. */
export const ProjectMember = z.object({
  role: ProjectRole.default("editor"),
  /** ISO-8601 timestamp the membership was granted. */
  addedAt: z.string(),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

/** Lifecycle of an email invitation to a project. */
export const InviteStatus = z.enum(["pending", "accepted", "revoked", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatus>;

/**
 * An email invitation granting a person `role` on a project once they accept.
 * The owner creates it (the backend emails a tokenized link); the invitee signs
 * in and accepts, at which point a `ProjectMember` row is created. The opaque
 * `token` is the capability carried in the link and is never shown in listings.
 */
export const ProjectInvite = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  email: z.string().email(),
  role: ProjectRole.default("editor"),
  status: InviteStatus.default("pending"),
  /** Clerk uid of the owner who sent it. */
  invitedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().optional(),
});
export type ProjectInvite = z.infer<typeof ProjectInvite>;

/**
 * Full Firebase tree (handy for fixtures / offline mode).
 * Keyed maps mirror Firebase's object-as-collection convention.
 */
export const DatabaseTree = z.object({
  user_configs: z.record(UserConfig).default({}),
  /** Per-project access roster — gates every project-scoped subtree below. */
  project_members: z.record(z.record(ProjectMember)).default({}),
  design_elements: z.record(z.record(DesignElement)).default({}),
  version_timeline: z.record(z.record(z.array(VersionEntry))).default({}),
  infra_nodes: z.record(z.record(InfraNode)).default({}),
  infra_edges: z.record(z.record(InfraEdge)).default({}),
  infra_flows: z.record(z.record(InfraFlow)).default({}),
  entities: z.record(z.record(Entity)).default({}),
  entity_relations: z.record(z.record(EntityRelation)).default({}),
  tasks: z.record(z.record(Task)).default({}),
  checkpoints: z.record(z.record(Checkpoint)).default({}),
});
export type DatabaseTree = z.infer<typeof DatabaseTree>;

/** RTDB path helpers — the one place paths are constructed. */
export const paths = {
  element: (projectId: string, elementId: string) =>
    `design_elements/${projectId}/${elementId}`,
  projectElements: (projectId: string) => `design_elements/${projectId}`,
  /** Just the apiBinding sub-tree of one element — what VS Code writes to. */
  apiBinding: (projectId: string, elementId: string) =>
    `design_elements/${projectId}/${elementId}/apiBinding`,
  timeline: (projectId: string, elementId: string) =>
    `version_timeline/${projectId}/${elementId}`,
  /** All element histories of a project — what the timeline views read. */
  projectTimelines: (projectId: string) => `version_timeline/${projectId}`,
  userConfig: (userId: string) => `user_configs/${userId}`,
  // Per-project access roster (membership ACL).
  projectMembers: (projectId: string) => `project_members/${projectId}`,
  projectMember: (projectId: string, uid: string) =>
    `project_members/${projectId}/${uid}`,
  // Infrastructure graph — project-scoped, separate from design_elements.
  infraNodes: (projectId: string) => `infra_nodes/${projectId}`,
  infraNode: (projectId: string, nodeId: string) =>
    `infra_nodes/${projectId}/${nodeId}`,
  infraEdges: (projectId: string) => `infra_edges/${projectId}`,
  infraEdge: (projectId: string, edgeId: string) =>
    `infra_edges/${projectId}/${edgeId}`,
  // Narrated flows over the infra graph — project-scoped, walk infra_nodes.
  infraFlows: (projectId: string) => `infra_flows/${projectId}`,
  infraFlow: (projectId: string, flowId: string) =>
    `infra_flows/${projectId}/${flowId}`,
  // ER / data model — project-scoped, separate graph of entities + relations.
  entities: (projectId: string) => `entities/${projectId}`,
  entity: (projectId: string, entityId: string) =>
    `entities/${projectId}/${entityId}`,
  entityRelations: (projectId: string) => `entity_relations/${projectId}`,
  entityRelation: (projectId: string, relationId: string) =>
    `entity_relations/${projectId}/${relationId}`,
  // Task tracker — project-scoped, stands apart but links into the other layers.
  tasks: (projectId: string) => `tasks/${projectId}`,
  task: (projectId: string, taskId: string) => `tasks/${projectId}/${taskId}`,
  // Manual, named canvas snapshots — project-scoped, stands apart like tasks.
  checkpoints: (projectId: string) => `checkpoints/${projectId}`,
  checkpoint: (projectId: string, checkpointId: string) =>
    `checkpoints/${projectId}/${checkpointId}`,
} as const;
