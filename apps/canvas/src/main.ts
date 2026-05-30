import type { CanvasNode, VersionEntry } from "@adc/shared";
import { FixtureSource, type CanvasSource, type NodeSnapshot } from "./firebase.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PROJECT_ID = "project_xyz";

/**
 * Pick the data source. Default to the offline fixture so the canvas runs with
 * zero setup; swap to LiveSource once the user supplies their Firebase config.
 *
 *   import { LiveSource } from "./firebase.js";
 *   const source = new LiveSource(window.FIREBASE_CONFIG, PROJECT_ID);
 */
const source: CanvasSource = new FixtureSource(PROJECT_ID);

const svg = document.getElementById("canvas") as unknown as SVGSVGElement;
const drawer = document.getElementById("drawer") as HTMLElement;

/** Track previous updatedAt per node so we can flash a "changed" flag live. */
const lastSeen = new Map<string, string>();

source.subscribe((snapshots) => render(snapshots));

function render(snapshots: NodeSnapshot[]): void {
  svg.replaceChildren();
  snapshots.forEach((snap, i) => {
    const changed =
      lastSeen.has(snap.nodeId) &&
      lastSeen.get(snap.nodeId) !== snap.node.updatedAt;
    lastSeen.set(snap.nodeId, snap.node.updatedAt);
    svg.appendChild(drawNode(snap, i, changed));
  });
}

function drawNode(snap: NodeSnapshot, index: number, changed: boolean): SVGGElement {
  const x = 40 + (index % 3) * 260;
  const y = 40 + Math.floor(index / 3) * 140;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `node${changed ? " changed" : ""}`);
  g.setAttribute("transform", `translate(${x},${y})`);

  const rect = el("rect", { width: "220", height: "100", rx: "8" });
  const method = text(snap.node.method, 14, 28, "method");
  const endpoint = text(truncate(snap.node.endpoint, 26), 14, 52);
  const id = text(snap.nodeId, 14, 78);
  id.setAttribute("opacity", "0.6");

  g.append(rect, method, endpoint, id);
  if (changed) g.append(text("● updated", 150, 28));

  g.addEventListener("click", () => openDrawer(snap));
  return g;
}

function openDrawer(snap: NodeSnapshot): void {
  drawer.classList.add("open");
  drawer.replaceChildren();
  drawer.append(
    h("h2", `${snap.node.method} ${snap.node.endpoint}`),
    h("p", snap.node.description || "No description."),
    fieldsTable(snap.node),
    h("h3", "Version history"),
    timelineList(snap.timeline),
  );
}

function fieldsTable(node: CanvasNode): HTMLElement {
  const rows = Object.entries(node.requestBody ?? {})
    .map(([k, v]) => `<tr><td><code>${k}</code></td><td>${v}</td></tr>`)
    .join("");
  const table = document.createElement("table");
  table.innerHTML = `<tr><th>Field</th><th>Type</th></tr>${
    rows || `<tr><td colspan="2">No request body</td></tr>`
  }`;
  return table;
}

function timelineList(timeline: VersionEntry[]): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "timeline";
  for (const v of [...timeline].reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge">${v.version}</span> ${v.changeLog}<br><small>${v.author}${
      v.commitHash ? ` · ${v.commitHash}` : ""
    }</small>`;
    ul.append(li);
  }
  if (!timeline.length) ul.innerHTML = "<li>No history yet.</li>";
  return ul;
}

// --- tiny DOM helpers ---
function el(name: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
function text(content: string, x: number, y: number, cls = ""): SVGTextElement {
  const t = el("text", { x: String(x), y: String(y) }) as SVGTextElement;
  if (cls) t.setAttribute("class", cls);
  t.textContent = content;
  return t;
}
function h(tag: string, content: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
