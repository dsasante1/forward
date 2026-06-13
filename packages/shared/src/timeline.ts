import type { HttpMethod, VersionAction, VersionEntry } from "./schema.js";

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
    for (const entry of entries) {
      const label = entry.endpoint ?? current[elementId] ?? {};
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
      });
    }
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
