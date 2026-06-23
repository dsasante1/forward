import {
  type ApiBinding,
  computeLanes,
  type CurrentLabel,
  type DesignElement,
  digest,
  type DigestItem,
  flattenTimelines,
  flowToMermaid,
  infraToComponentMermaid,
  type InfraEdge,
  type InfraFlow,
  type InfraNode,
  laneCount,
  type TimelineEvent,
  type VersionAction,
  type VersionEntry,
} from "forward-core";

/**
 * Read-only design viewer that runs inside the VS Code webview.
 *
 * It never talks to Firebase itself — the extension host polls the RTDB and
 * posts the elements in (keeps the auth token out of the webview and lets the
 * CSP stay strict). For every element carrying an `apiBinding` we drop a
 * minimized pin over the design; clicking the pin expands the documentation,
 * with Edit / Delete actions. Undocumented elements get an add button on hover.
 * Add and Edit open an inline form right on the canvas — the developer types the
 * whole binding there and Saves; only the finished binding (or a delete) is sent
 * back to the host to persist. No back-and-forth prompt flow.
 */

interface ElementsMessage {
  type: "elements";
  elements: DesignElement[];
  projectId: string;
}

interface InfraMessage {
  type: "infra";
  nodes: InfraNode[];
  edges: InfraEdge[];
  flows: InfraFlow[];
}

interface TimelineMessage {
  type: "timeline";
  timelines: Record<string, VersionEntry[]>;
}

type HostMessage = ElementsMessage | InfraMessage | TimelineMessage;

const SVG_NS = "http://www.w3.org/2000/svg";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const PAD = 24;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

let openId: string | null = null;
let editId: string | null = null; // element whose inline documentation form is open
let editDraft = ""; // in-progress form text, kept across re-renders so polling can't wipe it
let editCaret: number | null = null; // caret offset to restore after a re-render
let pendingRender = false; // a data update arrived while the form was open; render once it closes
let hoverId: string | null = null; // documented element under the pointer (drives the leader)
let menuOpen = false; // the kebab (⋮) action menu inside the open card
let showDocs = true; // show/hide the doc leader lines on documented elements
let showInfra = false; // show/hide the infrastructure diagram overlay
let showTimeline = false; // show/hide the endpoint-timeline panel
let timelineWindow = "all"; // digest baseline choice, kept across re-renders
let latest: DesignElement[] = [];
let latestProject = "";
let infraNodes: InfraNode[] = [];
let infraEdges: InfraEdge[] = [];
let infraFlows: InfraFlow[] = [];
let selectedFlowId: string | null = null; // flow currently narrated on the overlay
let timelines: Record<string, VersionEntry[]> = {};
let zoom = 1; // multiplier on top of the fit-to-width base scale; 1 = fit.

// Draw order is by descending area (parents behind children) and only changes
// when new data arrives — so it's cached here rather than re-sorted every
// render (zoom/resize/click all re-render without touching the data).
let orderedLatest: DesignElement[] = [];
let orderedInfra: InfraNode[] = [];

// render() is coalesced through requestAnimationFrame: a burst of events
// (wheel/pinch zoom, window resize, rapid clicks) collapses to one rebuild per
// frame instead of one per event.
let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

const root = document.getElementById("app") as HTMLElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLElement;
const flowbar = document.getElementById("flowbar") as HTMLElement;

// The current world container + screen-space transform, stashed by render() so
// the hover handlers can repaint just the leader overlay (no full re-render,
// which would rebuild the node under the cursor and thrash mouseenter/leave).
let worldEl: HTMLElement | null = null;
let view: { px: (n: number) => number; py: (n: number) => number } | null = null;

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as HostMessage;
  if (msg?.type === "elements") {
    latest = msg.elements;
    latestProject = msg.projectId;
    // Bigger elements first so frames sit behind their children.
    orderedLatest = [...latest].sort((a, b) => b.width * b.height - a.width * a.height);
    requestDataRender();
    renderTimeline(); // current-binding labels may have changed
  } else if (msg?.type === "infra") {
    infraNodes = msg.nodes;
    infraEdges = msg.edges;
    infraFlows = msg.flows ?? [];
    // Drop a stale selection if its flow was deleted upstream.
    if (selectedFlowId && !infraFlows.some((f) => f.id === selectedFlowId)) {
      selectedFlowId = null;
    }
    // Group containers first so they sit behind the nodes nested in them.
    orderedInfra = [...infraNodes].sort((a, b) => b.width * b.height - a.width * a.height);
    requestDataRender();
    renderFlowPanel();
  } else if (msg?.type === "timeline") {
    timelines = msg.timelines;
    renderTimeline();
  }
});

// A polled data update wants to redraw. While the inline form is open, hold off —
// a rebuild would tear out the textarea mid-edit — and flush once the form closes.
function requestDataRender(): void {
  if (editId) {
    pendingRender = true;
    return;
  }
  scheduleRender();
}

