import {
  type ApiDetail,
  buildHistoryDetail,
  buildHistoryTimeline,
  type Checkpoint,
  type CheckpointDetail,
  type DesignDetail,
  type DesignPreview,
  type DiffRow,
  type DiffSection,
  type HistoryDetail,
  type HistoryRow,
  type HistorySort,
  type HistorySources,
  type HistoryView,
  type InfraDetail,
  type ProjectTimelineEvent,
  type TimelineDomain,
  type FlowDetail,
} from "forward-core";
import type { ImageFill } from "forward-core";
import { preserveAspectRatio } from "./images.js";

/**
 * The project History timeline: a full-cover, domain-grouped activity feed (the
 * imported "History timeline" design). Every create/modify/delete across the four
 * layers — Design / API / Infra / Flows — lands on one date-rail, filterable by a
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
  /** Render a Mermaid source to an SVG string (the infra/flow detail diagrams). */
  renderMermaid?: (src: string) => Promise<string>;
  /**
   * The loaded URL of an image asset, or undefined while it loads (the canvas
   * re-renders this view once it arrives). Absent: previews show shapes only.
   */
  imageHref?: (asset: string) => string | undefined;
  onClose: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Fixed semantic colour per layer (mirrors the design + the CSS-var defaults). */
const DOMAIN: Record<TimelineDomain, { label: string; color: string }> = {
  design: { label: "Design", color: "#7a8190" },
  api: { label: "API", color: "#d06a40" },
  infra: { label: "Infra", color: "#5b8fcf" },
  flow: { label: "Flows", color: "#9a7fd0" },
  agent: { label: "Agents", color: "#3fa88a" },
};
// The view-switcher order from the design: Design · Infra · Flows · Agents · API · Unified.
const VIEW_ORDER: HistoryView[] = [
  "design",
  "infra",
  "flow",
  "agent",
  "api",
  "unified",
];

// Module-level UI state — the panel is rebuilt from scratch on every data sync,
// so these survive re-renders (like the old endpoint-timeline view did).
let view: HistoryView = "unified";
let sort: HistorySort = "new";
let dateFrom = "";
let dateTo = "";
let pickId: string | null = null;
let compareIds: string[] = [];
let comparing = false;
type TimelineOrientation = "vertical" | "horizontal";
const ORIENTATION_KEY = "fwd:historyOrientation";
function loadOrientation(): TimelineOrientation {
  try {
    const saved = globalThis.localStorage?.getItem(ORIENTATION_KEY);
    if (saved === "horizontal" || saved === "vertical") return saved;
  } catch { /* Storage may be disabled. */ }
  return "vertical";
}
let orientation: TimelineOrientation = loadOrientation();

let lastEvents: ProjectTimelineEvent[] = [];
let lastCheckpoints: Checkpoint[] = [];
let lastSources: HistorySources = {};
let lastRoot: HTMLElement | null = null;
let lastCb: TimelineCallbacks | null = null;

export function renderTimelineView(
  root: HTMLElement,
  events: ProjectTimelineEvent[],
  checkpoints: Checkpoint[],
  sources: HistorySources,
  cb: TimelineCallbacks,
): void {
  lastEvents = events;
  lastCheckpoints = checkpoints;
  lastSources = sources;
  lastRoot = root;
  lastCb = cb;
  paint();
}

