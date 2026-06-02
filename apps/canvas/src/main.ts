import {
  DesignElement,
  type ElementType,
  type InfraEdge,
  type InfraKind,
  type InfraNode,
} from "@adc/shared";
import { loadConfig } from "./config.js";
import {
  FixtureSource,
  LiveSource,
  type CanvasSource,
  type ElementSnapshot,
} from "./firebase.js";
import { RestSource } from "./rest-source.js";
import { descendants, findParent, snap, type Rect } from "./geometry.js";
import { renderPanel } from "./panel.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Pick the data source from local config (`.env.local`):
 *   - mock: poll the local mock-rtdb over REST (end-to-end testing)
 *   - live: sync to the user's real Firebase RTDB
 *   - none: offline fixture, so the editor still runs with zero setup
 */
const config = loadConfig();
const PROJECT_ID = config?.projectId ?? "project_xyz";
const source: CanvasSource = !config
  ? new FixtureSource(PROJECT_ID)
  : config.mode === "mock"
    ? new RestSource(config.databaseUrl, config.projectId)
    : new LiveSource(config.firebase, config.projectId, config.options);
console.info(
  `[canvas] source: ${config?.mode ?? "fixture"}, project "${PROJECT_ID}"`,
);

const svg = document.getElementById("canvas") as unknown as SVGSVGElement;
const panel = document.getElementById("panel") as HTMLElement;
const toolbar = document.getElementById("toolbar") as HTMLElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLElement | null;

// ---- editor state -------------------------------------------------------
type Tool = "select" | "frame" | "rectangle" | "text";
const elements = new Map<string, DesignElement>();
const timelines = new Map<string, ElementSnapshot["timeline"]>();
const lastSeen = new Map<string, string>();
const infraNodes = new Map<string, InfraNode>();
let infraEdges: InfraEdge[] = [];
let tool: Tool = "select";
let selectedId: string | null = null;
let hoverId: string | null = null; // element under the pointer (drives the doc leader line)
let showDocs = true; // show/hide the minimized API indicators on documented elements
let showInfra = false; // show/hide the infrastructure diagram overlay

// Viewport: `translate(panX, panY) scale(zoom)` applied to everything drawn.
let zoom = 1;
let panX = 0;
let panY = 0;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

type Gesture =
  | { kind: "move"; id: string; startX: number; startY: number; orig: Rect }
  | { kind: "resize"; id: string; startX: number; startY: number; orig: Rect }
  | { kind: "create"; type: ElementType; startX: number; startY: number; id: string }
  | { kind: "pan"; startX: number; startY: number; origPanX: number; origPanY: number; moved: boolean };
let gesture: Gesture | null = null;
let guides: { v: number[]; h: number[] } = { v: [], h: [] };

// ---- bootstrap ----------------------------------------------------------
buildToolbar();
wireZoomControls();
source.subscribe((snaps) => {
  // Don't clobber an element the user is actively dragging.
  const active = gesture && "id" in gesture ? gesture.id : null;
  for (const s of snaps) {
    if (s.element.id === active) continue;
    elements.set(s.element.id, s.element);
    timelines.set(s.element.id, s.timeline);
  }
  render();
});
source.subscribeInfra((infra) => {
  infraNodes.clear();
  for (const n of infra.nodes) infraNodes.set(n.id, n);
  infraEdges = infra.edges;
  render();
});

// ========================================================================
// Toolbar
// ========================================================================
function buildToolbar(): void {
  const tools: Array<[Tool, string]> = [
    ["select", "▱\nMove"],
    ["frame", "▢\nFrame"],
    ["rectangle", "▭\nRect"],
    ["text", "T\nText"],
  ];
  for (const [t, label] of tools) {
    const btn = button(label, () => setTool(t));
    btn.dataset.tool = t;
    toolbar.append(btn);
  }
  toolbar.append(divider());
  toolbar.append(button("◆\nComp", makeComponent));
  toolbar.append(button("⧉\nInst", placeInstance));
  toolbar.append(button("🗑\nDel", deleteSelected));
  toolbar.append(divider());
  const docsBtn = button("🛈\nDocs", toggleDocs);
  docsBtn.dataset.toggle = "docs";
  docsBtn.classList.toggle("active", showDocs);
  toolbar.append(docsBtn);
  const infraBtn = button("🗄\nInfra", toggleInfra);
  infraBtn.dataset.toggle = "infra";
  infraBtn.classList.toggle("active", showInfra);
  toolbar.append(infraBtn);
  refreshToolbar();
}