// Close the inline form, flushing any data update that arrived while it was open.
function closeForm(): void {
  editId = null;
  editDraft = "";
  editCaret = null;
  pendingRender = false;
  scheduleRender();
}

// Click anywhere that isn't a pin/card closes the open card — unless that
// "click" was actually the tail end of a pan drag.
document.addEventListener("click", (e) => {
  if (panMoved) {
    panMoved = false;
    return;
  }
  const t = e.target as HTMLElement;
  if (!t.closest(".doc-leader") && !t.closest(".doccard") && !t.closest(".el.documented")) {
    // Dismiss the open card/menu by removing just those nodes — no need to tear
    // down and rebuild the whole canvas to close a popover.
    openId = null;
    menuOpen = false;
    // An open inline form needs a full rebuild to clear; cards/leaders don't.
    if (editId) {
      closeForm();
      return;
    }
    worldEl?.querySelector(".doccard")?.remove();
    paintLeader(); // drops the leader unless the pointer is still on an element
    return;
  }
  // A click inside the card but off the kebab/menu just dismisses the menu.
  if (menuOpen && !t.closest(".kebab") && !t.closest(".menu")) {
    menuOpen = false;
    worldEl?.querySelector(".menu")?.remove();
    worldEl?.querySelector(".kebab")?.setAttribute("aria-expanded", "false");
  }
});

// --- pan by drag ----------------------------------------------------------
// Drag the empty canvas to scroll the viewport. Interactive bits (pins, the
// add button, an open card, the toolbar) keep their own click behaviour.
let panning = false;
let panMoved = false;
let panStartX = 0;
let panStartY = 0;
let panScrollX = 0;
let panScrollY = 0;

root.addEventListener("mousedown", (e: MouseEvent) => {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest(".doc-leader, .addbtn, .doccard, .toolbar")) return;
  panning = true;
  panMoved = false;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panScrollX = window.scrollX;
  panScrollY = window.scrollY;
  document.body.classList.add("panning");
  e.preventDefault();
});

window.addEventListener("mousemove", (e: MouseEvent) => {
  if (!panning) return;
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMoved = true;
  window.scrollTo(panScrollX - dx, panScrollY - dy);
});

const endPan = () => {
  if (!panning) return;
  panning = false;
  document.body.classList.remove("panning");
};
window.addEventListener("mouseup", endPan);
window.addEventListener("mouseleave", endPan);

// --- zoom controls --------------------------------------------------------
(document.getElementById("zoomIn") as HTMLElement).addEventListener("click", () =>
  setZoom(zoom * ZOOM_STEP),
);
(document.getElementById("zoomOut") as HTMLElement).addEventListener("click", () =>
  setZoom(zoom / ZOOM_STEP),
);
(document.getElementById("zoomFit") as HTMLElement).addEventListener("click", () =>
  setZoom(1),
);

// --- show/hide API docs toggle -------------------------------------------
const docsToggle = document.getElementById("toggleDocs") as HTMLElement | null;
docsToggle?.classList.toggle("active", showDocs);
docsToggle?.addEventListener("click", () => {
  showDocs = !showDocs;
  docsToggle.classList.toggle("active", showDocs);
  docsToggle.setAttribute("aria-pressed", String(showDocs));
  if (!showDocs) {
    openId = null; // hide any open card along with the leaders
    hoverId = null;
    menuOpen = false;
  }
  scheduleRender();
});

// --- show/hide infrastructure overlay toggle -----------------------------
const infraToggle = document.getElementById("toggleInfra") as HTMLElement | null;
infraToggle?.classList.toggle("active", showInfra);
infraToggle?.addEventListener("click", () => {
  showInfra = !showInfra;
  infraToggle.classList.toggle("active", showInfra);
  infraToggle.setAttribute("aria-pressed", String(showInfra));
  if (!showInfra) selectedFlowId = null; // hiding the overlay clears the narration
  scheduleRender();
  renderFlowPanel();
});

// --- show/hide endpoint-timeline panel toggle ----------------------------
const timelineToggle = document.getElementById("toggleTimeline") as HTMLElement | null;
timelineToggle?.addEventListener("click", () => {
  showTimeline = !showTimeline;
  timelineToggle.classList.toggle("active", showTimeline);
  timelineToggle.setAttribute("aria-pressed", String(showTimeline));
  renderTimeline();
});
window.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(e.deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP);
  },
  { passive: false },
);
window.addEventListener("resize", scheduleRender);

function setZoom(next: number): void {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  scheduleRender();
}

// Tell the host we're ready to receive the first snapshot.
vscode.postMessage({ type: "ready" });

