import {
  computeLanes,
  type CurrentLabel,
  digest,
  type DigestItem,
  flattenTimelines,
  laneCount,
  type TimelineEvent,
  type VersionAction,
  type VersionEntry,
} from "@adc/shared";

/**
 * The project endpoint timeline: one overlay panel that turns the per-element
 * `version_timeline` histories into
 *   1. a "since" DIGEST — the net integrate / modify / remove list a frontend
 *      dev acts on after being away, and
 *   2. a git-graph HISTORY — every endpoint event on its own lane, newest first.
 *
 * All the logic lives in @adc/shared (flattenTimelines / digest / computeLanes);
 * this module only draws. Clicking any row selects that element on the canvas.
 */

export interface TimelineCallbacks {
  onSelect: (elementId: string) => void;
  onClose: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const ACTION_LABEL: Record<VersionAction, string> = {
  created: "created",
  modified: "modified",
  deleted: "deleted",
};

// Baseline choices for the digest ("what changed since…").
const WINDOWS: Array<{ key: string; label: string; ms: number }> = [
  { key: "24h", label: "Last 24 hours", ms: 24 * 3600_000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 24 * 3600_000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 24 * 3600_000 },
  { key: "all", label: "All time", ms: Number.POSITIVE_INFINITY },
];
let windowKey = "all"; // survives re-renders (the panel rebuilds on every sync)

// Git-graph rail geometry.
const LANE_W = 14;
const ROW_H = 46;

export function renderTimelineView(
  root: HTMLElement,
  byElement: Record<string, VersionEntry[]>,
  current: Record<string, CurrentLabel>,
  cb: TimelineCallbacks,
): void {
  root.replaceChildren();

  const head = div("tl-head");
  head.append(h("h2", "Endpoint timeline"));
  const close = document.createElement("button");
  close.className = "tl-close";
  close.title = "Close timeline";
  close.textContent = "✕";
  close.addEventListener("click", cb.onClose);
  head.append(close);
  root.append(head);

  const events = flattenTimelines(byElement, current);
  if (!events.length) {
    root.append(
      h(
        "p",
        "No endpoint history yet. Documentation written from VS Code (or by an agent) shows up here.",
        "empty",
      ),
    );
    return;
  }

  renderDigest(root, events, cb);
  renderGraph(root, events, cb);
}

// --------------------------------------------------------------------------
// Digest: net change since a baseline
// --------------------------------------------------------------------------
function renderDigest(
  root: HTMLElement,
  events: TimelineEvent[],
  cb: TimelineCallbacks,
): void {
  root.append(h("h3", "Catch-up digest"));

  const since = div("tl-since");
  const label = document.createElement("label");
  label.textContent = "Since";
  const select = document.createElement("select");
  for (const w of WINDOWS) {
    const o = document.createElement("option");
    o.value = w.key;
    o.textContent = w.label;
    if (w.key === windowKey) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => {
    windowKey = select.value;
    // Re-render just the digest groups for the new baseline.
    body.replaceChildren();
    fillDigest(body);
  });
  since.append(label, select);
  root.append(since);

  const body = div("tl-digest");
  fillDigest(body);
  root.append(body);

  function fillDigest(into: HTMLElement): void {
    const winMs =
      WINDOWS.find((w) => w.key === windowKey)?.ms ?? Number.POSITIVE_INFINITY;
    const sinceTs = Number.isFinite(winMs) ? Date.now() - winMs : 0;
    const d = digest(events, sinceTs);
    if (!d.toIntegrate.length && !d.toModify.length && !d.toRemove.length) {
      into.append(h("p", "No endpoint changes in this window.", "empty"));
      return;
    }
    into.append(group("To integrate", "created", d.toIntegrate));
    into.append(group("To modify", "modified", d.toModify));
    into.append(group("To remove", "deleted", d.toRemove));
  }

  function group(
    title: string,
    tone: VersionAction,
    items: DigestItem[],
  ): HTMLElement {
    const g = div("tl-group");
    if (!items.length) return g;
    const t = div(`tl-group-title tl-action-${tone}`);
    t.append(span(title), span(String(items.length), "tl-count"));
    g.append(t);
    for (const item of items) {
      const row = div("tl-item");
      if (item.method) row.append(span(item.method, "tl-method"));
      row.append(span(item.title, "tl-title"));
      if (item.path) row.append(span(item.path, "tl-path"));
      row.addEventListener("click", () => cb.onSelect(item.elementId));
      g.append(row);
    }
    return g;
  }
}

// --------------------------------------------------------------------------
// Git-graph history rail
// --------------------------------------------------------------------------
function renderGraph(
  root: HTMLElement,
  events: TimelineEvent[],
  cb: TimelineCallbacks,
): void {
  root.append(h("h3", "History"));

  const rows = computeLanes(events); // chronological (oldest first)
  const lanes = laneCount(rows);
  const railW = lanes * LANE_W;

  const list = div("tl-graph");
  // Newest at the top, like a git log; in each row "up" is later in time.
  for (const row of [...rows].reverse()) {
    const e = row.event;
    const item = div("tl-row");
    item.title = `${e.title} — ${ACTION_LABEL[e.action]}`;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "tl-rail");
    svg.setAttribute("width", String(railW));
    svg.setAttribute("height", String(ROW_H));

    const x = (lane: number) => lane * LANE_W + LANE_W / 2;
    const cy = ROW_H / 2;
    for (const l of row.through) svg.append(railLine(x(l), 0, x(l), ROW_H));
    // The endpoint's own lane: a created event has no past (below), a deleted
    // event no future (above); a modify passes straight through.
    if (e.action !== "created") svg.append(railLine(x(row.lane), cy, x(row.lane), ROW_H));
    if (e.action !== "deleted") svg.append(railLine(x(row.lane), 0, x(row.lane), cy));
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(x(row.lane)));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "4.5");
    dot.setAttribute("class", `tl-node-${e.action}`);
    svg.append(dot);
    item.append(svg);

    const info = div("tl-info");
    const top = div("");
    top.append(span(ACTION_LABEL[e.action], `tl-action tl-action-${e.action}`));
    if (e.method) top.append(span(e.method, "tl-method"));
    top.append(span(e.title, "tl-title"));
    info.append(top);
    if (e.path) info.append(div("tl-path", e.path));
    if (e.changeLog) info.append(div("tl-log", e.changeLog));
    info.append(
      div(
        "tl-meta",
        [e.author, e.version, e.commitHash, fmtTime(e.timestamp)]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    item.append(info);

    item.addEventListener("click", () => cb.onSelect(e.elementId));
    list.append(item);
  }
  root.append(list);
}

function railLine(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", String(x1));
  l.setAttribute("y1", String(y1));
  l.setAttribute("x2", String(x2));
  l.setAttribute("y2", String(y2));
  return l;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- tiny DOM builders ----------------------------------------------------
function h(tag: string, content: string, cls = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (cls) node.className = cls;
  return node;
}
function div(cls: string, content = ""): HTMLDivElement {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  if (content) d.textContent = content;
  return d;
}
function span(content: string, cls = ""): HTMLSpanElement {
  const s = document.createElement("span");
  if (cls) s.className = cls;
  s.textContent = content;
  return s;
}