/** Show or hide the project's infrastructure diagram overlay. */
function toggleInfra(): void {
  showInfra = !showInfra;
  toolbar
    .querySelector('[data-toggle="infra"]')
    ?.classList.toggle("active", showInfra);
  render();
}

/** Show or hide the minimized API indicators on every documented element. */
function toggleDocs(): void {
  showDocs = !showDocs;
  toolbar
    .querySelector('[data-toggle="docs"]')
    ?.classList.toggle("active", showDocs);
  render();
}

function setTool(t: Tool): void {
  tool = t;
  refreshToolbar();
}

function refreshToolbar(): void {
  for (const btn of Array.from(toolbar.querySelectorAll("button"))) {
    const t = (btn as HTMLElement).dataset.tool;
    btn.classList.toggle("active", t === tool);
  }
}

// ========================================================================
// Rendering
// ========================================================================
function render(): void {
  svg.replaceChildren();
  // Everything draws inside a viewport group so pan/zoom is a single transform.
  const vp = svgEl("g", {
    transform: `translate(${panX} ${panY}) scale(${zoom})`,
  }) as SVGGElement;

  // Design layer in its own group so the infra overlay can dim it as a unit.
  const design = svgEl("g", {}) as SVGGElement;
  if (showInfra) design.setAttribute("opacity", "0.35");
  for (const el of ordered()) design.append(drawElement(el));
  if (selectedId) {
    const sel = elements.get(selectedId);
    if (sel) design.append(...handles(sel));
  }
  for (const x of guides.v) design.append(line(x, 0, x, 4000));
  for (const y of guides.h) design.append(line(0, y, 4000, y));
  vp.append(design);

  if (showInfra) vp.append(drawInfraLayer());

  // Focus-mode doc leader: the selected (or hovered) element draws one leader
  // line out to its documentation. Appended to the viewport AFTER the design
  // group so it stays full-opacity even when the infra overlay dims the design.
  if (showDocs) {
    const focusId = selectedId ?? hoverId;
    const focus = focusId ? elements.get(focusId) : undefined;
    if (focus?.apiBinding) vp.append(drawDocLeader(focus));
  }

  svg.append(vp);
  updateZoomLabel();
  renderSelectionPanel();
}

// ========================================================================
// Infrastructure overlay (pillar 3)
// ========================================================================
const INFRA_COLORS: Record<InfraKind, string> = {
  frontend: "#5b8cff",
  backend: "#36c275",
  database: "#c9a227",
  cache: "#d1603d",
  queue: "#b06ad6",
  service: "#3db6c9",
  devops: "#e0507a",
  external: "#8a93a3",
  group: "#6b7280",
};

/** Draw the infra diagram: edges between node centres, then the node boxes. */
function drawInfraLayer(): SVGGElement {
  const g = svgEl("g", { class: "infra-layer" }) as SVGGElement;

  // Edges first so the node boxes paint on top of the connectors.
  for (const edge of infraEdges) {
    const a = infraNodes.get(edge.from);
    const b = infraNodes.get(edge.to);
    if (!a || !b) continue; // skip dangling edges
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const l = line(ax, ay, bx, by);
    l.setAttribute("class", "infra-edge");
    g.append(l);
    if (edge.label) {
      const t = text(edge.label, (ax + bx) / 2, (ay + by) / 2 - 2, "infra-edge-label");
      g.append(t);
    }
  }

  // Group containers first so nodes nested in them paint on top.
  const ordered = [...infraNodes.values()].sort(
    (p, q) => q.width * q.height - p.width * p.height,
  );
  for (const n of ordered) g.append(drawInfraNode(n));
  return g;
}