/** Re-render from the retained data after a local UI-state change (view/sort/pick). */
function paint(): void {
  const root = lastRoot;
  const cb = lastCb;
  if (!root || !cb) return;
  const previousScrollLeft = (root.querySelector(".tl2-scroll") as HTMLElement | null)?.scrollLeft ?? 0;
  root.replaceChildren();
  root.classList.toggle("tl2-horizontal", orientation === "horizontal");

  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : -Infinity;
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Infinity;
  const events = lastEvents.filter((event) => event.timestamp >= from && event.timestamp <= to);
  const checkpoints = lastCheckpoints.filter((checkpoint) => {
    const timestamp = Date.parse(checkpoint.createdAt) || 0;
    return timestamp >= from && timestamp <= to;
  });
  const tl = buildHistoryTimeline(events, checkpoints, { view, sort });
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

  const orientations = div("tl2-orientations");
  orientations.setAttribute("role", "group");
  orientations.setAttribute("aria-label", "Timeline orientation");
  for (const [value, label] of [["vertical", "Vertical"], ["horizontal", "Horizontal"]] as const) {
    const btn = document.createElement("button");
    btn.className = `tl2-orientation${orientation === value ? " active" : ""}`;
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(orientation === value));
    btn.textContent = label;
    btn.addEventListener("click", () => {
      if (orientation === value) return;
      orientation = value;
      try { globalThis.localStorage?.setItem(ORIENTATION_KEY, orientation); } catch { /* Session preference only. */ }
      paint();
    });
    orientations.append(btn);
  }
  head.append(orientations);

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

  const dateFilter = div("tl2-date-filter");
  dateFilter.append(span("From", "tl2-date-label"));
  dateFilter.append(dateInput("Start date", dateFrom, (value) => { dateFrom = value; pickId = null; paint(); }));
  dateFilter.append(span("To", "tl2-date-label"));
  dateFilter.append(dateInput("End date", dateTo, (value) => { dateTo = value; pickId = null; paint(); }));
  if (dateFrom || dateTo) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "tl2-date-clear";
    clear.textContent = "Clear dates";
    clear.addEventListener("click", () => { dateFrom = ""; dateTo = ""; pickId = null; paint(); });
    dateFilter.append(clear);
  }
  if (compareIds.length) {
    const compareBar = div("tl2-compare-bar");
    const countLabel = `${compareIds.length} item${compareIds.length === 1 ? "" : "s"} selected`;
    compareBar.append(h("div", countLabel, "tl2-compare-count"));
    const compare = document.createElement("button");
    compare.type = "button";
    compare.className = "tl2-compare-open";
    compare.textContent = compareIds.length >= 2 ? "View side by side" : "Select one more item";
    compare.disabled = compareIds.length < 2;
    compare.addEventListener("click", () => { comparing = true; pickId = null; paint(); });
    const clear = document.createElement("button");
    clear.type = "button"; clear.className = "tl2-compare-clear"; clear.textContent = "Clear";
    clear.addEventListener("click", () => { compareIds = []; paint(); });
    compareBar.append(compare, clear);
    root.append(compareBar);
  }
  root.append(dateFilter);

  // --- date rail ---------------------------------------------------------
  const scroll = div("tl2-scroll");
  if (orientation === "horizontal") {
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Scrollable history events; use left and right arrow keys to navigate");
  }
  const rail = div("tl2-rail");
  if (!tl.rows.length) {
    rail.append(div("tl2-empty empty", "No history in this view yet."));
  } else {
    rail.append(div("tl2-rail-line"));
    const hasPickedRow = tl.rows.some((row) => row.id === pickId);
    tl.rows.forEach((r, index) => rail.append(rowEl(r, index, tl.rows, !hasPickedRow)));
  }
  scroll.append(rail);
  root.append(scroll);
  scroll.scrollLeft = orientation === "horizontal" ? previousScrollLeft : 0;

  // --- selected event detail --------------------------------------------
  const picked = pickId ? tl.rows.find((r) => r.id === pickId) : undefined;
  // A selected event takes the foreground across the whole history view. The
  // carousel remains mounted behind it, ready to return to when details close.
  if (picked) root.append(viewerEl(picked, tl.rows, cb));
  if (comparing) {
    const selected = compareIds.map((id) => tl.rows.find((row) => row.id === id)).filter((row): row is HistoryRow => !!row);
    if (selected.length >= 2) root.append(compareEl(selected, tl.rows, cb));
    else comparing = false;
  }
}