function render(): void {
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  root.replaceChildren();

  // The infra layer can stand alone, so it contributes to the world bounds (and
  // keeps the canvas non-empty) whenever it's toggled on.
  const drawInfra = showInfra && infraNodes.length > 0;
  if (!latest.length && !drawInfra) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `No design elements in project "${latestProject}". Ask the designer to draw something on the canvas first.`;
    root.append(empty);
    return;
  }

  const bbox = bounds([...latest, ...(drawInfra ? infraNodes : [])]);
  const avail = (root.clientWidth || 800) - PAD * 2;
  const scale = Math.min(1, avail / Math.max(1, bbox.w)) * zoom;
  const px = (x: number) => (x - bbox.minX) * scale + PAD;
  const py = (y: number) => (y - bbox.minY) * scale + PAD;

  const world = document.createElement("div");
  world.className = "world";
  world.style.width = `${bbox.w * scale + PAD * 2}px`;
  world.style.height = `${bbox.h * scale + PAD * 2}px`;
  worldEl = world;
  view = { px, py };

  // Draw order is cached (orderedLatest); dim the design layer while the infra
  // overlay is on, so the diagram reads on top.
  if (drawInfra) world.style.setProperty("--design-dim", "0.35");

  for (const el of orderedLatest) {
    const node = elementNode(el, px(el.x), py(el.y), el.width * scale, el.height * scale);
    if (drawInfra) node.style.opacity = "var(--design-dim)";
    world.append(node);
  }

  if (drawInfra) world.append(infraLayer(px, py, scale, bbox));

  root.append(world);
  paintLeader(); // draw the leader for the focused (hovered/open) element, if any
}

/**
 * The focus-mode doc leader: the hovered (or open) documented element draws one
 * leader line out to a floating label, anime.js callout style — anchor on the
 * right edge → short stub → rise → label. Repainted on hover without a full
 * render so the node under the cursor isn't rebuilt mid-hover. The label is
 * clickable and opens the element's doc card.
 */
function paintLeader(): void {
  if (!worldEl || !view) return;
  worldEl.querySelector(".doc-leader-layer")?.remove();
  const focusId = hoverId ?? openId;
  if (!focusId || !showDocs) return;
  const el = latest.find((e) => e.id === focusId);
  if (!el?.apiBinding) return;
  worldEl.append(docLeaderLayer(el, el.apiBinding, view.px, view.py));
}

function setHover(id: string | null): void {
  if (hoverId === id) return;
  hoverId = id;
  paintLeader();
}

function docLeaderLayer(
  el: DesignElement,
  b: ApiBinding,
  px: (x: number) => number,
  py: (y: number) => number,
): SVGSVGElement {
  const primary =
    b.method || b.endpoint
      ? [b.method, b.endpoint].filter(Boolean).join(" ")
      : b.title;
  const secondary = b.method || b.endpoint ? b.title : (b.language ?? "");

  // Anchor at the element's right-edge midpoint, elbow out and up to lift the
  // label clear. Offsets are fixed screen pixels so the label stays legible at
  // any zoom (the anchor itself tracks the scaled element via px/py).
  const ax = px(el.x + el.width);
  const ay = py(el.y + el.height / 2);
  const stub = ax + 28;
  const labelY = ay - 24;
  const labelX = stub + 34;

  const hasSub = secondary.length > 0;
  const boxH = hasSub ? 34 : 22;
  const w = Math.max(primary.length * 7, secondary.length * 6) + 16;

  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("class", "doc-leader-layer");

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "doc-leader");
  g.dataset.id = el.id;
  g.addEventListener("click", (e) => {
    e.stopPropagation();
    openId = el.id;
    menuOpen = false;
    scheduleRender();
  });

  const path = document.createElementNS(SVG_NS, "polyline");
  path.setAttribute(
    "points",
    `${ax},${ay} ${stub},${ay} ${stub},${labelY} ${labelX - 6},${labelY}`,
  );
  path.setAttribute("class", "doc-leader-line");
  g.append(path);

  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", String(ax));
  dot.setAttribute("cy", String(ay));
  dot.setAttribute("r", "3");
  dot.setAttribute("class", "doc-leader-dot");
  g.append(dot);

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(labelX - 6));
  bg.setAttribute("y", String(labelY - boxH / 2));
  bg.setAttribute("width", String(w));
  bg.setAttribute("height", String(boxH));
  bg.setAttribute("rx", "5");
  bg.setAttribute("class", "doc-leader-bg");
  g.append(bg);

  g.append(svgText(primary, labelX, hasSub ? labelY - 2 : labelY + 4, "doc-leader-label"));
  if (hasSub) g.append(svgText(secondary, labelX, labelY + 12, "doc-leader-sub"));

  svg.append(g);
  return svg;
}

function svgText(
  s: string,
  x: number,
  y: number,
  cls: string,
): SVGTextElement {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("class", cls);
  t.textContent = s;
  return t;
}

