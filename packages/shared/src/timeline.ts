import { flowToMermaid, infraToComponentMermaid } from "./infra-flow.js";
import type {
  Checkpoint,
  DesignElement,
  DiffSection,
  ElementType,
  HttpMethod,
  InfraEdge,
  InfraFlow,
  InfraKind,
  InfraNode,
  InfraStepKind,
  ProjectTimelineEvent,
  TimelineDomain,
  VersionAction,
  VersionDiff,
  VersionEntry,
} from "./schema.js";

/**
 * Project-timeline helpers: turn the per-element `version_timeline` histories
 * into one chronological stream of endpoint events (created / modified /
 * deleted), lay that stream out as git-graph lanes, and collapse it into a
 * "what do I need to integrate / modify / remove" digest against a baseline.
 *
 * Everything here is pure and framework-free so both canvases (web + VS Code)
 * and the unit tests share one implementation.
 */

/** One flattened endpoint event: a VersionEntry lifted out with its element id. */
export interface TimelineEvent {
  elementId: string;
  action: VersionAction;
  timestamp: number;
  version: string;
  author: string;
  changeLog: string;
  commitHash?: string;
  /** Best available endpoint label (snapshot, else current binding, else id). */
  title: string;
  method?: HttpMethod;
  path?: string;
  /** Version this entry superseded, for a "prev → version" transition badge. */
  previousVersion?: string;
  /** Structured documentation diff, if the entry carries one (see VersionDiff). */
  diff?: VersionDiff;
}

/**
 * Resolve an entry's action. Newer entries carry it explicitly; entries written
 * before the field existed only have a change-log string, so fall back to its
 * conventional wording ("Add…" / "Removed…" / everything else is a modify).
 */
export function actionOf(entry: VersionEntry): VersionAction {
  if (entry.action) return entry.action;
  const log = entry.changeLog.toLowerCase();
  if (/^add|^creat/.test(log)) return "created";
  if (/^remov|^delet/.test(log)) return "deleted";
  return "modified";
}

/** Current endpoint label for an element that still carries a binding. */
export interface CurrentLabel {
  title?: string;
  method?: HttpMethod;
  path?: string;
}

/**
 * Flatten per-element histories into one stream sorted oldest → newest. Each
 * event's label comes from its own snapshot first, then the element's current
 * binding (for live endpoints whose old entries predate snapshots), then the id.
 */
