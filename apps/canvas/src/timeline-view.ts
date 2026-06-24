import {
  buildHistoryTimeline,
  type Checkpoint,
  type HistoryRow,
  type HistorySort,
  type HistoryView,
  type ProjectTimelineEvent,
  type TimelineDomain,
} from "forward-core";

/**
 * The project History timeline: a full-cover, domain-grouped activity feed (the
 * imported "History timeline" design). Every create/modify/delete across the four
 * layers — Design / API / Infra / UML — lands on one date-rail, filterable by a
 * view-switcher and sortable newest/oldest. Clicking an event opens a viewer that
 * shows its detail and, for checkpoints, offers a one-click restore.
 *
 * The merging/filtering/sorting is pure and lives in forward-core
 * (`buildHistoryTimeline`); this module only draws.
 */

export interface TimelineCallbacks {
  /** Deep-link a design/api event's element on the canvas (closes the History view). */
  onSelectElement: (elementId: string) => void;
  /** Rewind the project to a checkpoint (from the event viewer's "Restore"). */
  onRestore: (checkpointId: string) => void;
  /** Delete a checkpoint (from the event viewer). Omitted on read-only sources. */
  onDelete?: (checkpointId: string) => void;
  onClose: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Fixed semantic colour per layer (mirrors the design + the CSS-var defaults). */
const DOMAIN: Record<TimelineDomain, { label: string; color: string }> = {
  design: { label: "Design", color: "#7a8190" },
  api: { label: "API", color: "#d06a40" },
  infra: { label: "Infra", color: "#5b8fcf" },
  uml: { label: "UML", color: "#9a7fd0" },
};
// The view-switcher order from the design: Design · Infra · UML · API · Unified.
const VIEW_ORDER: HistoryView[] = ["design", "infra", "uml", "api", "unified"];

// Module-level UI state — the panel is rebuilt from scratch on every data sync,
// so these survive re-renders (like the old endpoint-timeline view did).
let view: HistoryView = "unified";
let sort: HistorySort = "new";
let pickId: string | null = null;

let lastEvents: ProjectTimelineEvent[] = [];
let lastCheckpoints: Checkpoint[] = [];
let lastRoot: HTMLElement | null = null;
let lastCb: TimelineCallbacks | null = null;

export function renderTimelineView(
  root: HTMLElement,
  events: ProjectTimelineEvent[],
  checkpoints: Checkpoint[],
  cb: TimelineCallbacks,
): void {
  lastEvents = events;
  lastCheckpoints = checkpoints;
  lastRoot = root;
  lastCb = cb;
  paint();
}

/** Re-render from the retained data after a local UI-state change (view/sort/pick). */
function paint(): void {
  const root = lastRoot;
  const cb = lastCb;
  if (!root || !cb) return;
  root.replaceChildren();

  const tl = buildHistoryTimeline(lastEvents, lastCheckpoints, { view, sort });

  // --- header ------------------------------------------------------------
  const head = div("tl2-head");
  const titles = div("tl2-titles");
  titles.append(h("div", "History timeline", "tl2-title"));
  const range = fmtRange(tl.range.first, tl.range.last, sort);
  titles.append(
    h(
      "div",
      `${tl.counts.unified} event${tl.counts.unified === 1 ? "" : "s"}${range ? ` · ${range}` : ""}`,
      "tl2-sub",
    ),
  );
  head.append(titles);

  const views = div("tl2-views");
  for (const v of VIEW_ORDER) {
    const btn = document.createElement("button");
    btn.className = `tl2-view${v === view ? " active" : ""}`;
    btn.type = "button";
    btn.append(span(v === "unified" ? "Unified" : DOMAIN[v].label));
    btn.append(span(String(tl.counts[v]), "tl2-view-n"));
    btn.addEventListener("click", () => {
      view = v;
      paint();
    });
    views.append(btn);
  }
  head.append(views);

  const sortBtn = document.createElement("button");
  sortBtn.className = "tl2-sort";
  sortBtn.type = "button";
  sortBtn.append(sortIcon(sort), document.createTextNode(sort === "new" ? "Newest first" : "Oldest first"));
  sortBtn.addEventListener("click", () => {
    sort = sort === "new" ? "old" : "new";
    paint();
  });
  head.append(sortBtn);
  // A close affordance (the History tool also toggles it from the rail).
  const close = document.createElement("button");
  close.className = "tl2-sort";
  close.type = "button";
  close.title = "Close timeline";
  close.textContent = "✕";
  close.addEventListener("click", cb.onClose);
  head.append(close);
  root.append(head);

  // --- date rail ---------------------------------------------------------
  const scroll = div("tl2-scroll");
  const rail = div("tl2-rail");
  if (!tl.rows.length) {
    rail.append(div("tl2-empty empty", "No history in this view yet."));
  } else {
    rail.append(div("tl2-rail-line"));
    for (const r of tl.rows) rail.append(rowEl(r));
  }
  scroll.append(rail);
  root.append(scroll);

  // --- event viewer overlay ---------------------------------------------
  const picked = pickId ? tl.rows.find((r) => r.id === pickId) : undefined;
  if (picked) root.append(viewerEl(picked, tl.rows, cb));
}

// --------------------------------------------------------------------------
// Rows
// --------------------------------------------------------------------------
function rowEl(r: HistoryRow): HTMLElement {
  const color = DOMAIN[r.domain].color;
  const d = new Date(r.timestamp);

  const row = div("tl2-row");
  const date = div("tl2-date");
  date.append(h("div", String(d.getDate()).padStart(2, "0"), "tl2-day"));
  date.append(h("div", `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, "tl2-monthyear"));
  row.append(date);

  const wrap = div("tl2-cardwrap");
  const dot = div("tl2-dot");
  dot.style.background = color;
  wrap.append(dot);

  const card = div("tl2-card");
  if (r.id === pickId) {
    card.classList.add("picked");
    card.style.color = color; // currentColor → the focus ring
  }
  card.append(domainChip(r, color));
  card.append(h("div", r.title, "tl2-card-title"));
  if (r.detail) card.append(h("div", r.detail, "tl2-card-detail"));

  const foot = div("tl2-foot");
  const initial = (r.author || "?").charAt(0).toUpperCase();
  foot.append(span(initial, "tl2-avatar"));
  foot.append(span(r.author || "unknown", "tl2-author"));
  const link = div("tl2-view-link");
  link.style.color = color;
  link.append(eyeIcon(), document.createTextNode("View"));
  foot.append(link);
  card.append(foot);

  card.addEventListener("click", () => {
    pickId = r.id;
    paint();
  });
  wrap.append(card);
  row.append(wrap);
  return row;
}

function domainChip(r: HistoryRow, color: string): HTMLElement {
  const chip = span(
    r.kind === "checkpoint" ? "CHECKPOINT" : DOMAIN[r.domain].label.toUpperCase(),
    "tl2-chip",
  );
  chip.style.color = color;
  chip.style.background = rgba(color, 0.16);
  return chip;
}

// --------------------------------------------------------------------------
// Event viewer
// --------------------------------------------------------------------------
function viewerEl(r: HistoryRow, rows: HistoryRow[], cb: TimelineCallbacks): HTMLElement {
  const color = DOMAIN[r.domain].color;
  const idx = rows.findIndex((x) => x.id === r.id);
  const d = new Date(r.timestamp);

  const viewer = div("tl2-viewer");

  const head = div("tl2-viewer-head");
  const back = document.createElement("button");
  back.className = "tl2-back";
  back.type = "button";
  back.append(span("←"), document.createTextNode("Timeline"));
  back.addEventListener("click", () => {
    pickId = null;
    paint();
  });
  head.append(back);
  head.append(domainChip(r, color));

  const titles = div("tl2-viewer-titles");
  titles.append(h("div", r.title, "tl2-viewer-title"));
  titles.append(
    h(
      "div",
      `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()} · ${r.author || "unknown"}`,
      "tl2-viewer-stamp",
    ),
  );
  head.append(titles);

  const acts = div("tl2-viewer-acts");
  const step = (delta: number): void => {
    const ni = idx + delta;
    if (ni < 0 || ni >= rows.length) return;
    const target = rows[ni];
    if (!target) return;
    pickId = target.id;
    paint();
  };
  acts.append(stepBtn("↑", () => step(-1)));
  acts.append(stepBtn("↓", () => step(1)));
  if (r.kind === "checkpoint" && r.checkpointId) {
    const restore = document.createElement("button");
    restore.className = "tl2-restore";
    restore.type = "button";
    restore.textContent = "Restore this version";
    const id = r.checkpointId;
    restore.addEventListener("click", () => cb.onRestore(id));
    acts.append(restore);
    if (cb.onDelete) {
      const del = document.createElement("button");
      del.className = "tl2-step";
      del.type = "button";
      del.title = "Delete checkpoint";
      del.style.width = "auto";
      del.style.padding = "0 12px";
      del.textContent = "Delete";
      const onDelete = cb.onDelete;
      del.addEventListener("click", () => {
        pickId = null;
        onDelete(id);
      });
      acts.append(del);
    }
  } else if (r.targetId) {
    const open = document.createElement("button");
    open.className = "tl2-restore";
    open.type = "button";
    open.textContent = "Open on canvas";
    const id = r.targetId;
    open.addEventListener("click", () => {
      pickId = null;
      cb.onSelectElement(id);
    });
    acts.append(open);
  }
  head.append(acts);
  viewer.append(head);

  // The honest "snapshot": the real recorded event — domain, title, detail.
  // (We don't fabricate a reconstructed drawing; the data we hold is the change.)
  const stage = div("tl2-stage");
  const card = div("tl2-stage-card");
  const dchip = domainChip(r, color);
  card.append(dchip);
  card.append(h("div", r.title, "tl2-stage-title"));
  card.append(
    h("div", r.detail || "No further detail recorded for this change.", "tl2-stage-detail"),
  );
  stage.append(card);
  viewer.append(stage);
  return viewer;
}

function stepBtn(glyph: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tl2-step";
  b.type = "button";
  b.textContent = glyph;
  b.addEventListener("click", onClick);
  return b;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function fmtRange(first?: number, last?: number, order: HistorySort = "new"): string {
  if (first === undefined || last === undefined) return "";
  const lo = `${MONTHS[new Date(first).getMonth()]} ${new Date(first).getFullYear()}`;
  const hi = `${MONTHS[new Date(last).getMonth()]} ${new Date(last).getFullYear()}`;
  if (lo === hi) return lo;
  // Read in the direction the list is sorted (newest-first shows hi → lo).
  return order === "new" ? `${hi} → ${lo}` : `${lo} → ${hi}`;
}

/** Hex (#rrggbb) → rgba() string, for the translucent chip backgrounds. */
function rgba(hex: string, a: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function svg(paths: string[], size = 14): SVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "1.7");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    el.append(p);
  }
  return el;
}
function eyeIcon(): SVGElement {
  return svg(["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z", "M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z"], 13);
}
function sortIcon(s: HistorySort): SVGElement {
  return s === "new" ? svg(["M12 5v14", "M6 13l6 6 6-6"]) : svg(["M12 19V5", "M6 11l6-6 6 6"]);
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