/** The infrastructure overlay: an SVG edges layer behind absolutely-placed nodes. */
function infraLayer(
  px: (x: number) => number,
  py: (y: number) => number,
  scale: number,
  bbox: { w: number; h: number },
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const byId = new Map(infraNodes.map((n) => [n.id, n]));
  const flow = selectedFlowId ? infraFlows.find((f) => f.id === selectedFlowId) : undefined;
  const active = flow ? flowNodeIds(flow, byId) : null;

  // Edges first (drawn under the node boxes), connecting node centres. With a
  // flow selected, edges off the flow's nodes recede so the narration reads.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "infraEdges";
  svg.setAttribute("width", String(bbox.w * scale + PAD * 2));
  svg.setAttribute("height", String(bbox.h * scale + PAD * 2));
  for (const edge of infraEdges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue; // skip dangling edges
    const ax = px(a.x + a.width / 2);
    const ay = py(a.y + a.height / 2);
    const bx = px(b.x + b.width / 2);
    const by = py(b.y + b.height / 2);
    const dim = active && !(active.has(edge.from) && active.has(edge.to));
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(ax));
    line.setAttribute("y1", String(ay));
    line.setAttribute("x2", String(bx));
    line.setAttribute("y2", String(by));
    if (dim) line.setAttribute("class", "flow-edge-dim");
    svg.append(line);
    if (edge.label) {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String((ax + bx) / 2));
      t.setAttribute("y", String((ay + by) / 2));
      t.setAttribute("class", dim ? "edgelabel flow-edge-dim" : "edgelabel");
      t.textContent = edge.label;
      svg.append(t);
    }
  }

  // The selected flow's numbered, directed arrows paint on top of the edges.
  if (flow) drawFlowArrows(svg, flow, byId, px, py, scale);
  frag.append(svg);

  // Draw order is cached (orderedInfra): group containers sit behind their nodes.
  for (const n of orderedInfra) {
    const node = infraNode(n, px(n.x), py(n.y), n.width * scale, n.height * scale);
    if (active) node.classList.add(active.has(n.id) ? "flow-active" : "flow-dim");
    frag.append(node);
  }
  return frag;
}

/** Ids of every node a flow's steps touch (skipping hops to missing nodes). */
function flowNodeIds(flow: InfraFlow, byId: Map<string, InfraNode>): Set<string> {
  const ids = new Set<string>();
  for (const s of flow.steps) {
    if (byId.has(s.from)) ids.add(s.from);
    if (byId.has(s.to)) ids.add(s.to);
  }
  return ids;
}

/**
 * The on-canvas renderer of a flow (read-only mirror of the web canvas): one
 * numbered directed arrow per step, from the `from` node's border to the `to`
 * node's border, with an arrowhead and a numbered badge at the midpoint. Walks
 * the same steps flowToMermaid serialises, with the same skip-dangling rule.
 */
function drawFlowArrows(
  svg: SVGElement,
  flow: InfraFlow,
  byId: Map<string, InfraNode>,
  px: (x: number) => number,
  py: (y: number) => number,
  scale: number,
): void {
  flow.steps.forEach((step, i) => {
    const a = byId.get(step.from);
    const b = byId.get(step.to);
    if (!a || !b) return; // dangling hop — skip, mirroring the Mermaid export
    // Work in screen space so the box clip + arrowhead match the drawn boxes.
    const ar = { x: px(a.x), y: py(a.y), width: a.width * scale, height: a.height * scale };
    const br = { x: px(b.x), y: py(b.y), width: b.width * scale, height: b.height * scale };
    const acx = ar.x + ar.width / 2;
    const acy = ar.y + ar.height / 2;
    const bcx = br.x + br.width / 2;
    const bcy = br.y + br.height / 2;
    const start = borderPoint(ar, bcx, bcy);
    const end = borderPoint(br, acx, acy);
    const reply = step.kind === "reply";
    const cls = ["flow-arrow", step.kind === "async" ? "flow-arrow-async" : "", reply ? "flow-arrow-reply" : ""]
      .filter(Boolean)
      .join(" ");
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(end.x));
    line.setAttribute("y2", String(end.y));
    line.setAttribute("class", cls);
    svg.append(line);
    svg.append(arrowHead(start.x, start.y, end.x, end.y, reply));

    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const bg = document.createElementNS(SVG_NS, "circle");
    bg.setAttribute("cx", String(mx));
    bg.setAttribute("cy", String(my));
    bg.setAttribute("r", "9");
    bg.setAttribute("class", "flow-step-num-bg");
    svg.append(bg, svgText(String(i + 1), mx, my + 4, "flow-step-num"));
    if (step.label) svg.append(svgText(step.label, mx + 14, my + 4, "flow-step-label"));
  });
}

/** The point on a rect's border along the ray from its centre toward (tx, ty). */
function borderPoint(
  r: { x: number; y: number; width: number; height: number },
  tx: number,
  ty: number,
): { x: number; y: number } {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? r.width / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? r.height / 2 / Math.abs(dy) : Infinity;
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
): SVGPolygonElement {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const size = 9;
  const spread = 0.4;
  const p = document.createElementNS(SVG_NS, "polygon");
  p.setAttribute(
    "points",
    `${x2},${y2} ${x2 - size * Math.cos(ang - spread)},${y2 - size * Math.sin(ang - spread)} ` +
      `${x2 - size * Math.cos(ang + spread)},${y2 - size * Math.sin(ang + spread)}`,
  );
  p.setAttribute("class", reply ? "flow-arrowhead flow-arrowhead-reply" : "flow-arrowhead");
  return p;
}

