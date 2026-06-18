import {
  type CurrentLabel,
  DesignElement,
  type ElementType,
  type InfraEdge,
  type InfraFlow,
  type InfraKind,
  type InfraNode,
  type VersionEntry,
  flowToMermaid,
  infraToComponentMermaid,
} from "forward-core";
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
import { renderTimelineView } from "./timeline-view.js";

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
    : new LiveSource(config.firebase, config.projectId, {
        ...config.options,
        onError: showAccessError,
      });

/** Surface a project-access failure (not a member) as a blocking banner. */
function showAccessError(err: Error): void {
  const banner = document.createElement("div");
  banner.className = "access-error";
  banner.textContent = err.message;
  document.body.prepend(banner);
}
console.info(
  `[canvas] source: ${config?.mode ?? "fixture"}, project "${PROJECT_ID}"`,
);

const svg = document.getElementById("canvas") as unknown as SVGSVGElement;
const panel = document.getElementById("panel") as HTMLElement;
const toolbar = document.getElementById("toolbar") as HTMLElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLElement | null;
const historyEl = document.getElementById("history") as HTMLElement;
const umlPanelEl = document.getElementById("umlpanel") as HTMLElement;

// Mermaid is heavy (~700kB), so lazy-load it the first time a UML diagram is
// opened — the offline/fixture path never pays for it. Dark theme to match the
// canvas; "loose" security lets the «component» stereotype labels (<br/>) through.
let umlSeq = 0; // unique id per render so Mermaid doesn't collide on re-renders
let mermaidPromise: Promise<typeof import("mermaid").default> | undefined;
function getMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: m }) => {
      m.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
      return m;
    });
  }
  return mermaidPromise;
}

// ---- editor state -------------------------------------------------------
type Tool = "select" | "frame" | "rectangle" | "text";
const elements = new Map<string, DesignElement>();
const timelines = new Map<string, ElementSnapshot["timeline"]>();
const lastSeen = new Map<string, string>();
const infraNodes = new Map<string, InfraNode>();
let infraEdges: InfraEdge[] = [];
const infraFlows = new Map<string, InfraFlow>();
let selectedFlowId: string | null = null; // flow chosen in the UML view (null = component diagram)
let umlOpen = false; // is the rendered-UML view showing?
let tool: Tool = "select";
let selectedId: string | null = null;
let hoverId: string | null = null; // element under the pointer (drives the doc leader line)
let showDocs = true; // show/hide the minimized API indicators on documented elements
let showInfra = false; // show/hide the infrastructure diagram overlay
let showTimeline = false; // show/hide the project endpoint-timeline panel

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
  infraFlows.clear();
  for (const f of infra.flows) infraFlows.set(f.id, f);
  // Drop a stale selection if its flow was deleted upstream.
  if (selectedFlowId && !infraFlows.has(selectedFlowId)) selectedFlowId = null;
  render();
  if (umlOpen) void renderUmlPanel(); // keep an open diagram in sync with new data
});

// ========================================================================
// Toolbar
// ========================================================================
function buildToolbar(): void {
  const tools: Array<[Tool, string, () => SVGElement]> = [
    ["select", "Move", moveIcon],
    ["frame", "Frame", frameIcon],
    ["rectangle", "Rect", rectIcon],
    ["text", "Text", textIcon],
  ];
  for (const [t, label, mk] of tools) {
    const btn = iconButton(mk(), label, () => setTool(t));
    btn.dataset.tool = t;
    toolbar.append(btn);
  }
  toolbar.append(divider());
  toolbar.append(iconButton(compIcon(), "Comp", makeComponent));
  toolbar.append(iconButton(instIcon(), "Inst", placeInstance));
  toolbar.append(iconButton(delIcon(), "Del", deleteSelected));
  toolbar.append(divider());
  const docsBtn = iconButton(docsIcon(), "Docs", toggleDocs);
  docsBtn.dataset.toggle = "docs";
  docsBtn.classList.toggle("active", showDocs);
  toolbar.append(docsBtn);
  const infraBtn = iconButton(infraIcon(), "Infra", toggleInfra);
  infraBtn.dataset.toggle = "infra";
  infraBtn.classList.toggle("active", showInfra);
  toolbar.append(infraBtn);
  const umlBtn = iconButton(umlIcon(), "UML", openUml);
  umlBtn.dataset.toggle = "uml";
  toolbar.append(umlBtn);
  const tlBtn = iconButton(historyIcon(), "History", toggleTimeline);
  tlBtn.dataset.toggle = "timeline";
  tlBtn.classList.toggle("active", showTimeline);
  toolbar.append(tlBtn);
  // Membership management only applies to the live (auth-gated) source.
  if (source.addMember) {
    toolbar.append(divider());
    toolbar.append(iconButton(memberIcon(), "+Member", addMember));
  }
  refreshToolbar();
}