function dateInput(label: string, value: string, onChange: (value: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "date";
  input.className = "tl2-date-input";
  input.setAttribute("aria-label", label);
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

// --------------------------------------------------------------------------
// Rows
// --------------------------------------------------------------------------
function rowEl(r: HistoryRow, rowIndex: number, rows: HistoryRow[], focusFirst: boolean): HTMLElement {
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
  card.dataset.historyId = r.id;
  card.tabIndex = r.id === pickId || (focusFirst && rowIndex === 0) ? 0 : -1;
  card.setAttribute("role", "button");
  card.setAttribute("aria-pressed", String(r.id === pickId));
  card.setAttribute("aria-label", `${DOMAIN[r.domain].label}: ${r.title}, ${fmtTime(r.timestamp)}`);
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
  foot.append(span(fmtTime(r.timestamp), "tl2-time"));
  const link = div("tl2-view-link");
  link.style.color = color;
  link.append(eyeIcon(), document.createTextNode("View"));
  foot.append(link);
  const compareButton = document.createElement("button");
  compareButton.type = "button";
  compareButton.className = "tl2-card-compare";
  const isSelected = compareIds.includes(r.id);
  compareButton.textContent = isSelected ? "Selected ✓" : "Compare";
  compareButton.setAttribute("aria-pressed", String(isSelected));
  compareButton.addEventListener("click", (event) => {
    event.stopPropagation();
    compareIds = isSelected ? compareIds.filter((id) => id !== r.id) : [...compareIds, r.id];
    paint();
  });
  foot.append(compareButton);
  card.append(foot);

  card.addEventListener("click", () => {
    pickHistoryRow(r.id, orientation === "horizontal");
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickHistoryRow(r.id, true);
    } else if (orientation === "horizontal" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const nextIndex = rowIndex + (e.key === "ArrowRight" ? 1 : -1);
      if (rows[nextIndex]) pickHistoryRow(rows[nextIndex]!.id, true);
    }
  });
  wrap.append(card);
  row.append(wrap);
  return row;
}

function pickHistoryRow(id: string, focusCard: boolean): void {
  pickId = id;
  paint();
  if (!focusCard || orientation !== "horizontal") return;
  requestAnimationFrame(() => {
    const root = lastRoot;
    const card = [...(root?.querySelectorAll<HTMLElement>(".tl2-card") ?? [])]
      .find((el) => el.dataset.historyId === id);
    const scroll = root?.querySelector<HTMLElement>(".tl2-scroll");
    if (!card || !scroll) return;
    card.focus({ preventScroll: true });
    const cardRect = card.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    if (cardRect.left < scrollRect.left) scroll.scrollLeft -= scrollRect.left - cardRect.left;
    else if (cardRect.right > scrollRect.right) scroll.scrollLeft += cardRect.right - scrollRect.right;
  });
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
  back.append(span("", "ff-mark ff-mark--back"), document.createTextNode("Back to history"));
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
      `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()} · ${fmtTime(r.timestamp)} · ${r.author || "unknown"}`,
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
    pickHistoryRow(target.id, orientation === "horizontal");
  };
  acts.append(stepBtn("↑", () => step(-1), "Previous event"));
  acts.append(stepBtn("↓", () => step(1), "Next event"));
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
      del.className = "tl2-step tl2-delete";
      del.type = "button";
      del.title = "Delete checkpoint";
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
  if (acts.childElementCount) head.append(acts);
  viewer.append(head);

  // The recorded change, rendered for what it actually is: a design-element
  // edit, an API doc diff, an infra node/edge, or a narrated flow. The body
  // is resolved purely (forward-core) against the live project state; this only
  // draws each variant. Checkpoints / unresolved targets keep the plain card.
  const stage = div("tl2-stage");
  stage.append(eventDetailCard(r, rows, cb));
  viewer.append(stage);
  return viewer;
}