function drawInfraNode(n: InfraNode): SVGGElement {
  const g = svgEl("g", {}) as SVGGElement;
  const color = INFRA_COLORS[n.kind];

  const box = svgEl("rect", {
    x: String(n.x),
    y: String(n.y),
    width: String(n.width),
    height: String(n.height),
    rx: "8",
    class: n.kind === "group" ? "infra-box infra-group" : "infra-box",
  });
  box.setAttribute("stroke", color);
  g.append(box);

  // Left accent stripe in the kind colour.
  const accent = svgEl("rect", {
    x: String(n.x),
    y: String(n.y),
    width: "4",
    height: String(n.height),
    rx: "2",
  });
  accent.setAttribute("fill", color);
  g.append(accent);

  const kind = text(n.kind.toUpperCase(), n.x + 12, n.y + 18, "infra-kind");
  const label = text(n.label, n.x + 12, n.y + 36, "infra-label");
  g.append(kind, label);
  if (n.tech) g.append(text(n.tech, n.x + 12, n.y + 52, "infra-tech"));
  return g;
}

/** Parents before children so nested elements draw on top. */
function ordered(): DesignElement[] {
  const depth = (el: DesignElement): number => {
    let d = 0;
    let p = el.parentId;
    while (p) {
      d++;
      p = elements.get(p)?.parentId ?? null;
    }
    return d;
  };
  return [...elements.values()].sort((a, b) => depth(a) - depth(b));
}

/** Resolve display props, following an instance to its master component. */
function resolved(el: DesignElement): DesignElement {
  if (el.type === "instance" && el.componentId) {
    const master = elements.get(el.componentId);
    if (master) return { ...master, ...el, type: "instance" };
  }
  return el;
}

function drawElement(raw: DesignElement): SVGGElement {
  const el = resolved(raw);
  const g = document.createElementNS(SVG_NS, "g");
  g.dataset.id = raw.id;
  const style = el.style ?? {};
  const changed =
    lastSeen.has(raw.id) && lastSeen.get(raw.id) !== raw.updatedAt;
  lastSeen.set(raw.id, raw.updatedAt);
  const cls = [
    el.type === "frame" ? "el-frame" : "el-rect",
    raw.id === selectedId ? "el-selected" : "",
    changed ? "el-changed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (el.type === "text") {
    const t = text(
      el.text ?? "Text",
      el.x,
      el.y + (style.fontSize ?? 16),
      "el-label",
    );
    t.setAttribute("font-size", String(style.fontSize ?? 16));
    t.setAttribute("font-weight", String(style.fontWeight ?? 400));
    if (style.color) t.setAttribute("fill", style.color);
    g.append(t);
  } else {
    const rect = el2rect(el, cls, style);
    g.append(rect);
    if (el.text) {
      const t = text(el.text, el.x + 10, el.y + el.height / 2 + 4, "el-label");
      if (style.color) t.setAttribute("fill", style.color);
      g.append(t);
    }
    const name = text(raw.name || raw.id, el.x, el.y - 6, "el-name");
    name.setAttribute("opacity", "0.7");
    name.setAttribute("font-size", "10");
    g.append(name);
  }

  // API documentation indicator — shown only while the "Docs" toggle is on.
  if (raw.apiBinding && showDocs) {
    const b = raw.apiBinding;
    const label =
      b.method || b.endpoint
        ? [b.method, b.endpoint].filter(Boolean).join(" ")
        : b.title;
    g.append(badge(label, el.x + 6, el.y + 14));
  }
  return g;
}

function el2rect(
  el: DesignElement,
  cls: string,
  style: NonNullable<DesignElement["style"]>,
): SVGRectElement {
  const r = svgEl("rect", {
    x: String(el.x),
    y: String(el.y),
    width: String(el.width),
    height: String(el.height),
    rx: String(style.radius ?? 0),
    class: cls,
  }) as SVGRectElement;
  if (style.fill) r.setAttribute("fill", style.fill);
  if (style.stroke) r.setAttribute("stroke", style.stroke);
  if (style.strokeWidth != null)
    r.setAttribute("stroke-width", String(style.strokeWidth));
  return r;
}

function handles(el: DesignElement): SVGElement[] {
  const r = resolved(el);
  const h = svgEl("rect", {
    x: String(r.x + r.width - 5),
    y: String(r.y + r.height - 5),
    width: "10",
    height: "10",
    class: "handle",
  });
  h.dataset.handle = "se";
  return [h];
}

