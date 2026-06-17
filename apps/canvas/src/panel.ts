import {
  type ApiBinding,
  type DesignElement,
  HttpMethod,
  type VersionEntry,
} from "schema-nexus-core";

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

  // --- properties (each section collapses independently) ---
  const pos = section("Position & size");
  pos.append(numRow("X", el.x, (v) => onChange({ x: v })));
  pos.append(numRow("Y", el.y, (v) => onChange({ y: v })));
  pos.append(numRow("W", el.width, (v) => onChange({ width: v })));
  pos.append(numRow("H", el.height, (v) => onChange({ height: v })));
  root.append(pos);

  const styleSec = section("Style");
  styleSec.append(textRow("Name", el.name, (v) => onChange({ name: v })));
  if (el.type === "text" || el.text !== undefined) {
    styleSec.append(textRow("Text", el.text ?? "", (v) => onChange({ text: v })));
  }
  const style = el.style ?? {};
  styleSec.append(
    textRow("Fill", style.fill ?? "", (v) =>
      onChange({ style: { ...style, fill: v } }),
    ),
  );
  styleSec.append(
    textRow("Stroke", style.stroke ?? "", (v) =>
      onChange({ style: { ...style, stroke: v } }),
    ),
  );
  styleSec.append(
    numRow("Radius", style.radius ?? 0, (v) =>
      onChange({ style: { ...style, radius: v } }),
    ),
  );
  if (el.type === "text") {
    styleSec.append(
      numRow("Font", style.fontSize ?? 16, (v) =>
        onChange({ style: { ...style, fontSize: v } }),
      ),
    );
  }
  root.append(styleSec);

  // --- API documentation (authored here in the canvas OR from VS Code; both
  //     write to the same apiBinding sub-tree, so either side can edit) ---
  const docs = section("API documentation");
  renderApiDocs(docs, el, onChange);
  root.append(docs);

  // --- version history ---
  const history = section("Version history");
  history.append(timelineList(timeline));
  root.append(history);
}

/** A collapsible panel section: a <details> with the title as its <summary>. */
function section(title: string, open = true): HTMLDetailsElement {
  const d = document.createElement("details");
  d.className = "panel-section";
  d.open = open;
  const summary = document.createElement("summary");
  summary.textContent = title;
  d.append(summary);
  return d;
}

/**
 * The editable API-documentation section. When the element has no binding yet
 * we show a single "Add documentation" button; clicking it seeds a minimal,
 * schema-valid binding. Once present, every field edits the SAME apiBinding
 * sub-tree VS Code writes to, so the two authoring surfaces stay in sync.
 */
function renderApiDocs(
  root: HTMLElement,
  el: DesignElement,
  onChange: (patch: Patch) => void,
): void {
  const b = el.apiBinding;

  if (!b) {
    const p = h(
      "p",
      "No documentation yet — add it here, or from VS Code via “Document API on Design Element”.",
      "empty",
    );
    const add = document.createElement("button");
    add.className = "doc-add";
    add.textContent = "+ Add documentation";
    add.addEventListener("click", () =>
      onChange({
        apiBinding: { title: el.name || el.id, description: "", parameters: [] },
      }),
    );
    root.append(p, add);
    return;
  }

  // Merge a single field into the existing binding and push it back up.
  const set = (patch: Partial<ApiBinding>) =>
    onChange({ apiBinding: { ...b, ...patch } });

  // Docs-first: the title + free-form Markdown body carry the meaning, and work
  // for any kind of binding (REST, GraphQL, gRPC, CLI, a background job…).
  root.append(textRow("Title", b.title, (v) => set({ title: v })));
  root.append(
    textareaRow(
      "Docs",
      b.description,
      (v) => set({ description: v }),
      8,
      "Free-form Markdown — describe the endpoint, behaviour, examples…",
    ),
  );

  // The structured HTTP fields are OPTIONAL hints for REST-style endpoints; keep
  // them out of the way and only spring open when they already hold something.
  const hasHints = Boolean(
    b.method || b.endpoint || b.language || b.parameters.length,
  );
  const details = document.createElement("details");
  details.className = "doc-optional";
  if (hasHints) details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Optional API details";
  details.append(summary);
  details.append(
    selectRow("Method", b.method ?? "", ["", ...HttpMethod.options], (v) =>
      set({ method: (v || undefined) as ApiBinding["method"] }),
    ),
  );
  details.append(
    textRow("Endpoint", b.endpoint ?? "", (v) => set({ endpoint: v || undefined })),
  );
  details.append(
    textRow("Language", b.language ?? "", (v) => set({ language: v || undefined })),
  );
  details.append(
    textRow("Params", b.parameters.join(", "), (v) =>
      set({
        parameters: v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    ),
  );
  root.append(details);

  const remove = document.createElement("button");
  remove.className = "doc-remove";
  remove.textContent = "Remove documentation";
  remove.addEventListener("click", () => onChange({ apiBinding: undefined }));
  root.append(remove);
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

function selectRow(
  label: string,
  value: string,
  options: readonly string[],
  onChange: (v: string) => void,
): HTMLElement {
  const select = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt || "—";
    if (opt === value) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  const div = document.createElement("div");
  div.className = "row";
  const l = document.createElement("label");
  l.textContent = label;
  div.append(l, select);
  return div;
}

function textareaRow(
  label: string,
  value: string,
  onChange: (v: string) => void,
  rows = 4,
  placeholder = "",
): HTMLElement {
  const ta = document.createElement("textarea");
  ta.rows = rows;
  ta.value = value;
  if (placeholder) ta.placeholder = placeholder;
  ta.addEventListener("change", () => onChange(ta.value));
  const div = document.createElement("div");
  div.className = "row row-stack";
  const l = document.createElement("label");
  l.textContent = label;
  div.append(l, ta);
  return div;
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