function eventDetailCard(r: HistoryRow, rows: HistoryRow[], cb: TimelineCallbacks): HTMLElement {
  const color = DOMAIN[r.domain].color;
  const card = div("tl2-stage-card");
  card.append(domainChip(r, color));
  card.append(h("div", r.title, "tl2-stage-title"));
  card.append(h("div", actionLine(r), "tl2-stage-detail"));
  const detail = buildHistoryDetail(r, { ...lastSources, checkpoints: lastCheckpoints });
  const body = detailBody(detail, color, cb);
  if (body) card.append(body);
  else if (r.detail) card.append(h("div", r.detail, "tl2-stage-note"));
  return card;
}

function compareEl(rows: HistoryRow[], allRows: HistoryRow[], cb: TimelineCallbacks): HTMLElement {
  const viewer = div("tl2-viewer tl2-compare-viewer");
  const head = div("tl2-viewer-head tl2-compare-head");
  const back = document.createElement("button");
  back.className = "tl2-back"; back.type = "button";
  back.append(span("", "ff-mark ff-mark--back"), document.createTextNode("Back to history"));
  back.addEventListener("click", () => { comparing = false; paint(); });
  head.append(back, h("div", "Compare history items", "tl2-viewer-title"));
  const add = document.createElement("button");
  add.className = "tl2-compare-add"; add.type = "button"; add.textContent = "+ Add item";
  add.addEventListener("click", () => { comparing = false; pickId = null; paint(); });
  head.append(add);
  const close = document.createElement("button");
  close.className = "tl2-step"; close.type = "button"; close.textContent = "×";
  close.setAttribute("aria-label", "Close comparison");
  close.addEventListener("click", () => { comparing = false; compareIds = []; paint(); });
  head.append(close); viewer.append(head);

  const grid = div("tl2-compare-grid");
  grid.style.setProperty("--compare-count", String(rows.length));
  for (const row of rows) {
    const color = DOMAIN[row.domain].color;
    const date = new Date(row.timestamp);
    const pane = div("tl2-compare-pane");
    const paneHead = div("tl2-compare-pane-head");
    paneHead.append(domainChip(row, color));
    paneHead.append(h("div", row.title, "tl2-viewer-title"));
    paneHead.append(h("div", `${MONTHS[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")}, ${date.getFullYear()} · ${fmtTime(row.timestamp)} · ${row.author || "unknown"}`, "tl2-viewer-stamp"));
    const remove = document.createElement("button");
    remove.className = "tl2-compare-remove"; remove.type = "button"; remove.textContent = "Remove";
    remove.addEventListener("click", () => { compareIds = compareIds.filter((id) => id !== row.id); comparing = false; paint(); });
    paneHead.append(remove);
    pane.append(paneHead, eventDetailCard(row, allRows, cb));
    grid.append(pane);
  }
  viewer.append(grid);
  return viewer;
}

/** A human "verb + what" line from the row's action (e.g. "Updated · design"). */
function actionLine(r: HistoryRow): string {
  const verb =
    r.action === "created" ? "Created" : r.action === "deleted" ? "Deleted" : "Updated";
  return r.detail || `${verb} ${DOMAIN[r.domain].label.toLowerCase()}`;
}

// --------------------------------------------------------------------------
// Per-domain detail bodies
// --------------------------------------------------------------------------
function detailBody(
  detail: HistoryDetail,
  color: string,
  cb: TimelineCallbacks,
): HTMLElement | null {
  switch (detail.kind) {
    case "design":
      return designBody(detail, cb);
    case "checkpoint":
      return checkpointBody(detail, cb);
    case "api":
      return apiBody(detail, color);
    case "infra":
      return infraBody(detail, cb);
    case "flow":
      return flowBody(detail, cb);
    default:
      return null;
  }
}

