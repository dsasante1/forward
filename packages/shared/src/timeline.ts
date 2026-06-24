import type {
  Checkpoint,
  HttpMethod,
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