// ===========================================================================
// Infrastructure flow panel (read-only mirror of the web canvas)
// ===========================================================================
const STEP_ARROW: Record<InfraFlow["steps"][number]["kind"], string> = {
  sync: "→",
  async: "⇢",
  reply: "⤺",
};

/**
 * The flow panel (overlay, top-left): a selector to pick which flow narrates the
 * overlay, plus the selected flow's steps as a numbered narrative and a
 * "Copy sequence diagram" action (the Mermaid export). Present only while the
 * infra overlay is on. Read-only — authoring happens on the canvas / via MCP.
 */
function renderFlowPanel(): void {
  flowbar.hidden = !showInfra;
  if (!showInfra) return;
  flowbar.replaceChildren();

  flowbar.append(rowEl("h3", "Infrastructure (UML)"));

  const byId = new Map(infraNodes.map((n) => [n.id, n]));

  // Structural view: a UML component diagram of the whole graph — available
  // whenever any node exists, independent of whether a flow is selected.
  if (infraNodes.length) {
    const archActions = document.createElement("div");
    archActions.className = "flow-actions";
    const archBtn = document.createElement("button");
    archBtn.className = "flow-btn";
    archBtn.textContent = "Copy component diagram";
    archBtn.title = "Copy the architecture as a UML component diagram (Mermaid)";
    archBtn.addEventListener("click", () => {
      void navigator.clipboard?.writeText(infraToComponentMermaid(infraNodes, infraEdges));
    });
    archActions.append(archBtn);
    flowbar.append(archActions);
  }

  flowbar.append(rowEl("h3", "Flows (sequence diagrams)"));

  if (!infraFlows.length) {
    flowbar.append(
      rowEl("p", "No flows yet — author one via the MCP tools (write_flow).", "tl-empty"),
    );
    return;
  }
  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— Select a flow —";
  select.append(none);
  for (const flow of infraFlows) {
    const o = document.createElement("option");
    o.value = flow.id;
    o.textContent = flow.name;
    if (flow.id === selectedFlowId) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => {
    selectedFlowId = select.value || null;
    scheduleRender();
    renderFlowPanel();
  });
  flowbar.append(select);

  const flow = selectedFlowId ? infraFlows.find((f) => f.id === selectedFlowId) : undefined;
  if (!flow) return;

  if (flow.description) flowbar.append(rowEl("p", flow.description, "flow-desc"));

  const ul = document.createElement("ul");
  ul.className = "flow-steps";
  flow.steps.forEach((step, i) => {
    const li = document.createElement("li");
    li.append(rowEl("span", String(i + 1), "flow-step-n"));
    const body = document.createElement("div");

    const route = document.createElement("div");
    route.className = "flow-step-route";
    route.append(document.createTextNode(byId.get(step.from)?.label ?? step.from));
    const tok = document.createElement("span");
    tok.className = "flow-arrow-tok";
    tok.textContent = STEP_ARROW[step.kind];
    route.append(tok, document.createTextNode(byId.get(step.to)?.label ?? step.to));
    body.append(route);

    if (step.label) body.append(rowEl("div", step.label, "flow-step-text"));

    // Phase 4: link the hop to the design element whose apiBinding drives it.
    if (step.endpointId) {
      const el = latest.find((e) => e.id === step.endpointId);
      if (el) {
        const b = el.apiBinding;
        const label =
          b?.method || b?.endpoint
            ? [b?.method, b?.endpoint].filter(Boolean).join(" ")
            : (b?.title ?? (el.name || el.id));
        const link = rowEl("span", `↳ ${label}`, "flow-step-endpoint");
        link.addEventListener("click", () => revealElement(el.id));
        body.append(link);
      }
    }

    li.append(body);
    ul.append(li);
  });
  flowbar.append(ul);

  const actions = document.createElement("div");
  actions.className = "flow-actions";
  const copy = document.createElement("button");
  copy.className = "flow-btn";
  copy.textContent = "Copy sequence diagram";
  copy.title = "Copy this flow as a UML sequence diagram (Mermaid)";
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(flowToMermaid(flow, byId));
  });
  actions.append(copy);
  flowbar.append(actions);
}

function infraNode(
  n: InfraNode,
  left: number,
  top: number,
  width: number,
  height: number,
): HTMLElement {
  const box = document.createElement("div");
  box.className = `infranode k-${n.kind}`;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  if (n.description) box.title = n.description;

  box.append(rowEl("div", n.kind, "ikind"), rowEl("div", n.label, "ilabel"));
  if (n.tech) box.append(rowEl("div", n.tech, "itech"));
  return box;
}