function designBody(d: DesignDetail, cb: TimelineCallbacks): HTMLElement {
  const wrap = div("tl2-detail");
  if (!d.found) {
    wrap.append(h("div", "This element no longer exists on the canvas.", "tl2-detail-empty"));
    return wrap;
  }
  if (d.preview?.elements.length) {
    wrap.append(previewEl(d.preview, cb.imageHref));
    wrap.append(h("div", basisCaption(d.preview.basis), "tl2-preview-cap"));
  }
  const grid = div("tl2-proptable");
  if (d.elementType) grid.append(propRow("Type", d.elementType));
  for (const p of d.props) grid.append(propRow(p.label, p.value));
  if (d.fill) {
    const v = span("", "tl2-prop-v");
    const sw = span("", "tl2-swatch");
    sw.style.background = d.fill;
    v.append(sw, document.createTextNode(d.fill));
    grid.append(propRowEl("Fill", v));
  }
  wrap.append(grid);
  if (d.text) {
    wrap.append(h("div", "Text", "tl2-detail-h"));
    wrap.append(h("div", d.text, "tl2-detail-text"));
  }
  return wrap;
}

function apiBody(d: ApiDetail, color: string): HTMLElement {
  const wrap = div("tl2-detail");

  const pills = div("tl2-pills");
  if (d.method) {
    const m = span(d.method, "tl2-method");
    m.dataset.method = d.method;
    pills.append(m);
  }
  if (d.path) pills.append(span(d.path, "tl2-endpoint"));
  if (d.version) {
    pills.append(
      span(d.previousVersion ? `${d.previousVersion} → ${d.version}` : d.version, "tl2-version"),
    );
  }
  if (d.added || d.removed) {
    const badge = span("", "tl2-diffcount");
    if (d.added) badge.append(span(`+${d.added}`, "tl2-add"));
    if (d.removed) badge.append(span(`−${d.removed}`, "tl2-rem"));
    pills.append(badge);
  }
  if (pills.childElementCount) wrap.append(pills);

  if (d.breaking) {
    const warn = div("tl2-breaking");
    warn.append(span("⚠ Breaking", "tl2-breaking-tag"));
    warn.append(document.createTextNode(d.breaking));
    wrap.append(warn);
  }

  if (d.changeLog) wrap.append(h("div", d.changeLog, "tl2-detail-text"));

  for (const sec of d.sections) {
    if (!sec.rows.length) continue;
    wrap.append(h("div", sec.label, "tl2-detail-h"));
    wrap.append(diffTable(sec, color));
  }

  if (d.description) {
    wrap.append(h("div", "Description", "tl2-detail-h"));
    wrap.append(h("div", d.description, "tl2-detail-text"));
  }

  if (!wrap.childElementCount) {
    wrap.append(h("div", "No documentation diff recorded for this change.", "tl2-detail-empty"));
  }
  return wrap;
}

// How many unchanged lines of context to keep beside each change, and the
// shortest run of hidden lines worth folding (folding 1–3 lines saves nothing).
const DIFF_CONTEXT = 2;
const DIFF_MIN_FOLD = 4;

/**
 * Render one diff section as a unified-diff table: changed rows in colour with
 * a couple of context lines either side, and long runs of untouched lines folded
 * behind a click-to-expand "⋯ N unchanged lines" row (git's `@@` hunks).
 */
function diffTable(sec: DiffSection, color: string): HTMLElement {
  const table = div("tl2-difftable");
  const rows = sec.rows;

  // Keep every changed row plus DIFF_CONTEXT rows of context around it.
  const keep = new Set<number>();
  rows.forEach((r, i) => {
    if (r.op === "unchanged") return;
    for (let k = i - DIFF_CONTEXT; k <= i + DIFF_CONTEXT; k++) {
      if (k >= 0 && k < rows.length) keep.add(k);
    }
  });

  let i = 0;
  while (i < rows.length) {
    if (keep.has(i)) {
      table.append(diffRowEl(rows[i] as DiffRow, color));
      i++;
      continue;
    }
    // A run of out-of-context unchanged lines — fold it when long enough.
    const hidden: DiffRow[] = [];
    while (i < rows.length && !keep.has(i)) hidden.push(rows[i++] as DiffRow);
    if (hidden.length >= DIFF_MIN_FOLD) table.append(diffFold(hidden, color));
    else for (const r of hidden) table.append(diffRowEl(r, color));
  }
  return table;
}