/**
 * Draw a single leader line from a documented element out to a label box, in
 * the anime.js callout style: anchor on the element's right edge → short stub →
 * rise → label. World-space, so it pans/zooms with the design. The label is
 * clickable (carries data-id) so it selects the element and opens its docs.
 */
function drawDocLeader(raw: DesignElement): SVGGElement {
  const el = resolved(raw);
  const b = raw.apiBinding;
  if (!b) return svgEl("g", {}) as SVGGElement;
  const primary =
    b.method || b.endpoint
      ? [b.method, b.endpoint].filter(Boolean).join(" ")
      : b.title;
  const secondary = b.method || b.endpoint ? b.title : (b.language ?? "");

  // Anchor at the right-edge midpoint, elbow out and up to lift the label clear.
  const ax = el.x + el.width;
  const ay = el.y + el.height / 2;
  const stub = ax + 28;
  const labelY = ay - 24;
  const labelX = stub + 34;

  const g = svgEl("g", { class: "doc-leader" }) as SVGGElement;
  g.dataset.id = raw.id;

  const path = svgEl("polyline", {
    points: `${ax},${ay} ${stub},${ay} ${stub},${labelY} ${labelX - 6},${labelY}`,
    class: "doc-leader-line",
  });
  g.append(path);

  const dot = svgEl("circle", {
    cx: String(ax),
    cy: String(ay),
    r: "3",
    class: "doc-leader-dot",
  });
  g.append(dot);

  // Approximate width from the longer line (bold ~7px/char, sub ~6px/char).
  const w = Math.max(primary.length * 7, secondary.length * 6) + 16;
  const hasSub = secondary.length > 0;
  const boxH = hasSub ? 34 : 22;
  const bg = svgEl("rect", {
    x: String(labelX - 6),
    y: String(labelY - boxH / 2),
    width: String(w),
    height: String(boxH),
    rx: "5",
    class: "doc-leader-bg",
  });
  g.append(bg);

  const title = text(primary, labelX, hasSub ? labelY - 2 : labelY + 4, "doc-leader-label");
  g.append(title);
  if (hasSub) g.append(text(secondary, labelX, labelY + 12, "doc-leader-sub"));

  return g;
}