function elementNode(
  el: DesignElement,
  px: number,
  py: number,
  pw: number,
  ph: number,
): HTMLElement {
  const node = document.createElement("div");
  node.className = `el el-${el.type}`;
  node.dataset.id = el.id; // lets the timeline panel scroll an element into view
  node.style.left = `${px}px`;
  node.style.top = `${py}px`;
  node.style.width = `${pw}px`;
  node.style.height = `${ph}px`;
  // Rotation is about the element's center (CSS default transform-origin),
  // matching the web canvas.
  if (el.rotation) node.style.transform = `rotate(${el.rotation}deg)`;

  const s = el.style ?? {};
  if (el.type === "text") {
    node.textContent = el.text ?? el.name ?? "Text";
    if (s.color) node.style.color = s.color;
    if (s.fontSize) node.style.fontSize = `${s.fontSize}px`;
    if (s.fontWeight) node.style.fontWeight = String(s.fontWeight);
    if (s.fontFamily) node.style.fontFamily = s.fontFamily;
  } else {
    if (s.fill) node.style.background = s.fill;
    if (s.stroke) node.style.borderColor = s.stroke;
    if (s.radius != null) node.style.borderRadius = `${s.radius}px`;
    // Element name label, drawn above the box (matches the web canvas).
    const name = document.createElement("span");
    name.className = "el-name";
    name.textContent = el.name || el.id;
    node.append(name);
    if (el.text) {
      const label = document.createElement("span");
      label.className = "el-text";
      label.textContent = el.text;
      if (s.color) label.style.color = s.color;
      node.append(label);
    }
  }

  // Being documented: show the inline editor anchored to the element, in place
  // of the pin/card. Works for both a fresh element and an edit of an existing
  // binding (which pre-fills the form).
  if (editId === el.id) {
    node.classList.add("documented");
    node.append(docForm(el.id));
    return node;
  }

  if (el.apiBinding) {
    // Documented: no corner pin. Hovering draws a leader line out to a label
    // (see docLeaderLayer); clicking the element opens its doc card, anchored to
    // the element itself.
    if (showDocs) {
      node.classList.add("documented");
      node.addEventListener("mouseenter", () => setHover(el.id));
      node.addEventListener("mouseleave", () => setHover(null));
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        openId = openId === el.id ? null : el.id;
        menuOpen = false; // open/switch cards with the menu collapsed
        scheduleRender();
      });
      if (openId === el.id) node.append(docCard(el.id, el.apiBinding));
    }
  } else {
    node.append(addBtn(el.id)); // undocumented -> hover "+ Doc"
  }
  return node;
}

function addBtn(id: string): HTMLElement {
  const button = document.createElement("button");
  button.className = "addbtn";
  button.title = "Document this element";
  button.textContent = "+ Doc";
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    // Open the inline form right here — no host-side question/answer prompts.
    editId = id;
    editDraft = ""; // fresh element: start empty
    editCaret = null;
    openId = null;
    menuOpen = false;
    scheduleRender();
  });
  return button;
}

/**
 * Inline documentation editor: one free-form text box, nothing else. The author
 * writes whatever they want — no title/method/endpoint sections to fill in. The
 * raw text is posted to the host on Save; the host turns it into a binding (first
 * line becomes the label).
 *
 * The in-progress text lives in the module-level `editDraft` (not just the DOM)
 * so a re-render — the canvas rebuilds itself on every polled snapshot — can't
 * wipe what's been typed. The textarea is rehydrated from `editDraft` and the
 * caret restored from `editCaret` on each render.
 */
function docForm(id: string): HTMLElement {
  const form = document.createElement("div");
  form.className = "doccard docform";
  form.addEventListener("click", (e) => e.stopPropagation());

  const error = document.createElement("div");
  error.className = "docform-error";

  const text = document.createElement("textarea");
  text.className = "docform-input docform-text";
  text.placeholder =
    "Document this element — anything goes (Markdown supported).\nThe first line is used as its label.";
  text.value = editDraft;
  text.addEventListener("input", () => {
    editDraft = text.value;
    editCaret = text.selectionStart;
    text.classList.remove("invalid");
    error.textContent = "";
  });
  form.append(text, error);

  const actions = document.createElement("div");
  actions.className = "docform-actions";
  const cancel = document.createElement("button");
  cancel.className = "docform-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeForm);
  const save = document.createElement("button");
  save.className = "docform-save";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    if (!text.value.trim()) {
      error.textContent = "Write something first.";
      text.classList.add("invalid");
      text.focus();
      return;
    }
    vscode.postMessage({ type: "save", id, text: text.value });
    closeForm();
  });
  actions.append(cancel, save);
  form.append(actions);

  // Focus the box and restore the caret so typing continues seamlessly across
  // the re-renders that fire while the form is open.
  requestAnimationFrame(() => {
    text.focus();
    const pos = editCaret ?? text.value.length;
    text.setSelectionRange(pos, pos);
  });
  return form;
}

/** Reconstruct the single text box from an existing binding (label + body). */
function existingText(b?: ApiBinding): string {
  if (!b) return "";
  return [b.title, b.description].filter(Boolean).join("\n\n");
}