/** One unified-diff line: a `+`/`−`/space gutter then the cells. */
function diffRowEl(dr: DiffRow, color: string): HTMLElement {
  const line = div(`tl2-diffrow ${dr.op}`);
  line.style.setProperty("--accent", color);
  const sign = dr.op === "added" ? "+" : dr.op === "removed" ? "−" : " ";
  line.append(span(sign, "tl2-diffsign"));
  for (const cell of dr.cols) line.append(span(cell, "tl2-diffcell"));
  return line;
}

/** A collapsed run of unchanged lines; click/Enter expands it in place. */
function diffFold(hidden: DiffRow[], color: string): HTMLElement {
  const fold = div("tl2-difffold");
  fold.tabIndex = 0;
  fold.setAttribute("role", "button");
  fold.append(span("⋯", "tl2-difffold-ic"));
  const n = hidden.length;
  fold.append(span(`${n} unchanged line${n === 1 ? "" : "s"}`, "tl2-difffold-tx"));
  const expand = () => {
    const frag = document.createDocumentFragment();
    for (const r of hidden) frag.append(diffRowEl(r, color));
    fold.replaceWith(frag);
  };
  fold.addEventListener("click", expand);
  fold.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      expand();
    }
  });
  return fold;
}

function infraBody(d: InfraDetail, cb: TimelineCallbacks): HTMLElement {
  const wrap = div("tl2-detail");
  if (d.subject === "node") {
    const grid = div("tl2-proptable");
    if (d.nodeKind) grid.append(propRow("Kind", d.nodeKind));
    if (d.label) grid.append(propRow("Label", d.label));
    if (d.tech) grid.append(propRow("Tech", d.tech));
    wrap.append(grid);
    if (d.description) wrap.append(h("div", d.description, "tl2-detail-text"));
  } else if (d.subject === "edge") {
    const grid = div("tl2-proptable");
    grid.append(propRow("Connection", `${d.fromLabel ?? "?"} → ${d.toLabel ?? "?"}`));
    if (d.edgeLabel) grid.append(propRow("Label", d.edgeLabel));
    wrap.append(grid);
  } else {
    wrap.append(h("div", "This infrastructure item no longer exists.", "tl2-detail-empty"));
  }
  if (d.mermaid) wrap.append(diagram(d.mermaid, cb));
  return wrap;
}

function flowBody(d: FlowDetail, cb: TimelineCallbacks): HTMLElement {
  const wrap = div("tl2-detail");
  if (!d.found) {
    wrap.append(h("div", "This flow no longer exists.", "tl2-detail-empty"));
    return wrap;
  }
  if (d.description) wrap.append(h("div", d.description, "tl2-detail-text"));
  if (!d.steps.length) {
    wrap.append(h("div", "This flow has no steps yet.", "tl2-detail-empty"));
    return wrap;
  }
  const list = div("tl2-steps");
  for (const s of d.steps) {
    const row = div("tl2-step-row");
    row.append(span(String(s.n), "tl2-step-n"));
    row.append(span(`${s.fromLabel} → ${s.toLabel}`, "tl2-step-nodes"));
    if (s.label) row.append(span(s.label, "tl2-step-label"));
    list.append(row);
  }
  wrap.append(list);
  if (d.mermaid) wrap.append(diagram(d.mermaid, cb));
  return wrap;
}

/** A Mermaid diagram host; renders async via the host's `renderMermaid`. */
function diagram(src: string, cb: TimelineCallbacks): HTMLElement {
  const box = div("tl2-diagram");
  if (!cb.renderMermaid) return box;
  box.append(h("div", "Rendering…", "tl2-detail-empty"));
  const token = pickId; // bail if the user navigates to another event meanwhile
  void cb
    .renderMermaid(src)
    .then((svg) => {
      if (pickId !== token) return;
      box.innerHTML = svg;
    })
    .catch(() => {
      box.replaceChildren(h("div", "Couldn't render diagram.", "tl2-detail-empty"));
    });
  return box;
}