/**
 * Enrol another collaborator by uid. They get their uid from the access banner
 * shown when they're locked out of the project; pasting it here grants access.
 */
async function addMember(): Promise<void> {
  if (!source.addMember) return;
  const uid = window
    .prompt(
      "Add a collaborator by their user id (uid).\nThey see it in the banner when they're locked out of this project:",
    )
    ?.trim();
  if (!uid) return;
  try {
    await source.addMember(uid);
    notify(`Added ${uid} to this project.`);
  } catch (err) {
    notify(`Couldn't add member: ${(err as Error).message}`);
  }
}

/** Show or hide the project's infrastructure diagram overlay. */
function toggleInfra(): void {
  showInfra = !showInfra;
  toolbar
    .querySelector('[data-toggle="infra"]')
    ?.classList.toggle("active", showInfra);
  if (!showInfra) selectedFlowId = null; // hiding the overlay clears the highlight
  render();
}

/** Show or hide the project endpoint-timeline panel (git-graph + digest). */
function toggleTimeline(): void {
  showTimeline = !showTimeline;
  toolbar
    .querySelector('[data-toggle="timeline"]')
    ?.classList.toggle("active", showTimeline);
  renderTimelinePanel();
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
  renderTimelinePanel();
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

/** Ids of every node a flow's steps touch (skipping hops to missing nodes). */
function flowNodeIds(flow: InfraFlow): Set<string> {
  const ids = new Set<string>();
  for (const s of flow.steps) {
    if (infraNodes.has(s.from)) ids.add(s.from);
    if (infraNodes.has(s.to)) ids.add(s.to);
  }
  return ids;
}

/** Draw the infra diagram: edges between node centres, then the node boxes. */
function drawInfraLayer(): SVGGElement {
  const g = svgEl("g", { class: "infra-layer" }) as SVGGElement;
  const flow = selectedFlowId ? infraFlows.get(selectedFlowId) : undefined;
  const active = flow ? flowNodeIds(flow) : null;

  // Edges first so the node boxes paint on top of the connectors. With a flow
  // selected, edges not on the flow's nodes recede so the narration reads clearly.
  for (const edge of infraEdges) {
    const a = infraNodes.get(edge.from);
    const b = infraNodes.get(edge.to);
    if (!a || !b) continue; // skip dangling edges
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const dim = active && !(active.has(edge.from) && active.has(edge.to));
    const l = line(ax, ay, bx, by);
    l.setAttribute("class", dim ? "infra-edge infra-edge-dim" : "infra-edge");
    g.append(l);
    // While a flow is selected the numbered step arrows carry the labels, so
    // suppress the base edge labels to avoid them colliding with the flow text.
    if (edge.label && !active) {
      const t = text(edge.label, (ax + bx) / 2, (ay + by) / 2 - 2, "infra-edge-label");
      g.append(t);
    }
  }

  // Group containers first so nodes nested in them paint on top.
  const ordered = [...infraNodes.values()].sort(
    (p, q) => q.width * q.height - p.width * p.height,
  );
  for (const n of ordered) {
    const node = drawInfraNode(n);
    if (active) {
      node.classList.add(active.has(n.id) ? "infra-node-active" : "infra-node-dim");
    }
    g.append(node);
  }

  // The flow's numbered, directed arrows paint on top of everything.
  if (flow) g.append(drawFlowArrows(flow));
  return g;
}

/**
 * The on-canvas renderer of a flow: walk its steps and draw a numbered directed
 * arrow from each `from` node to each `to` node, clipped to the box borders so
 * the arrowhead lands cleanly on the target. Mirrors flowToMermaid — same steps,
 * same skip-dangling rule — just rendered as geometry instead of a sequence diagram.
 */
function drawFlowArrows(flow: InfraFlow): SVGGElement {
  const g = svgEl("g", { class: "flow-arrows" }) as SVGGElement;
  flow.steps.forEach((step, i) => {
    const a = infraNodes.get(step.from);
    const b = infraNodes.get(step.to);
    if (!a || !b) return; // dangling hop — skip, mirroring the Mermaid export
    const acx = a.x + a.width / 2;
    const acy = a.y + a.height / 2;
    const bcx = b.x + b.width / 2;
    const bcy = b.y + b.height / 2;
    const start = borderPoint(a, bcx, bcy);
    const end = borderPoint(b, acx, acy);
    const reply = step.kind === "reply";
    const cls = ["flow-arrow", step.kind === "async" ? "flow-arrow-async" : "", reply ? "flow-arrow-reply" : ""]
      .filter(Boolean)
      .join(" ");
    const l = line(start.x, start.y, end.x, end.y);
    l.setAttribute("class", cls);
    g.append(l);
    g.append(arrowHead(start.x, start.y, end.x, end.y, reply));

    // Numbered badge at the arrow midpoint so the step order reads at a glance.
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const bg = svgEl("circle", {
      cx: String(mx),
      cy: String(my),
      r: "9",
      class: "flow-step-num-bg",
    });
    g.append(bg, text(String(i + 1), mx, my + 4, "flow-step-num"));
    if (step.label) g.append(text(step.label, mx + 14, my + 4, "flow-step-label"));
  });
  return g;
}

/** The point on a node's border along the ray from its centre toward (tx, ty). */
function borderPoint(
  n: InfraNode,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? n.width / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? n.height / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** A small filled triangle at (x2,y2) pointing along the (x1,y1)->(x2,y2) line. */
function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  reply: boolean,
): SVGElement {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const size = 9;
  const spread = 0.4;
  const p1 = `${x2},${y2}`;
  const p2 = `${x2 - size * Math.cos(ang - spread)},${y2 - size * Math.sin(ang - spread)}`;
  const p3 = `${x2 - size * Math.cos(ang + spread)},${y2 - size * Math.sin(ang + spread)}`;
  return svgEl("polygon", {
    points: `${p1} ${p2} ${p3}`,
    class: reply ? "flow-arrowhead flow-arrowhead-reply" : "flow-arrowhead",
  });
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
// Project endpoint timeline (git-graph + catch-up digest)
// ========================================================================
function renderTimelinePanel(): void {
  historyEl.hidden = !showTimeline;
  if (!showTimeline) return;

  const byElement: Record<string, VersionEntry[]> = {};
  for (const [id, tl] of timelines) if (tl.length) byElement[id] = tl;
  // Current binding labels, for live endpoints whose old entries predate the
  // per-entry endpoint snapshots.
  const current: Record<string, CurrentLabel> = {};
  for (const el of elements.values()) {
    const b = el.apiBinding;
    if (!b) continue;
    current[el.id] = {
      title: b.title,
      ...(b.method ? { method: b.method } : {}),
      ...(b.endpoint ? { path: b.endpoint } : {}),
    };
  }
  renderTimelineView(historyEl, byElement, current, {
    onSelect: (id) => {
      if (elements.has(id)) select(id);
    },
    onClose: toggleTimeline,
  });
}

// ========================================================================
// Infrastructure UML (rendered Mermaid diagrams)
// ========================================================================

/** Open the rendered UML view (defaults to the architecture component diagram). */
function openUml(): void {
  umlOpen = true;
  toolbar.querySelector('[data-toggle="uml"]')?.classList.add("active");
  void renderUmlPanel();
}

/** Copy Mermaid text to the clipboard with a small confirmation. */
function copyMermaid(text: string): void {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => notify("UML diagram copied to clipboard (Mermaid)."))
    .catch(() => notify("Couldn't copy — clipboard unavailable."));
}

/**
 * Render the real UML on its own surface. A dropdown chooses what to show:
 * "Architecture" → a UML component diagram of the whole graph; a flow → that
 * flow's UML sequence diagram. Same `infraToComponentMermaid` / `flowToMermaid`
 * the Copy action emits, rendered to SVG via (lazily loaded) Mermaid. The
 * backdrop hides the canvas so the diagram reads on its own — no overlay beneath.
 */
async function renderUmlPanel(): Promise<void> {
  umlPanelEl.hidden = !umlOpen;
  if (!umlOpen) {
    umlPanelEl.replaceChildren();
    return;
  }

  // Drop a stale selection so the dropdown + render stay consistent.
  if (selectedFlowId && !infraFlows.has(selectedFlowId)) selectedFlowId = null;
  const flow = selectedFlowId ? infraFlows.get(selectedFlowId) : undefined;
  const source = flow
    ? flowToMermaid(flow, infraNodes)
    : infraToComponentMermaid([...infraNodes.values()], infraEdges);

  // Backdrop: clicking outside the card closes the view.
  umlPanelEl.replaceChildren();
  umlPanelEl.onclick = (e) => {
    if (e.target === umlPanelEl) closeUml();
  };

  const card = document.createElement("div");
  card.className = "uml-card";

  // Header: a "UML" tag, the what-to-render dropdown, copy + close.
  const head = document.createElement("div");
  head.className = "uml-head";
  head.append(hEl("span", "UML", "uml-kind"));

  const select = document.createElement("select");
  select.className = "uml-select";
  const arch = document.createElement("option");
  arch.value = "";
  arch.textContent = "Architecture — component diagram";
  if (!flow) arch.selected = true;
  select.append(arch);
  for (const f of infraFlows.values()) {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = `${f.name} — sequence diagram`;
    if (f.id === selectedFlowId) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => {
    selectedFlowId = select.value || null;
    void renderUmlPanel();
  });
  head.append(select);

  const headActions = document.createElement("div");
  headActions.className = "uml-head-actions";
  const copyBtn = document.createElement("button");
  copyBtn.className = "uml-copy";
  copyBtn.title = "Copy as Mermaid text";
  copyBtn.textContent = "⧉";
  copyBtn.addEventListener("click", () => copyMermaid(source));
  const close = document.createElement("button");
  close.className = "uml-close";
  close.title = "Close";
  close.textContent = "✕";
  close.addEventListener("click", closeUml);
  headActions.append(copyBtn, close);
  head.append(headActions);
  card.append(head);

  if (flow?.description) card.append(hEl("p", flow.description, "uml-desc"));

  const body = document.createElement("div");
  body.className = "uml-body";
  card.append(body);
  umlPanelEl.append(card);

  body.append(hEl("p", "Rendering…", "uml-empty"));
  const token = ++umlSeq; // also the Mermaid render id; guards against races
  try {
    const mermaid = await getMermaid();
    const { svg } = await mermaid.render(`uml_${token}`, source);
    if (!umlOpen || token !== umlSeq) return; // superseded by a newer render/close
    body.innerHTML = svg;
  } catch (err) {
    body.innerHTML = "";
    body.append(hEl("pre", `Couldn't render UML:\n${(err as Error).message}`, "uml-error"));
  }
}

/** Close the rendered UML view. */
function closeUml(): void {
  umlOpen = false;
  umlPanelEl.hidden = true;
  umlPanelEl.replaceChildren();
  toolbar.querySelector('[data-toggle="uml"]')?.classList.remove("active");
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
/** A plain HTML element with text content and an optional class. */
function hEl(tag: string, content: string, cls = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (cls) node.className = cls;
  return node;
}
function notify(msg: string): void {
  panel.querySelector(".empty")?.remove();
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = msg;
  panel.prepend(p);
}

/** A toolbar button whose glyph is an inline line-SVG icon over a text label. */
function iconButton(
  icon: SVGElement,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.title = label;
  b.append(icon);
  const span = document.createElement("span");
  span.textContent = label;
  b.append(span);
  b.addEventListener("click", onClick);
  return b;
}

/** Build a 24×24 stroked line icon from a list of <path>/<rect>/… children. */
function lineIcon(children: SVGElement[]): SVGElement {
  const svg = svgEl("svg", {
    class: "tb-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  for (const c of children) svg.append(c);
  return svg;
}
// Icon primitives + factories are function declarations (not const) so they are
// hoisted and safe to call from buildToolbar(), which runs during module init.
function path(d: string): SVGElement {
  return svgEl("path", { d });
}
function poly(points: string): SVGElement {
  return svgEl("polyline", { points });
}
function circle(cx: number, cy: number, r: number): SVGElement {
  return svgEl("circle", { cx: `${cx}`, cy: `${cy}`, r: `${r}` });
}
function rect(x: number, y: number, w: number, h: number, r = 2): SVGElement {
  return svgEl("rect", { x: `${x}`, y: `${y}`, width: `${w}`, height: `${h}`, rx: `${r}` });
}

// Move/select: four-way arrows.
function moveIcon(): SVGElement {
  return lineIcon([
    poly("5 9 2 12 5 15"),
    poly("9 5 12 2 15 5"),
    poly("15 19 12 22 9 19"),
    poly("19 9 22 12 19 15"),
    line(2, 12, 22, 12),
    line(12, 2, 12, 22),
  ]);
}
// Frame: a crop/frame grid.
function frameIcon(): SVGElement {
  return lineIcon([line(2, 6, 22, 6), line(2, 18, 22, 18), line(6, 2, 6, 22), line(18, 2, 18, 22)]);
}
// Rectangle.
function rectIcon(): SVGElement {
  return lineIcon([rect(4, 6, 16, 12, 2)]);
}
// Text: a capital-T type glyph.
function textIcon(): SVGElement {
  return lineIcon([poly("4 7 4 4 20 4 20 7"), line(12, 4, 12, 20), line(9, 20, 15, 20)]);
}
// Component: the Figma-style diamond.
function compIcon(): SVGElement {
  return lineIcon([path("M12 2 22 12 12 22 2 12Z")]);
}
// Instance: an overlapping-copies glyph.
function instIcon(): SVGElement {
  return lineIcon([
    rect(9, 9, 11, 11, 2),
    path("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"),
  ]);
}
// Delete: a trash can.
function delIcon(): SVGElement {
  return lineIcon([
    poly("3 6 5 6 21 6"),
    path("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
    line(10, 11, 10, 17),
    line(14, 11, 14, 17),
  ]);
}
// Add member: a user with a plus.
function memberIcon(): SVGElement {
  return lineIcon([
    path("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
    circle(9, 7, 4),
    line(19, 8, 19, 14),
    line(16, 11, 22, 11),
  ]);
}
// Document with text lines.
function docsIcon(): SVGElement {
  return lineIcon([
    path("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"),
    path("M14 3v5h5"),
    path("M9 13h6"),
    path("M9 17h6"),
  ]);
}
// Sitemap: one node branching to two below.
function infraIcon(): SVGElement {
  return lineIcon([
    svgEl("rect", { x: "9", y: "2", width: "6", height: "6", rx: "1.2" }),
    svgEl("rect", { x: "3", y: "16", width: "6", height: "6", rx: "1.2" }),
    svgEl("rect", { x: "15", y: "16", width: "6", height: "6", rx: "1.2" }),
    path("M12 8v4"),
    path("M6 16v-2.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 13.5V16"),
  ]);
}
// UML: two component boxes joined by a dependency arrow.
function umlIcon(): SVGElement {
  return lineIcon([
    svgEl("rect", { x: "3", y: "4", width: "8", height: "6", rx: "1.2" }),
    svgEl("rect", { x: "13", y: "14", width: "8", height: "6", rx: "1.2" }),
    path("M7 10v3a2 2 0 0 0 2 2h4"),
  ]);
}
// Clock with a counter-clockwise "history" arrow.
function historyIcon(): SVGElement {
  return lineIcon([
    path("M3 3v5h5"),
    path("M3.05 13A9 9 0 1 0 6 5.3L3 8"),
    path("M12 7v5l4 2"),
  ]);
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
