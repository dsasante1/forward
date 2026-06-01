import type {
  ApiBinding,
  DesignElement,
  InfraEdge,
  InfraNode,
} from "@adc/shared";

/**
 * Read-only design viewer that runs inside the VS Code webview.
 *
 * It never talks to Firebase itself — the extension host polls the RTDB and
 * posts the elements in (keeps the auth token out of the webview and lets the
 * CSP stay strict). For every element carrying an `apiBinding` we drop a
 * minimized pin over the design; clicking the pin expands the documentation,
 * with Edit / Delete actions. Undocumented elements get an add button on hover.
 * Those actions are sent back to the host, which runs the real prompt flow.
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
}

type HostMessage = ElementsMessage | InfraMessage;

const SVG_NS = "http://www.w3.org/2000/svg";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const PAD = 24;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

let openId: string | null = null;
let menuOpen = false; // the kebab (⋮) action menu inside the open card
let showDocs = true; // show/hide the minimized API pins on documented elements
let showInfra = false; // show/hide the infrastructure diagram overlay
let latest: DesignElement[] = [];
let latestProject = "";
let infraNodes: InfraNode[] = [];
let infraEdges: InfraEdge[] = [];
let zoom = 1; // multiplier on top of the fit-to-width base scale; 1 = fit.

const root = document.getElementById("app") as HTMLElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLElement;

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as HostMessage;
  if (msg?.type === "elements") {
    latest = msg.elements;
    latestProject = msg.projectId;
    render();
  } else if (msg?.type === "infra") {
    infraNodes = msg.nodes;
    infraEdges = msg.edges;
    render();
  }
});

// Click anywhere that isn't a pin/card closes the open card — unless that
// "click" was actually the tail end of a pan drag.
document.addEventListener("click", (e) => {
  if (panMoved) {
    panMoved = false;
    return;
  }
  const t = e.target as HTMLElement;
  if (!t.closest(".pin") && !t.closest(".doccard")) {
    openId = null;
    menuOpen = false;
    render();
    return;
  }
  // A click inside the card but off the kebab/menu just dismisses the menu.
  if (menuOpen && !t.closest(".kebab") && !t.closest(".menu")) {
    menuOpen = false;
    render();
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
  if (t.closest(".pin, .addbtn, .doccard, .toolbar")) return;
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
    openId = null; // hide any open card along with the pins
    menuOpen = false;
  }
  render();
});

// --- show/hide infrastructure overlay toggle -----------------------------
const infraToggle = document.getElementById("toggleInfra") as HTMLElement | null;
infraToggle?.classList.toggle("active", showInfra);
infraToggle?.addEventListener("click", () => {
  showInfra = !showInfra;
  infraToggle.classList.toggle("active", showInfra);
  infraToggle.setAttribute("aria-pressed", String(showInfra));
  render();
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
window.addEventListener("resize", render);

function setZoom(next: number): void {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  render();
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

  // Bigger elements first so frames sit behind their children. Dim the design
  // layer while the infra overlay is on, so the diagram reads on top.
  const ordered = [...latest].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );
  if (drawInfra) world.style.setProperty("--design-dim", "0.35");

  for (const el of ordered) {
    const node = elementNode(el, px(el.x), py(el.y), el.width * scale, el.height * scale);
    if (drawInfra) node.style.opacity = "var(--design-dim)";
    world.append(node);
  }

  if (drawInfra) world.append(infraLayer(px, py, scale, bbox));

  root.append(world);
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

  // Edges first (drawn under the node boxes), connecting node centres.
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
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(ax));
    line.setAttribute("y1", String(ay));
    line.setAttribute("x2", String(bx));
    line.setAttribute("y2", String(by));
    svg.append(line);
    if (edge.label) {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String((ax + bx) / 2));
      t.setAttribute("y", String((ay + by) / 2));
      t.setAttribute("class", "edgelabel");
      t.textContent = edge.label;
      svg.append(t);
    }
  }
  frag.append(svg);

  // Group containers first so they sit behind the nodes nested in them.
  const ordered = [...infraNodes].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );
  for (const n of ordered) frag.append(infraNode(n, px(n.x), py(n.y), n.width * scale, n.height * scale));
  return frag;
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
  node.style.left = `${px}px`;
  node.style.top = `${py}px`;
  node.style.width = `${pw}px`;
  node.style.height = `${ph}px`;

  const s = el.style ?? {};
  if (el.type === "text") {
    node.textContent = el.text ?? el.name ?? "Text";
    if (s.color) node.style.color = s.color;
    if (s.fontSize) node.style.fontSize = `${s.fontSize}px`;
    if (s.fontWeight) node.style.fontWeight = String(s.fontWeight);
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

  if (el.apiBinding) {
    if (showDocs) node.append(pin(el.id, el.apiBinding)); // documented -> pin
  } else {
    node.append(addBtn(el.id)); // undocumented -> hover "+ Doc"
  }
  return node;
}

function pin(id: string, b: ApiBinding): HTMLElement {
  const button = document.createElement("button");
  button.className = "pin";
  button.title = b.title;
  button.textContent = "API";
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    openId = openId === id ? null : id;
    menuOpen = false; // open/switch cards with the menu collapsed
    render();
  });

  if (openId === id) {
    button.append(docCard(id, b));
  }
  return button;
}

function addBtn(id: string): HTMLElement {
  const button = document.createElement("button");
  button.className = "addbtn";
  button.title = "Document this element";
  button.textContent = "+ Doc";
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: "document", id });
  });
  return button;
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
    render();
  });
  wrap.append(btn);

  if (menuOpen) {
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.append(
      menuItem("Edit", () => vscode.postMessage({ type: "edit", id })),
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
    render();
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