function checkpointBody(d: CheckpointDetail, cb: TimelineCallbacks): HTMLElement {
  const wrap = div("tl2-detail");
  if (d.preview?.elements.length) {
    wrap.append(previewEl(d.preview, cb.imageHref));
    wrap.append(h("div", basisCaption(d.preview.basis), "tl2-preview-cap"));
  } else {
    wrap.append(h("div", "This checkpoint captured no design elements.", "tl2-detail-empty"));
  }
  const chips = div("tl2-changechips");
  for (const c of d.changes) {
    if (!c.n) continue;
    chips.append(span(`${c.layer} ${c.n}`, "tl2-changechip"));
  }
  if (chips.childElementCount) {
    wrap.append(h("div", "Changed in this checkpoint", "tl2-detail-h"));
    wrap.append(chips);
  }
  return wrap;
}

// --------------------------------------------------------------------------
// Design preview — the element (and its descendants) drawn as a fitted SVG, so
// a design/checkpoint event shows the actual artefact, not just its numbers.
// --------------------------------------------------------------------------
function previewEl(
  preview: DesignPreview,
  imageHref?: TimelineCallbacks["imageHref"],
): HTMLElement {
  const wrap = div("tl2-preview");
  const els = preview.elements;
  // A text element's stored box is its anchor, not its rendered width — long
  // labels overflow it. Bound against an estimate of the glyphs' extent so the
  // SVG viewport doesn't clip a label (e.g. "upload file here") at its edge.
  const b = boundsOf(els.map((el) => rotatedBox(textAwareBox(el), el.rotation)));
  const pad = Math.max(8, Math.max(b.w, b.h) * 0.06);
  const view = svgNode("svg", {
    viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`,
    preserveAspectRatio: "xMidYMid meet",
    class: "tl2-preview-svg",
  });
  for (const el of els) {
    const node = previewShape(el, preview.rootId);
    if (!node) continue;
    // Rotate the shape and its image together about the element's centre, as the canvas does.
    const target = el.rotation
      ? svgNode("g", {
          transform: `rotate(${el.rotation} ${el.x + el.width / 2} ${el.y + el.height / 2})`,
        })
      : view;
    target.append(node);
    const image = el.type !== "text" ? el.style?.image : undefined;
    const href = image && imageHref?.(image.asset);
    if (image && href) target.append(...previewImage(el, image, href, node));
    if (target !== view) view.append(target);
  }
  wrap.append(view);
  return wrap;
}

/** A short line saying whether the preview is a true as-of snapshot or live. */
function basisCaption(b: DesignPreview["basis"]): string {
  if (b.kind === "checkpoint") {
    const when = b.at
      ? ` · ${MONTHS[new Date(b.at).getMonth()]} ${new Date(b.at).getDate()}, ${new Date(b.at).getFullYear()}`
      : "";
    return `As of checkpoint “${b.label ?? "?"}”${when}`;
  }
  return "Current state on the canvas (no earlier checkpoint to reconstruct from)";
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * A box big enough to contain an element's *rendered* form. For text, the
 * stored width is just the anchor box, so estimate the glyph run (~0.6em/char)
 * and line height — otherwise a long label overflows the fitted viewBox and the
 * SVG clips it. Non-text elements are returned unchanged.
 */
function textAwareBox(
  el: DesignPreview["elements"][number],
): { x: number; y: number; width: number; height: number } {
  if (el.type !== "text") {
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }
  const fontSize = el.style?.fontSize ?? 14;
  const chars = (el.text ?? "").length;
  return {
    x: el.x,
    y: el.y,
    width: Math.max(el.width, chars * fontSize * 0.6),
    height: Math.max(el.height, fontSize * 1.3),
  };
}

/** The axis-aligned box a box covers once rotated about its centre (degrees clockwise). */
export function rotatedBox(
  b: { x: number; y: number; width: number; height: number },
  rotation: number | undefined,
): { x: number; y: number; width: number; height: number } {
  if (!rotation) return b;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = b.width * cos + b.height * sin;
  const height = b.width * sin + b.height * cos;
  return {
    x: b.x + b.width / 2 - width / 2,
    y: b.y + b.height / 2 - height / 2,
    width,
    height,
  };
}

function boundsOf(els: { x: number; y: number; width: number; height: number }[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of els) {
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.width);
    maxY = Math.max(maxY, e.y + e.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** Draw one element as a clean SVG primitive (no selection/doc chrome). */
function previewShape(
  el: DesignPreview["elements"][number],
  rootId?: string,
): SVGElement | null {
  const style = el.style ?? {};
  const fill = style.fill ?? (el.type === "frame" ? "transparent" : "rgba(255,255,255,0.07)");
  const stroke = style.stroke ?? (el.type === "frame" ? "rgba(255,255,255,0.22)" : "");
  const strokeAttrs: Record<string, string> = stroke
    ? { stroke, "stroke-width": String(style.strokeWidth ?? 1) }
    : {};

  if (el.type === "text") {
    const t = svgNode("text", {
      x: String(el.x),
      y: String(el.y + (style.fontSize ?? 14)),
      "font-size": String(style.fontSize ?? 14),
      "font-weight": String(style.fontWeight ?? 400),
      fill: style.color ?? "#cfccc4",
      class: "tl2-preview-text",
    });
    t.textContent = el.text ?? "Text";
    return t;
  }
  if (el.type === "ellipse") {
    return svgNode("ellipse", {
      cx: String(el.x + el.width / 2),
      cy: String(el.y + el.height / 2),
      rx: String(el.width / 2),
      ry: String(el.height / 2),
      fill,
      ...strokeAttrs,
    });
  }
  const rect = svgNode("rect", {
    x: String(el.x),
    y: String(el.y),
    width: String(el.width),
    height: String(el.height),
    rx: String(style.radius ?? 0),
    fill,
    ...strokeAttrs,
  });
  if (el.id === rootId) rect.classList.add("tl2-preview-focus");
  return rect;
}

let previewClipSeq = 0;

/**
 * An element's image fill in a preview: clipped to the shape just drawn (a
 * copy of it is the clip path), then the shape's stroke again on top — the
 * same layering the canvas uses.
 */
function previewImage(
  el: DesignPreview["elements"][number],
  image: ImageFill,
  href: string,
  shape: SVGElement,
): SVGElement[] {
  const id = `tl2-img-clip-${++previewClipSeq}`;
  const clip = svgNode("clipPath", { id, clipPathUnits: "userSpaceOnUse" });
  clip.append(shape.cloneNode(false));
  const img = svgNode("image", {
    href,
    x: String(el.x),
    y: String(el.y),
    width: String(el.width),
    height: String(el.height),
    preserveAspectRatio: preserveAspectRatio(image.fit),
    "clip-path": `url(#${id})`,
  });
  const out: SVGElement[] = [clip, img];
  if (shape.getAttribute("stroke")) {
    const outline = shape.cloneNode(false) as SVGElement;
    outline.setAttribute("fill", "none");
    out.push(outline);
  }
  return out;
}

/** Namespaced SVG element with attributes (the preview's tiny builder). */
function svgNode(name: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// ---- detail builders ------------------------------------------------------
function propRow(label: string, value: string): HTMLElement {
  return propRowEl(label, span(value, "tl2-prop-v"));
}
function propRowEl(label: string, value: HTMLElement): HTMLElement {
  const row = div("tl2-prop");
  row.append(span(label, "tl2-prop-k"));
  row.append(value);
  return row;
}

function stepBtn(glyph: string, onClick: () => void, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tl2-step";
  b.type = "button";
  b.textContent = glyph;
  b.setAttribute("aria-label", label);
  b.title = label;
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

/** Epoch ms → 24h `HH:MM`, the time alongside the date on every event. */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