function docCard(id: string, b: ApiBinding): HTMLElement {
  const card = document.createElement("div");
  card.className = "doccard";
  card.addEventListener("click", (e) => e.stopPropagation());

  // Header: title on the left, kebab (⋮) menu on the right.
  const header = document.createElement("div");
  header.className = "cardhead";
  header.append(rowEl("h4", b.title), kebab(id, b));
  card.append(header);

  if (b.language) card.append(rowEl("div", b.language, "tag"));
  if (b.method || b.endpoint)
    card.append(rowEl("div", [b.method, b.endpoint].filter(Boolean).join(" "), "route"));
  if (b.parameters?.length)
    card.append(rowEl("div", `params: ${b.parameters.join(", ")}`, "params"));
  if (b.description) {
    const doc = document.createElement("div");
    doc.className = "doc";
    doc.innerHTML = mdToHtml(b.description);
    card.append(doc);
  }

  return card;
}

/** The ⋮ button and, when open, its Edit / Delete dropdown. */
function kebab(id: string, b: ApiBinding): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "kebabwrap";

  const btn = document.createElement("button");
  btn.className = "kebab";
  btn.title = "More actions";
  btn.setAttribute("aria-label", "More actions");
  btn.setAttribute("aria-expanded", String(menuOpen));
  btn.textContent = "⋮";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuOpen = !menuOpen;
    scheduleRender();
  });
  wrap.append(btn);

  if (menuOpen) {
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.append(
      menuItem("Edit", () => {
        // Open the inline form pre-filled, instead of host prompts.
        editId = id;
        editDraft = existingText(b);
        editCaret = null;
      }),
      menuItem(
        "Delete",
        () => vscode.postMessage({ type: "delete", id, title: b.title }),
        "danger",
      ),
    );
    wrap.append(menu);
  }
  return wrap;
}

function menuItem(label: string, onClick: () => void, cls = ""): HTMLElement {
  const b = document.createElement("button");
  b.className = `menuitem${cls ? ` ${cls}` : ""}`;
  b.setAttribute("role", "menuitem");
  b.textContent = label;
  b.addEventListener("click", () => {
    openId = null; // host takes over with a prompt; close the card + menu
    menuOpen = false;
    onClick();
    scheduleRender();
  });
  return b;
}

