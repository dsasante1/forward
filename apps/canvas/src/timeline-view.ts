import {
  type CurrentLabel,
  digest,
  type DiffSection,
  flattenTimelines,
  type TimelineEvent,
  type VersionAction,
  type VersionDiff,
  type VersionEntry,
} from "forward-core";

/**
 * The project endpoint timeline: one overlay panel that turns the per-element
 * `version_timeline` histories into
 *   1. a "catch-up DIGEST" — the net added / modified / deleted tally a frontend
 *      dev acts on after being away, with a one-line net-change summary, and
 *   2. a filterable HISTORY feed — every endpoint event as an expandable card on
 *      a single timeline rail, newest first, that opens to show the structured
 *      documentation diff (request/response field changes + breaking callout).
 *
 * The data crunching lives in forward-core (flattenTimelines / digest); this
 * module only draws. Clicking a card selects that element on the canvas.
 */

export interface TimelineCallbacks {
  onSelect: (elementId: string) => void;
  onClose: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const ACTION_LABEL: Record<VersionAction, string> = {
  created: "added",
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

// History filter tabs (the action each one keeps).
const FILTERS: Array<{ key: string; label: string; action?: VersionAction }> = [
  { key: "all", label: "All" },
  { key: "added", label: "Added", action: "created" },
  { key: "modified", label: "Modified", action: "modified" },
  { key: "deleted", label: "Deleted", action: "deleted" },
];

// Module-level UI state — the panel is rebuilt from scratch on every data sync,
// so these survive re-renders.
let windowKey = "30d";
let filterKey = "all";
const expanded = new Set<string>(); // event keys the user has opened
const known = new Set<string>(); // event keys already given a default state

function eventKey(e: TimelineEvent): string {
  return `${e.elementId}:${e.timestamp}`;
}

export function renderTimelineView(
  root: HTMLElement,
  byElement: Record<string, VersionEntry[]>,
  current: Record<string, CurrentLabel>,
  cb: TimelineCallbacks,
): void {
  root.replaceChildren();

  const head = div("tl-head");
  head.append(h("h2", "Endpoint timeline"));
  const actions = div("tl-head-actions");
  const collapse = iconBtn("⌄", "Collapse panel", "tl-collapse");
  const close = iconBtn("✕", "Close timeline", "tl-close");
  close.addEventListener("click", cb.onClose);
  actions.append(collapse, close);
  head.append(actions);
  root.append(head);

  const body = div("tl-body");
  root.append(body);
  collapse.addEventListener("click", () => {
    const hidden = body.toggleAttribute("hidden");
    collapse.textContent = hidden ? "›" : "⌄";
  });

  const events = flattenTimelines(byElement, current);
  if (!events.length) {
    body.append(
      h(
        "p",
        "No endpoint history yet. Documentation written from VS Code (or by an agent) shows up here.",
        "empty",
      ),
    );
    return;
  }

  renderDigest(body, events);
  renderHistory(body, events, cb);
}

// --------------------------------------------------------------------------
// Digest: net change since a baseline
// --------------------------------------------------------------------------
function renderDigest(root: HTMLElement, events: TimelineEvent[]): void {
  root.append(h("h3", "Catch-up digest"));

  const since = div("tl-since");
  since.append(h("label", "Since"));
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
    fill(card);
  });
  since.append(select);
  root.append(since);

  const card = div("tl-digest-card");
  fill(card);
  root.append(card);

  function fill(into: HTMLElement): void {
    into.replaceChildren();
    const winMs =
      WINDOWS.find((w) => w.key === windowKey)?.ms ?? Number.POSITIVE_INFINITY;
    const sinceTs = Number.isFinite(winMs) ? Date.now() - winMs : 0;
    const d = digest(events, sinceTs);
    const added = d.toIntegrate.length;
    const modified = d.toModify.length;
    const removed = d.toRemove.length;
    const updates = events.filter((e) => e.timestamp > sinceTs).length;

    const pills = div("tl-pills");
    pills.append(pill(added, "added", "created"));
    pills.append(pill(modified, "modified", "modified"));
    pills.append(pill(removed, "deleted", "deleted"));
    into.append(pills);

    if (!updates) {
      into.append(div("tl-netchange empty", "No endpoint changes in this window."));
      return;
    }
    const net = added - removed;
    const netStr = net >= 0 ? `+${net}` : String(net);
    const noun = Math.abs(net) === 1 ? "endpoint" : "endpoints";
    const line = div("tl-netchange");
    line.append(span("Net change "));
    line.append(span(`${netStr} ${noun}`, "tl-net-strong"));
    line.append(span(` across ${updates} update${updates === 1 ? "" : "s"}`));
    into.append(line);
  }

