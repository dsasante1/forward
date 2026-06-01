import type { ApiBinding, DesignElement } from "@adc/shared";

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

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const PAD = 24;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

let openId: string | null = null;
let latest: DesignElement[] = [];
let latestProject = "";
let zoom = 1; // multiplier on top of the fit-to-width base scale; 1 = fit.

const root = document.getElementById("app") as HTMLElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLElement;

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as ElementsMessage;
  if (msg?.type === "elements") {
    latest = msg.elements;
    latestProject = msg.projectId;
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

  if (!latest.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `No design elements in project "${latestProject}". Ask the designer to draw something on the canvas first.`;
    root.append(empty);
    return;
  }

  const bbox = bounds(latest);
  const avail = (root.clientWidth || 800) - PAD * 2;
  const scale = Math.min(1, avail / Math.max(1, bbox.w)) * zoom;

  const world = document.createElement("div");
  world.className = "world";
  world.style.width = `${bbox.w * scale + PAD * 2}px`;
  world.style.height = `${bbox.h * scale + PAD * 2}px`;

  // Bigger elements first so frames sit behind their children.
  const ordered = [...latest].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );

  for (const el of ordered) {
    const px = (el.x - bbox.minX) * scale + PAD;
    const py = (el.y - bbox.minY) * scale + PAD;
    world.append(elementNode(el, px, py, el.width * scale, el.height * scale));
  }

  root.append(world);
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
    if (el.text) {
      const label = document.createElement("span");
      label.className = "el-text";
      label.textContent = el.text;
      if (s.color) label.style.color = s.color;
      node.append(label);
    }
  }

  if (el.apiBinding) {
    node.append(pin(el.id, el.apiBinding)); // documented -> pin
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

  card.append(rowEl("h4", b.title));
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

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    actionBtn("Edit", () => vscode.postMessage({ type: "edit", id })),
    actionBtn("Delete", () =>
      vscode.postMessage({ type: "delete", id, title: b.title }), "danger",
    ),
  );
  card.append(actions);
  return card;
}

function actionBtn(label: string, onClick: () => void, cls = ""): HTMLElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", () => {
    openId = null; // host takes over with a prompt; close the card
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

function bounds(els: DesignElement[]): {
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
