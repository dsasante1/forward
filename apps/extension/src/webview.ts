import type { ApiBinding, DesignElement } from "@adc/shared";

/**
 * Read-only design viewer that runs inside the VS Code webview.
 *
 * It never talks to Firebase itself — the extension host polls the RTDB and
 * posts the elements in (keeps the auth token out of the webview and lets the
 * CSP stay strict). For every element carrying an `apiBinding` we drop a
 * minimized pin over the design; clicking the pin expands the documentation.
 */

interface ElementsMessage {
  type: "elements";
  elements: DesignElement[];
  projectId: string;
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const PAD = 24;
let openId: string | null = null;
let latest: DesignElement[] = [];
let latestProject = "";

const root = document.getElementById("app") as HTMLElement;

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as ElementsMessage;
  if (msg?.type === "elements") {
    latest = msg.elements;
    latestProject = msg.projectId;
    render();
  }
});

// Click anywhere that isn't a pin/card closes the open card.
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest(".pin") && !t.closest(".doccard")) {
    openId = null;
    render();
  }
});

window.addEventListener("resize", render);

// Tell the host we're ready to receive the first snapshot.
vscode.postMessage({ type: "ready" });

function render(): void {
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
  const scale = Math.min(1, avail / Math.max(1, bbox.w));

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

  // The pin — minimized doc marker. Click to expand.
  if (el.apiBinding) {
    node.append(pin(el.id, el.apiBinding));
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
    button.append(docCard(b));
  }
  return button;
}

function docCard(b: ApiBinding): HTMLElement {
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
  return card;
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
