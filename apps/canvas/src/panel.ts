import type { DesignElement, VersionEntry } from "@adc/shared";

type Patch = Partial<DesignElement>;

/**
 * Render the right-hand panel for the selected element:
 *   1. Geometry + style properties (editable -> onChange).
 *   2. The API binding the backend attached (read-only here; it's authored from
 *      VS Code). This is the seam between design and backend.
 *   3. Version history of that binding.
 */
export function renderPanel(
  root: HTMLElement,
  el: DesignElement | undefined,
  timeline: VersionEntry[],
  onChange: (patch: Patch) => void,
): void {
  root.replaceChildren();
  if (!el) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Select or draw an element.";
    root.append(p);
    return;
  }

  root.append(h("h2", el.name || el.id));
  root.append(h("p", el.type, "empty"));

  // --- properties ---
  root.append(h("h3", "Position & size"));
  root.append(numRow("X", el.x, (v) => onChange({ x: v })));
  root.append(numRow("Y", el.y, (v) => onChange({ y: v })));
  root.append(numRow("W", el.width, (v) => onChange({ width: v })));
  root.append(numRow("H", el.height, (v) => onChange({ height: v })));

  root.append(h("h3", "Style"));
  root.append(textRow("Name", el.name, (v) => onChange({ name: v })));
  if (el.type === "text" || el.text !== undefined) {
    root.append(textRow("Text", el.text ?? "", (v) => onChange({ text: v })));
  }
  const style = el.style ?? {};
  root.append(
    textRow("Fill", style.fill ?? "", (v) =>
      onChange({ style: { ...style, fill: v } }),
    ),
  );
  root.append(
    textRow("Stroke", style.stroke ?? "", (v) =>
      onChange({ style: { ...style, stroke: v } }),
    ),
  );
  root.append(
    numRow("Radius", style.radius ?? 0, (v) =>
      onChange({ style: { ...style, radius: v } }),
    ),
  );
  if (el.type === "text") {
    root.append(
      numRow("Font", style.fontSize ?? 16, (v) =>
        onChange({ style: { ...style, fontSize: v } }),
      ),
    );
  }

  // --- API binding (authored from VS Code) ---
  root.append(h("h3", "API binding"));
  if (!el.apiBinding) {
    root.append(
      h(
        "p",
        "No endpoint yet. Annotate this element from VS Code via “Connect API Route to Design Canvas”.",
        "empty",
      ),
    );
  } else {
    const b = el.apiBinding;
    root.append(h("p", `${b.method} ${b.endpoint}`));
    if (b.description) root.append(h("p", b.description));
    if (b.requestBody) root.append(fieldTable("Request body", b.requestBody));
    if (b.responseSample)
      root.append(
        fieldTable(
          "Response",
          Object.fromEntries(
            Object.entries(b.responseSample).map(([k, v]) => [k, String(v)]),
          ),
        ),
      );
  }

  // --- version history ---
  root.append(h("h3", "Version history"));
  root.append(timelineList(timeline));
}

// ---- builders -----------------------------------------------------------
function h(tag: string, content: string, cls = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (cls) node.className = cls;
  return node;
}

function row(label: string, input: HTMLInputElement): HTMLElement {
  const div = document.createElement("div");
  div.className = "row";
  const l = document.createElement("label");
  l.textContent = label;
  div.append(l, input);
  return div;
}

function numRow(
  label: string,
  value: number,
  onChange: (v: number) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(Math.round(value));
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (!Number.isNaN(n)) onChange(n);
  });
  return row(label, input);
}

function textRow(
  label: string,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  return row(label, input);
}

function fieldTable(title: string, fields: Record<string, string>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.append(h("p", title, "empty"));
  const table = document.createElement("table");
  const rows = Object.entries(fields)
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`)
    .join("");
  table.innerHTML = `<tr><th>Field</th><th>Type</th></tr>${rows}`;
  wrap.append(table);
  return wrap;
}

function timelineList(timeline: VersionEntry[]): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "timeline";
  if (!timeline.length) {
    ul.innerHTML = `<li class="empty">No history yet.</li>`;
    return ul;
  }
  for (const v of [...timeline].reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="badge">${esc(v.version)}</span> ${esc(
      v.changeLog,
    )}<br><small>${esc(v.author)}${
      v.commitHash ? ` · ${esc(v.commitHash)}` : ""
    }</small>`;
    ul.append(li);
  }
  return ul;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}
