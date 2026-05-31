import { DesignElement, type ElementType } from "@adc/shared";
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

// ---- editor state -------------------------------------------------------
type Tool = "select" | "frame" | "rectangle" | "text";
const elements = new Map<string, DesignElement>();
const timelines = new Map<string, ElementSnapshot["timeline"]>();
const lastSeen = new Map<string, string>();
let tool: Tool = "select";
let selectedId: string | null = null;

type Gesture =
  | { kind: "move"; id: string; startX: number; startY: number; orig: Rect }
  | { kind: "resize"; id: string; startX: number; startY: number; orig: Rect }
  | { kind: "create"; type: ElementType; startX: number; startY: number; id: string };
let gesture: Gesture | null = null;
let guides: { v: number[]; h: number[] } = { v: [], h: [] };

// ---- bootstrap ----------------------------------------------------------
buildToolbar();
source.subscribe((snaps) => {
  // Don't clobber an element the user is actively dragging.
  const active = gesture?.id ?? null;
  for (const s of snaps) {
    if (s.element.id === active) continue;
    elements.set(s.element.id, s.element);
    timelines.set(s.element.id, s.timeline);
  }
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
  refreshToolbar();
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
  for (const el of ordered()) svg.append(drawElement(el));
  if (selectedId) {
    const sel = elements.get(selectedId);
    if (sel) svg.append(...handles(sel));
  }
  for (const x of guides.v) svg.append(line(x, 0, x, 4000));
  for (const y of guides.h) svg.append(line(0, y, 4000, y));
  renderSelectionPanel();
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
    const name = text(raw.name || raw.id, el.x, el.y - 6, "el-label");
    name.setAttribute("opacity", "0.5");
    name.setAttribute("font-size", "10");
    g.append(name);
  }

  // API annotation badge — the whole point of the tool.
  if (raw.apiBinding) {
    g.append(
      badge(`${raw.apiBinding.method} ${raw.apiBinding.endpoint}`, el.x + 6, el.y + 14),
    );
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

  select(null);
});

svg.addEventListener("pointermove", (e) => {
  if (!gesture) return;
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
  return { x: e.clientX - box.left, y: e.clientY - box.top };
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