  function pill(n: number, label: string, tone: VersionAction): HTMLElement {
    const p = div(`tl-pill tl-pill-${tone}${n ? "" : " tl-pill-zero"}`);
    p.append(span("", "tl-dot"));
    p.append(span(String(n), "tl-pill-n"));
    p.append(span(label));
    return p;
  }
}

// --------------------------------------------------------------------------
// History feed
// --------------------------------------------------------------------------
function renderHistory(
  root: HTMLElement,
  events: TimelineEvent[],
  cb: TimelineCallbacks,
): void {
  const head = div("tl-history-head");
  head.append(h("h3", "History"));
  const tabs = div("tl-tabs");
  for (const f of FILTERS) {
    const t = document.createElement("button");
    t.className = `tl-tab${f.key === filterKey ? " active" : ""}`;
    t.textContent = f.label;
    t.addEventListener("click", () => {
      filterKey = f.key;
      for (const b of tabs.children) b.classList.toggle("active", b === t);
      fill();
    });
    tabs.append(t);
  }
  head.append(tabs);
  root.append(head);

  const list = div("tl-graph");
  root.append(list);
  fill();

  function fill(): void {
    list.replaceChildren();
    const action = FILTERS.find((f) => f.key === filterKey)?.action;
    // Newest first, like a git log.
    const rows = [...events]
      .reverse()
      .filter((e) => !action || e.action === action);
    if (!rows.length) {
      list.append(div("tl-empty empty", "Nothing in this view."));
      return;
    }
    for (const e of rows) list.append(card(e, cb));
  }
}

function card(e: TimelineEvent, cb: TimelineCallbacks): HTMLElement {
  const key = eventKey(e);
  if (!known.has(key)) {
    known.add(key);
    if (e.action === "modified" && e.diff) expanded.add(key); // open by default
  }

  const row = div(`tl-row tl-row-${e.action}`);
  row.append(rail(e.action));

  const cardEl = div("tl-card");
  const hasDetail = Boolean(e.diff) || Boolean(e.changeLog);

  // --- header line: action / method / title / stat / expander -----------
  const headLine = div("tl-card-head");
  headLine.append(span(ACTION_LABEL[e.action].toUpperCase(), `tl-action tl-action-${e.action}`));
  if (e.method) headLine.append(span(e.method, `tl-method tl-method-${e.method}`));
  headLine.append(span(e.title, "tl-title"));
  const right = div("tl-card-head-right");
  if (e.diff && (e.diff.added || e.diff.removed)) right.append(stat(e.diff));
  right.append(magnitude(e.action));
  if (hasDetail) {
    const chev = span("⌄", "tl-chevron");
    right.append(chev);
  }
  headLine.append(right);
  cardEl.append(headLine);

  // --- version transition / path / changelog / author -------------------
  if (e.previousVersion || e.version) {
    const ver = div("tl-version");
    if (e.previousVersion && e.previousVersion !== e.version) {
      ver.append(span(e.previousVersion, "tl-ver-old"));
      ver.append(span(" → ", "tl-ver-arrow"));
    }
    ver.append(span(e.version, "tl-ver-new"));
    cardEl.append(ver);
  }
  if (e.path) cardEl.append(div("tl-path", e.path));
  if (e.changeLog) cardEl.append(div("tl-log", e.changeLog));
  cardEl.append(author(e));

  // --- expandable detail (the diff) -------------------------------------
  if (hasDetail) {
    const detail = renderDetail(e, cb);
    if (!expanded.has(key)) detail.hidden = true;
    else cardEl.classList.add("open");
    cardEl.append(detail);

    const toggle = (): void => {
      const open = detail.hidden;
      detail.hidden = !open;
      cardEl.classList.toggle("open", open);
      if (open) expanded.add(key);
      else expanded.delete(key);
    };
    // The whole header toggles; the card body still selects the element.
    headLine.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggle();
    });
  }

  cardEl.addEventListener("click", () => cb.onSelect(e.elementId));
  row.append(cardEl);
  return row;
}