// ========================================================================
// Pointer interaction
// ========================================================================
svg.addEventListener("pointerdown", (e) => {
  const pt = toCanvas(e);
  const handleEl = (e.target as Element).closest("[data-handle]");
  const elEl = (e.target as Element).closest("[data-id]");

  if (tool !== "select") {
    const id = `el_${Date.now().toString(36)}`;
    gesture = {
      kind: "create",
      type: tool,
      startX: pt.x,
      startY: pt.y,
      id,
    };
    elements.set(id, newElement(id, tool, pt.x, pt.y));
    select(id);
    svg.setPointerCapture(e.pointerId);
    return;
  }

  if (handleEl && selectedId) {
    const orig = elements.get(selectedId);
    if (orig)
      gesture = {
        kind: "resize",
        id: selectedId,
        startX: pt.x,
        startY: pt.y,
        orig: rectOf(orig),
      };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  if (elEl instanceof SVGElement && elEl.dataset.id) {
    const id = elEl.dataset.id;
    select(id);
    const orig = elements.get(id);
    if (orig)
      gesture = {
        kind: "move",
        id,
        startX: pt.x,
        startY: pt.y,
        orig: rectOf(orig),
      };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  // Empty space: start a pan. A click with no movement deselects on pointerup.
  gesture = {
    kind: "pan",
    startX: e.clientX,
    startY: e.clientY,
    origPanX: panX,
    origPanY: panY,
    moved: false,
  };
  svg.classList.add("panning");
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener("pointermove", (e) => {
  if (!gesture) return;

  if (gesture.kind === "pan") {
    const ddx = e.clientX - gesture.startX;
    const ddy = e.clientY - gesture.startY;
    if (Math.abs(ddx) > 3 || Math.abs(ddy) > 3) gesture.moved = true;
    panX = gesture.origPanX + ddx;
    panY = gesture.origPanY + ddy;
    render();
    return;
  }

  const pt = toCanvas(e);
  const dx = pt.x - gesture.startX;
  const dy = pt.y - gesture.startY;
  const el = elements.get(gesture.id);
  if (!el) return;

  if (gesture.kind === "create") {
    update(gesture.id, {
      x: Math.min(gesture.startX, pt.x),
      y: Math.min(gesture.startY, pt.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    });
  } else if (gesture.kind === "move") {
    const moved: Rect = {
      x: gesture.orig.x + dx,
      y: gesture.orig.y + dy,
      width: gesture.orig.width,
      height: gesture.orig.height,
    };
    const s = snap(moved, otherRects(gesture.id));
    guides = { v: s.vGuides, h: s.hGuides };
    applyMove(gesture.id, moved.x + s.dx - el.x, moved.y + s.dy - el.y);
  } else {
    update(gesture.id, {
      width: Math.max(8, gesture.orig.width + dx),
      height: Math.max(8, gesture.orig.height + dy),
    });
  }
  render();
});

svg.addEventListener("pointerup", () => {
  if (!gesture) return;

  if (gesture.kind === "pan") {
    svg.classList.remove("panning");
    if (!gesture.moved) select(null); // a plain click on empty space deselects
    gesture = null;
    return;
  }

  const el = elements.get(gesture.id);
  guides = { v: [], h: [] };
  if (el) {
    // On drop, recompute nesting and persist.
    const parentId = findParent(rectOf(el), el.id, elements.values());
    const finalEl = { ...el, parentId, updatedAt: new Date().toISOString() };
    elements.set(el.id, finalEl);
    void source.saveElement(finalEl);
  }
  if (gesture.kind === "create") setTool("select");
  gesture = null;
  render();
});

// Track the element under the pointer so a documented one shows its doc leader
// on hover. Skip while a gesture is in flight to avoid churn during drags.
svg.addEventListener("pointerover", (e) => {
  if (gesture) return;
  const elEl = (e.target as Element).closest?.("[data-id]");
  const id = elEl instanceof SVGElement ? (elEl.dataset.id ?? null) : null;
  if (id !== hoverId) {
    hoverId = id;
    if (showDocs) render();
  }
});

window.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT") return;
    deleteSelected();
  }
});

// ========================================================================
// Mutations
// ========================================================================
function newElement(
  id: string,
  type: ElementType,
  x: number,
  y: number,
): DesignElement {
  return DesignElement.parse({
    id,
    type,
    name: `${type} ${id.slice(-4)}`,
    x,
    y,
    width: type === "text" ? 120 : 8,
    height: type === "text" ? 24 : 8,
    parentId: null,
    text: type === "text" ? "Text" : undefined,
    style:
      type === "frame"
        ? { fill: "#161a24", stroke: "#3a4250", radius: 8 }
        : type === "rectangle"
          ? { fill: "#1b2030", stroke: "#3a4250", radius: 6 }
          : { fontSize: 16, color: "#e6e6e6" },
    updatedAt: new Date().toISOString(),
  });
}

function update(id: string, patch: Partial<DesignElement>): void {
  const el = elements.get(id);
  if (!el) return;
  elements.set(id, { ...el, ...patch });
}

/** Move an element and all of its descendants by a delta. */
function applyMove(id: string, dx: number, dy: number): void {
  const ids = [id, ...descendants(id, elements.values())];
  for (const cid of ids) {
    const el = elements.get(cid);
    if (el) elements.set(cid, { ...el, x: el.x + dx, y: el.y + dy });
  }
}

function select(id: string | null): void {
  selectedId = id;
  render();
}

function deleteSelected(): void {
  if (!selectedId) return;
  const id = selectedId;
  for (const cid of [id, ...descendants(id, elements.values())]) {
    elements.delete(cid);
    void source.deleteElement(cid);
  }
  select(null);
}

function makeComponent(): void {
  if (!selectedId) return;
  const el = elements.get(selectedId);
  if (!el) return;
  const updated = { ...el, type: "component" as const, updatedAt: now() };
  elements.set(el.id, updated);
  void source.saveElement(updated);
  render();
}

function placeInstance(): void {
  if (!selectedId) return;
  const master = elements.get(selectedId);
  if (!master || master.type !== "component") {
    notify("Select a component first (◆ Comp), then place an instance.");
    return;
  }
  const id = `el_${Date.now().toString(36)}`;
  const inst = DesignElement.parse({
    ...master,
    id,
    type: "instance",
    componentId: master.id,
    name: `${master.name} instance`,
    x: master.x + 24,
    y: master.y + 24,
    parentId: null,
    apiBinding: undefined,
    updatedAt: now(),
  });
  elements.set(id, inst);
  void source.saveElement(inst);
  select(id);
}

// ========================================================================
// Properties + API panel
// ========================================================================
function renderSelectionPanel(): void {
  const el = selectedId ? elements.get(selectedId) : undefined;
  const tl = selectedId ? (timelines.get(selectedId) ?? []) : [];
  renderPanel(panel, el, tl, (patch) => {
    if (!selectedId) return;
    const current = elements.get(selectedId);
    if (!current) return;
    const updated = { ...current, ...patch, updatedAt: now() };
    elements.set(selectedId, updated);
    void source.saveElement(updated);
    render();
  });
}

// ========================================================================
// Small helpers
// ========================================================================
function toCanvas(e: PointerEvent): { x: number; y: number } {
  const box = svg.getBoundingClientRect();
  // Invert the viewport transform: screen -> world.
  return {
    x: (e.clientX - box.left - panX) / zoom,
    y: (e.clientY - box.top - panY) / zoom,
  };
}

// ========================================================================
// Zoom & pan
// ========================================================================
function wireZoomControls(): void {
  document
    .getElementById("zoomIn")
    ?.addEventListener("click", () => zoomToCenter(zoom * ZOOM_STEP));
  document
    .getElementById("zoomOut")
    ?.addEventListener("click", () => zoomToCenter(zoom / ZOOM_STEP));
  document.getElementById("zoomFit")?.addEventListener("click", fitView);
  // Ctrl/⌘ + wheel zooms toward the cursor; plain wheel scrolls as usual.
  window.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, e.clientX, e.clientY);
    },
    { passive: false },
  );
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
function updateZoomLabel(): void {
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}
/** Zoom toward a screen point, keeping the world point under it fixed. */
function zoomAt(next: number, clientX: number, clientY: number): void {
  const box = svg.getBoundingClientRect();
  const z = clampZoom(next);
  const wx = (clientX - box.left - panX) / zoom;
  const wy = (clientY - box.top - panY) / zoom;
  zoom = z;
  panX = clientX - box.left - wx * zoom;
  panY = clientY - box.top - wy * zoom;
  render();
}
function zoomToCenter(next: number): void {
  const box = svg.getBoundingClientRect();
  zoomAt(next, box.left + box.width / 2, box.top + box.height / 2);
}
/** Fit all elements into the viewport with a little padding. */
function fitView(): void {
  const els = [...elements.values()];
  if (!els.length) {
    zoom = 1;
    panX = 0;
    panY = 0;
    render();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }
  const box = svg.getBoundingClientRect();
  const pad = 40;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  zoom = clampZoom(
    Math.min((box.width - pad * 2) / w, (box.height - pad * 2) / h),
  );
  panX = (box.width - w * zoom) / 2 - minX * zoom;
  panY = (box.height - h * zoom) / 2 - minY * zoom;
  render();
}
function rectOf(el: DesignElement): Rect {
  const r = resolved(el);
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
function otherRects(excludeId: string): Rect[] {
  const out: Rect[] = [];
  for (const el of elements.values())
    if (el.id !== excludeId) out.push(rectOf(el));
  return out;
}
function now(): string {
  return new Date().toISOString();
}
function notify(msg: string): void {
  panel.querySelector(".empty")?.remove();
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = msg;
  panel.prepend(p);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.whiteSpace = "pre";
  b.addEventListener("click", onClick);
  return b;
}
function divider(): HTMLElement {
  const d = document.createElement("div");
  d.className = "sep";
  return d;
}
function svgEl(name: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
function text(content: string, x: number, y: number, cls = ""): SVGTextElement {
  const t = svgEl("text", { x: String(x), y: String(y) }) as SVGTextElement;
  if (cls) t.setAttribute("class", cls);
  t.textContent = content;
  return t;
}
function badge(content: string, x: number, y: number): SVGTextElement {
  return text(content, x, y, "el-badge");
}
function line(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  return svgEl("line", {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    class: "snapline",
  }) as SVGLineElement;
}