function rowEl(tag: string, text: string, cls = ""): HTMLElement {
  const n = document.createElement(tag);
  n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function bounds(
  els: Array<{ x: number; y: number; width: number; height: number }>,
): {
  minX: number;
  minY: number;
  w: number;
  h: number;
} {
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
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

// ===========================================================================
// Endpoint timeline panel (git-graph + catch-up digest)
//
// All the logic lives in forward-core (flattenTimelines / digest / computeLanes);
// this only draws into the fixed #timeline panel. Clicking a row scrolls the
// element into view and opens its doc card (when it still exists).
// ===========================================================================
const timelinePanel = document.getElementById("timeline") as HTMLElement;

const TL_WINDOWS: Array<{ key: string; label: string; ms: number }> = [
  { key: "24h", label: "Last 24 hours", ms: 24 * 3600_000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 24 * 3600_000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 24 * 3600_000 },
  { key: "all", label: "All time", ms: Number.POSITIVE_INFINITY },
];
const TL_LANE_W = 14;
const TL_ROW_H = 46;

function renderTimeline(): void {
  timelinePanel.hidden = !showTimeline;
  if (!showTimeline) return;
  timelinePanel.replaceChildren();

  const head = tlDiv("tl-head");
  head.append(rowEl("h2", "Endpoint timeline"));
  const close = document.createElement("button");
  close.className = "tl-close";
  close.title = "Close timeline";
  close.textContent = "✕";
  close.addEventListener("click", () => {
    showTimeline = false;
    timelineToggle?.classList.remove("active");
    timelineToggle?.setAttribute("aria-pressed", "false");
    renderTimeline();
  });
  head.append(close);
  timelinePanel.append(head);

  // Current binding labels, for live endpoints whose old entries predate the
  // per-entry endpoint snapshots.
  const current: Record<string, CurrentLabel> = {};
  for (const el of latest) {
    const b = el.apiBinding;
    if (!b) continue;
    current[el.id] = {
      title: b.title,
      ...(b.method ? { method: b.method } : {}),
      ...(b.endpoint ? { path: b.endpoint } : {}),
    };
  }
  const events = flattenTimelines(timelines, current);
  if (!events.length) {
    timelinePanel.append(
      rowEl(
        "p",
        "No endpoint history yet. Document an element and its changes show up here.",
        "tl-empty",
      ),
    );
    return;
  }

  renderTlDigest(events);
  renderTlGraph(events);
}

function renderTlDigest(events: TimelineEvent[]): void {
  timelinePanel.append(rowEl("h3", "Catch-up digest"));

  const since = tlDiv("tl-since");
  const label = document.createElement("label");
  label.textContent = "Since";
  const select = document.createElement("select");
  for (const w of TL_WINDOWS) {
    const o = document.createElement("option");
    o.value = w.key;
    o.textContent = w.label;
    if (w.key === timelineWindow) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => {
    timelineWindow = select.value;
    body.replaceChildren();
    fill(body);
  });
  since.append(label, select);
  timelinePanel.append(since);

  const body = tlDiv("tl-digest");
  fill(body);
  timelinePanel.append(body);

  function fill(into: HTMLElement): void {
    const winMs =
      TL_WINDOWS.find((w) => w.key === timelineWindow)?.ms ??
      Number.POSITIVE_INFINITY;
    const sinceTs = Number.isFinite(winMs) ? Date.now() - winMs : 0;
    const d = digest(events, sinceTs);
    if (!d.toIntegrate.length && !d.toModify.length && !d.toRemove.length) {
      into.append(rowEl("p", "No endpoint changes in this window.", "tl-empty"));
      return;
    }
    into.append(tlGroup("To integrate", "created", d.toIntegrate));
    into.append(tlGroup("To modify", "modified", d.toModify));
    into.append(tlGroup("To remove", "deleted", d.toRemove));
  }
}

function tlGroup(
  title: string,
  tone: VersionAction,
  items: DigestItem[],
): HTMLElement {
  const g = tlDiv("tl-group");
  if (!items.length) return g;
  const t = tlDiv(`tl-group-title tl-action-${tone}`);
  t.append(rowEl("span", title), rowEl("span", String(items.length), "tl-count"));
  g.append(t);
  for (const item of items) {
    const row = tlDiv("tl-item");
    if (item.method) row.append(rowEl("span", item.method, "tl-method"));
    row.append(rowEl("span", item.title, "tl-title"));
    if (item.path) row.append(rowEl("span", item.path, "tl-path"));
    row.addEventListener("click", () => revealElement(item.elementId));
    g.append(row);
  }
  return g;
}

function renderTlGraph(events: TimelineEvent[]): void {
  timelinePanel.append(rowEl("h3", "History"));

  const rows = computeLanes(events); // chronological (oldest first)
  const railW = laneCount(rows) * TL_LANE_W;
  const list = tlDiv("tl-graph");

  // Newest at the top, like a git log; in each row "up" is later in time.
  for (const row of [...rows].reverse()) {
    const e = row.event;
    const item = tlDiv("tl-row");
    item.title = `${e.title} — ${e.action}`;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "tl-rail");
    svg.setAttribute("width", String(railW));
    svg.setAttribute("height", String(TL_ROW_H));
    const x = (lane: number) => lane * TL_LANE_W + TL_LANE_W / 2;
    const cy = TL_ROW_H / 2;
    for (const l of row.through) svg.append(tlLine(x(l), 0, x(l), TL_ROW_H));
    // The endpoint's own lane: a created event has no past (below), a deleted
    // event no future (above); a modify passes straight through.
    if (e.action !== "created") svg.append(tlLine(x(row.lane), cy, x(row.lane), TL_ROW_H));
    if (e.action !== "deleted") svg.append(tlLine(x(row.lane), 0, x(row.lane), cy));
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(x(row.lane)));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "4.5");
    dot.setAttribute("class", `tl-node-${e.action}`);
    svg.append(dot);
    item.append(svg);

    const info = tlDiv("tl-info");
    const top = tlDiv("");
    top.append(rowEl("span", e.action, `tl-action tl-action-${e.action}`));
    if (e.method) top.append(rowEl("span", e.method, "tl-method"));
    top.append(rowEl("span", e.title, "tl-title"));
    info.append(top);
    if (e.path) info.append(tlDiv("tl-path", e.path));
    if (e.changeLog) info.append(tlDiv("tl-log", e.changeLog));
    info.append(
      tlDiv(
        "tl-meta",
        [e.author, e.version, e.commitHash, tlTime(e.timestamp)]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    item.append(info);

    item.addEventListener("click", () => revealElement(e.elementId));
    list.append(item);
  }
  timelinePanel.append(list);
}

/** Scroll a timeline row's element into view and open its doc card. */
function revealElement(id: string): void {
  const el = latest.find((e) => e.id === id);
  if (!el) return; // the design element itself was deleted
  if (el.apiBinding && showDocs) {
    openId = id;
    menuOpen = false;
    scheduleRender();
  }
  requestAnimationFrame(() => {
    worldEl
      ?.querySelector(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  });
}

function tlLine(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", String(x1));
  l.setAttribute("y1", String(y1));
  l.setAttribute("x2", String(x2));
  l.setAttribute("y2", String(y2));
  return l;
}

function tlDiv(cls: string, content = ""): HTMLDivElement {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  if (content) d.textContent = content;
  return d;
}

function tlTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Tiny, safe Markdown subset: escape, then **bold**, `code`, line breaks. */
function mdToHtml(src: string): string {
  const esc = src.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}