function renderDetail(e: TimelineEvent, cb: TimelineCallbacks): HTMLElement {
  const detail = div("tl-detail");
  const diff = e.diff;

  if (diff?.sections.length) {
    for (const section of diff.sections) detail.append(diffSection(section));
  } else if (e.changeLog) {
    // No structured diff — surface the change-log prose as the detail.
    detail.append(div("tl-detail-note", e.changeLog));
  }

  if (diff?.breaking) {
    const box = div("tl-breaking");
    box.append(span("⚠", "tl-breaking-icon"));
    box.append(div("tl-breaking-text", diff.breaking));
    detail.append(box);
  }

  const bar = div("tl-detail-actions");
  if (diff) {
    const copy = textBtn("⧉ Copy diff");
    copy.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void navigator.clipboard?.writeText(diffToText(e));
      copy.textContent = "✓ Copied";
      window.setTimeout(() => {
        copy.textContent = "⧉ Copy diff";
      }, 1200);
    });
    bar.append(copy);
  }
  const full = textBtn("◷ Full history");
  full.addEventListener("click", (ev) => {
    ev.stopPropagation();
    cb.onSelect(e.elementId);
  });
  bar.append(full);
  detail.append(bar);

  return detail;
}

function diffSection(section: DiffSection): HTMLElement {
  const wrap = div("tl-diff-section");
  wrap.append(div("tl-diff-label", section.label));
  const table = div("tl-diff-table");
  for (const r of section.rows) {
    const rowEl = div(`tl-diff-row tl-diff-${r.op}`);
    for (const c of r.cols) rowEl.append(span(c, "tl-diff-cell"));
    table.append(rowEl);
  }
  wrap.append(table);
  return wrap;
}

// --------------------------------------------------------------------------
// Small pieces
// --------------------------------------------------------------------------

/** A single ring node on the timeline rail, coloured by the event's action. */
function rail(action: VersionAction): HTMLElement {
  const r = div("tl-rail");
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("class", `tl-node tl-node-${action}`);
  node.setAttribute("viewBox", "0 0 16 16");
  const outer = document.createElementNS(SVG_NS, "circle");
  outer.setAttribute("cx", "8");
  outer.setAttribute("cy", "8");
  outer.setAttribute("r", "6");
  outer.setAttribute("class", "tl-node-ring");
  const inner = document.createElementNS(SVG_NS, "circle");
  inner.setAttribute("cx", "8");
  inner.setAttribute("cy", "8");
  inner.setAttribute("r", "2.5");
  inner.setAttribute("class", "tl-node-core");
  node.append(outer, inner);
  r.append(node);
  return r;
}

/** The "+2 −1" diff-stat badge. */
function stat(diff: VersionDiff): HTMLElement {
  const s = div("tl-stat");
  if (diff.added) s.append(span(`+${diff.added}`, "tl-stat-add"));
  if (diff.removed) s.append(span(`−${diff.removed}`, "tl-stat-del"));
  return s;
}

/** A small five-cell strip tinting the row by its action (decorative). */
function magnitude(action: VersionAction): HTMLElement {
  const m = div(`tl-mag tl-mag-${action}`);
  for (let i = 0; i < 5; i++) m.append(span("", "tl-mag-cell"));
  return m;
}

/** Author row: avatar initial + name · commit · time. */
function author(e: TimelineEvent): HTMLElement {
  const a = div("tl-author");
  const initial = (e.author || "?").charAt(0).toUpperCase();
  a.append(span(initial, "tl-avatar"));
  const parts = div("tl-author-parts");
  if (e.author) parts.append(span(e.author, "tl-author-name"));
  if (e.commitHash) parts.append(span(e.commitHash, "tl-commit"));
  parts.append(span(fmtTime(e.timestamp), "tl-time"));
  a.append(parts);
  return a;
}

function diffToText(e: TimelineEvent): string {
  const lines: string[] = [`${ACTION_LABEL[e.action].toUpperCase()} ${e.method ?? ""} ${e.title}`.trim()];
  if (e.path) lines.push(e.path);
  if (e.previousVersion) lines.push(`${e.previousVersion} -> ${e.version}`);
  for (const s of e.diff?.sections ?? []) {
    lines.push("", s.label);
    for (const r of s.rows) {
      const mark = r.op === "added" ? "+" : r.op === "removed" ? "-" : " ";
      lines.push(`${mark} ${r.cols.join("  ")}`);
    }
  }
  if (e.diff?.breaking) lines.push("", `BREAKING: ${e.diff.breaking}`);
  return lines.join("\n");
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
  if (content) s.textContent = content;
  return s;
}
function iconBtn(label: string, title: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.title = title;
  b.textContent = label;
  return b;
}
function textBtn(label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tl-btn";
  b.textContent = label;
  return b;
}