export function flattenTimelines(
  byElement: Record<string, VersionEntry[]>,
  current: Record<string, CurrentLabel> = {},
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const [elementId, entries] of Object.entries(byElement)) {
    // Sort this element's own history first so each entry can name the version
    // it superseded (the previous chronological entry) when it doesn't already.
    const ordered = [...entries].sort((a, b) => a.timestamp - b.timestamp);
    ordered.forEach((entry, i) => {
      const label = entry.endpoint ?? current[elementId] ?? {};
      const previousVersion = entry.previousVersion ?? ordered[i - 1]?.version;
      out.push({
        elementId,
        action: actionOf(entry),
        timestamp: entry.timestamp,
        version: entry.version,
        author: entry.author,
        changeLog: entry.changeLog,
        ...(entry.commitHash ? { commitHash: entry.commitHash } : {}),
        title: label.title || elementId,
        ...(label.method ? { method: label.method } : {}),
        ...(label.path ? { path: label.path } : {}),
        ...(previousVersion ? { previousVersion } : {}),
        ...(entry.diff ? { diff: entry.diff } : {}),
      });
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

// --------------------------------------------------------------------------
// Git-graph lane layout
// --------------------------------------------------------------------------

/** One row of the git-graph rail: an event placed on a lane, with the other
 *  lanes that pass straight through this row drawn alongside it. */
export interface LaneRow {
  event: TimelineEvent;
  lane: number;
  /** Lanes (excluding the event's own) that have a line passing this row. */
  through: number[];
}

/**
 * Assign each endpoint a lane that opens at its `created` event and closes at
 * its `deleted` event (freed lanes are reused, like git branch columns). Input
 * must be chronological (oldest first); the returned rows are in the same order.
 * Re-creating a deleted endpoint simply opens a fresh lane — a visible gap.
 */
export function computeLanes(chrono: TimelineEvent[]): LaneRow[] {
  const laneOf = new Map<string, number>(); // open endpoint -> lane
  const free: number[] = []; // freed lanes, reused smallest-first
  let next = 0;
  const rows: LaneRow[] = [];

  for (const event of chrono) {
    let lane = laneOf.get(event.elementId);
    if (lane === undefined) {
      lane = free.length ? (free.shift() as number) : next++;
      laneOf.set(event.elementId, lane);
    }
    const through = [...laneOf.values()].filter((l) => l !== lane);
    rows.push({ event, lane, through });

    if (event.action === "deleted") {
      laneOf.delete(event.elementId);
      free.push(lane);
      free.sort((a, b) => a - b);
    }
  }
  return rows;
}

/** Total lane count a rail needs (for sizing the rail column). */
export function laneCount(rows: LaneRow[]): number {
  let max = -1;
  for (const r of rows) {
    max = Math.max(max, r.lane, ...r.through);
  }
  return max + 1;
}

// --------------------------------------------------------------------------
// Digest: net change per endpoint since a baseline
// --------------------------------------------------------------------------

/** An endpoint's net status since the baseline — the actionable end-state. */
export interface DigestItem {
  elementId: string;
  title: string;
  method?: HttpMethod;
  path?: string;
  /** Latest event contributing to this status (for time/author/commit). */
  at: TimelineEvent;
}

export interface Digest {
  toIntegrate: DigestItem[]; // appeared since the baseline (new endpoints)
  toModify: DigestItem[]; // existed before, changed since
  toRemove: DigestItem[]; // existed before, deleted since
}

/** Is the endpoint live (last action is not a delete) given these events? */
function aliveAfter(events: TimelineEvent[]): boolean {
  const last = events.at(-1);
  return Boolean(last) && last!.action !== "deleted";
}

/**
 * Collapse the event stream into the net change per endpoint since `sinceTs`.
 * The point is the *end state* a frontend acts on, not every intermediate edit:
 * an endpoint created-then-deleted within the window is a no-op; created-then-
 * modified is just "new".
 */
export function digest(chrono: TimelineEvent[], sinceTs: number): Digest {
  const byElement = new Map<string, TimelineEvent[]>();
  for (const e of chrono) {
    const list = byElement.get(e.elementId) ?? [];
    list.push(e);
    byElement.set(e.elementId, list);
  }

  const out: Digest = { toIntegrate: [], toModify: [], toRemove: [] };
  for (const [elementId, events] of byElement) {
    const before = events.filter((e) => e.timestamp <= sinceTs);
    const after = events.filter((e) => e.timestamp > sinceTs);
    if (!after.length) continue; // nothing changed in the window

    const existedBefore = before.length > 0 && aliveAfter(before);
    const liveNow = aliveAfter(events);
    const latest = after.at(-1) as TimelineEvent;
    const item: DigestItem = {
      elementId,
      title: latest.title,
      ...(latest.method ? { method: latest.method } : {}),
      ...(latest.path ? { path: latest.path } : {}),
      at: latest,
    };

    if (!existedBefore && liveNow) out.toIntegrate.push(item);
    else if (existedBefore && !liveNow) out.toRemove.push(item);
    else if (existedBefore && liveNow) out.toModify.push(item);
    // absent before AND not live now (created+deleted in window) => no-op
  }
  return out;
}

// --------------------------------------------------------------------------
// History timeline: the unified, domain-grouped activity feed (canvas History)
// --------------------------------------------------------------------------

/** The view-switcher selections: a single domain, or everything merged. */
export type HistoryView = TimelineDomain | "unified";
export type HistorySort = "new" | "old";

/** One rendered row of the History date-rail — an activity event or a checkpoint. */
export interface HistoryRow {
  /** Stable id for selection/paging (`e<seq>` for events, `c<id>` for checkpoints). */
  id: string;
  kind: "event" | "checkpoint";
  domain: TimelineDomain;
  action: VersionAction;
  title: string;
  detail: string;
  author: string;
  /** Epoch ms. */
  timestamp: number;
  /** The element/node/flow id (event rows) so the viewer can deep-link the canvas. */
  targetId?: string;
  /** Present on checkpoint rows so the event viewer can offer "Restore". */
  checkpointId?: string;
}

/** Per-domain counts for the view-switcher chips (`unified` = grand total). */
export type HistoryCounts = Record<HistoryView, number>;

export interface HistoryTimeline {
  rows: HistoryRow[]; // filtered to the active view + sorted
  counts: HistoryCounts; // computed over ALL rows, regardless of the active view
  /** Oldest + newest timestamps across the filtered rows (for the range label). */
  range: { first?: number; last?: number };
}

/** A checkpoint's dominant layer → timeline domain (the layer it changed most). */
function checkpointDomain(cp: Checkpoint): TimelineDomain {
  const top = [...cp.changes].sort((a, b) => b.n - a.n)[0]?.layer;
  if (top === "API") return "api";
  if (top === "INFRA") return "infra";
  if (top === "UML") return "uml";
  return "design";
}

/**
 * Merge the project activity feed with the manual checkpoints into one
 * chronological, domain-filterable row list for the History view. Pure: the
 * canvas owns colours/markup, this owns selection/sorting/counting so it can be
 * unit-tested. Checkpoints become rows too (tagged by their dominant layer) so
 * restore stays reachable from the same timeline.
 */
export function buildHistoryTimeline(
  events: ProjectTimelineEvent[],
  checkpoints: Checkpoint[],
  opts: { view: HistoryView; sort: HistorySort },
): HistoryTimeline {
  const rows: HistoryRow[] = [
    ...events.map(
      (e): HistoryRow => ({
        id: `e${e.seq}`,
        kind: "event",
        domain: e.domain,
        action: e.action,
        title: e.title,
        detail: e.detail,
        author: e.author,
        timestamp: e.timestamp,
        targetId: e.targetId,
      }),
    ),
    ...checkpoints.map(
      (c): HistoryRow => ({
        id: `c${c.id}`,
        kind: "checkpoint",
        domain: checkpointDomain(c),
        action: "created",
        title: c.title,
        detail: c.description,
        author: c.author ?? "",
        timestamp: Date.parse(c.createdAt) || 0,
        checkpointId: c.id,
      }),
    ),
  ];

  const counts: HistoryCounts = {
    unified: rows.length,
    design: 0,
    api: 0,
    infra: 0,
    uml: 0,
  };
  for (const r of rows) counts[r.domain]++;

  const filtered = (
    opts.view === "unified" ? rows : rows.filter((r) => r.domain === opts.view)
  ).sort((a, b) =>
    opts.sort === "new"
      ? b.timestamp - a.timestamp
      : a.timestamp - b.timestamp,
  );

  const stamps = filtered.map((r) => r.timestamp);
  return {
    rows: filtered,
    counts,
    range: {
      first: stamps.length ? Math.min(...stamps) : undefined,
      last: stamps.length ? Math.max(...stamps) : undefined,
    },
  };
}

// --------------------------------------------------------------------------
// History event detail: the per-domain body the "View" overlay renders
// --------------------------------------------------------------------------

/**
 * The live project state a `HistoryRow` is resolved against to build its
 * domain-specific detail. Every field is optional so a host that only has some
 * layers loaded (or a read-only source) still gets a best-effort body. Maps
 * mirror the in-memory shapes the canvas already keeps, so the host passes them
 * straight through — no copying.
 */
export interface HistorySources {
  /** Live design elements by id — geometry + apiBinding for design/api rows. */
  elements?: Map<string, DesignElement>;
  /** Per-element append-only API history — the diff an `api` row expands. */
  timelines?: Map<string, VersionEntry[]>;
  infraNodes?: Map<string, InfraNode>;
  infraEdges?: InfraEdge[];
  infraFlows?: Map<string, InfraFlow>;
}

/** A labelled property in the Design detail table. */
export interface DetailProp {
  label: string;
  value: string;
}

/** One resolved hop in the UML (sequence-flow) detail. */
export interface UmlDetailStep {
  n: number;
  fromLabel: string;
  toLabel: string;
  label: string;
  kind: InfraStepKind;
}

export interface DesignDetail {
  kind: "design";
  /** False when the element no longer exists (a deletion event). */
  found: boolean;
  elementType?: ElementType;
  props: DetailProp[];
  /** Fill colour, surfaced as a swatch. */
  fill?: string;
  /** Text content, for text elements. */
  text?: string;
}

export interface ApiDetail {
  kind: "api";
  method?: HttpMethod;
  path?: string;
  version?: string;
  previousVersion?: string;
  /** `+added −removed` counts from the matched entry's diff (0 when none). */
  added: number;
  removed: number;
  /** Set when the change breaks clients — rendered as a warning callout. */
  breaking?: string;
  /** The structured documentation diff to render as coloured rows. */
  sections: DiffSection[];
  changeLog?: string;
  /** Current Markdown description of the binding, if it still exists. */
  description?: string;
}

export interface InfraDetail {
  kind: "infra";
  subject: "node" | "edge" | "unknown";
  // node
  nodeKind?: InfraKind;
  label?: string;
  tech?: string;
  description?: string;
  // edge
  fromLabel?: string;
  toLabel?: string;
  edgeLabel?: string;
  /** Focused neighbourhood component diagram (Mermaid) for spatial context. */
  mermaid?: string;
}

export interface UmlDetail {
  kind: "uml";
  /** False when the flow no longer exists (a deletion event). */
  found: boolean;
  flowName?: string;
  description?: string;
  steps: UmlDetailStep[];
  /** The sequence diagram (Mermaid), absent for an empty flow. */
  mermaid?: string;
}

/** Anything without a richer body (checkpoints, unknown targets). */
export interface GenericDetail {
  kind: "generic";
}

export type HistoryDetail =
  | DesignDetail
  | ApiDetail
  | InfraDetail
  | UmlDetail
  | GenericDetail;

const round = (n: number): string => String(Math.round(n));

/**
 * Resolve a history row against the live project state into a domain-specific
 * detail the viewer renders. Pure: it only reads the passed snapshots, so both
 * canvases and the unit tests share one resolver. Checkpoints and unresolvable
 * targets fall back to `{ kind: "generic" }` (the caller's one-line summary).
 */
export function buildHistoryDetail(
  row: HistoryRow,
  src: HistorySources,
): HistoryDetail {
  if (row.kind === "checkpoint") return { kind: "generic" };
  switch (row.domain) {
    case "design":
      return designDetail(row, src);
    case "api":
      return apiDetail(row, src);
    case "infra":
      return infraDetail(row, src);
    case "uml":
      return umlDetail(row, src);
    default:
      return { kind: "generic" };
  }
}

function designDetail(row: HistoryRow, src: HistorySources): DesignDetail {
  const el = row.targetId ? src.elements?.get(row.targetId) : undefined;
  if (!el) return { kind: "design", found: false, props: [] };
  const props: DetailProp[] = [
    { label: "Position", value: `${round(el.x)}, ${round(el.y)}` },
    { label: "Size", value: `${round(el.width)} × ${round(el.height)}` },
  ];
  const parent = el.parentId ? src.elements?.get(el.parentId) : undefined;
  if (parent) props.push({ label: "Parent", value: parent.name || parent.type });
  if (el.rotation) props.push({ label: "Rotation", value: `${round(el.rotation)}°` });
  return {
    kind: "design",
    found: true,
    elementType: el.type,
    props,
    ...(el.style?.fill ? { fill: el.style.fill } : {}),
    ...(el.text ? { text: el.text } : {}),
  };
}

/** The history entry closest in time to the event (its recorded change). */
function pickEntry(entries: VersionEntry[], ts: number): VersionEntry | undefined {
  let best = entries[0];
  if (!best) return undefined;
  let bestDiff = Math.abs(best.timestamp - ts);
  for (const e of entries) {
    const d = Math.abs(e.timestamp - ts);
    if (d < bestDiff) {
      best = e;
      bestDiff = d;
    }
  }
  return best;
}

function apiDetail(row: HistoryRow, src: HistorySources): ApiDetail {
  const entries = (row.targetId ? src.timelines?.get(row.targetId) : undefined) ?? [];
  const el = row.targetId ? src.elements?.get(row.targetId) : undefined;
  const entry = pickEntry(entries, row.timestamp);
  const diff = entry?.diff;
  return {
    kind: "api",
    ...(entry?.endpoint?.method ? { method: entry.endpoint.method } : {}),
    ...(entry?.endpoint?.path ? { path: entry.endpoint.path } : {}),
    ...(entry?.version ? { version: entry.version } : {}),
    ...(entry?.previousVersion ? { previousVersion: entry.previousVersion } : {}),
    added: diff?.added ?? 0,
    removed: diff?.removed ?? 0,
    ...(diff?.breaking ? { breaking: diff.breaking } : {}),
    sections: diff?.sections ?? [],
    ...(entry?.changeLog ? { changeLog: entry.changeLog } : {}),
    ...(el?.apiBinding?.description ? { description: el.apiBinding.description } : {}),
  };
}

/**
 * A focused component diagram around `focus` nodes: the focus plus (when
 * `expand`) their one-hop neighbours, and the edges among that set. Undefined
 * when no focus node is loaded (e.g. the node was deleted).
 */
function focusDiagram(
  focus: string[],
  src: HistorySources,
  expand: boolean,
): string | undefined {
  const nodes = src.infraNodes;
  if (!nodes) return undefined;
  const edges = src.infraEdges ?? [];
  const ids = new Set(focus.filter((id) => nodes.has(id)));
  if (!ids.size) return undefined;
  if (expand) {
    for (const e of edges) {
      if (ids.has(e.from)) ids.add(e.to);
      if (ids.has(e.to)) ids.add(e.from);
    }
  }
  const picked: InfraNode[] = [];
  for (const id of ids) {
    const n = nodes.get(id);
    if (n) picked.push(n);
  }
  if (!picked.length) return undefined;
  const sub = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return infraToComponentMermaid(picked, sub);
}

function infraDetail(row: HistoryRow, src: HistorySources): InfraDetail {
  const id = row.targetId ?? "";
  const node = src.infraNodes?.get(id);
  if (node) {
    const mermaid = focusDiagram([node.id], src, true);
    return {
      kind: "infra",
      subject: "node",
      nodeKind: node.kind,
      label: node.label,
      ...(node.tech ? { tech: node.tech } : {}),
      ...(node.description ? { description: node.description } : {}),
      ...(mermaid ? { mermaid } : {}),
    };
  }
  const edge = (src.infraEdges ?? []).find((e) => e.id === id);
  if (edge) {
    const from = src.infraNodes?.get(edge.from);
    const to = src.infraNodes?.get(edge.to);
    const mermaid = focusDiagram([edge.from, edge.to], src, false);
    return {
      kind: "infra",
      subject: "edge",
      fromLabel: from?.label ?? edge.from,
      toLabel: to?.label ?? edge.to,
      ...(edge.label ? { edgeLabel: edge.label } : {}),
      ...(mermaid ? { mermaid } : {}),
    };
  }
  return { kind: "infra", subject: "unknown" };
}

function umlDetail(row: HistoryRow, src: HistorySources): UmlDetail {
  const flow = row.targetId ? src.infraFlows?.get(row.targetId) : undefined;
  if (!flow) return { kind: "uml", found: false, steps: [] };
  const nodes = src.infraNodes ?? new Map<string, InfraNode>();
  const steps: UmlDetailStep[] = flow.steps.map((s, i) => ({
    n: i + 1,
    fromLabel: nodes.get(s.from)?.label ?? s.from,
    toLabel: nodes.get(s.to)?.label ?? s.to,
    label: s.label,
    kind: s.kind,
  }));
  const mermaid = flow.steps.length ? flowToMermaid(flow, nodes) : undefined;
  return {
    kind: "uml",
    found: true,
    flowName: flow.name,
    ...(flow.description ? { description: flow.description } : {}),
    steps,
    ...(mermaid ? { mermaid } : {}),
  };
}
