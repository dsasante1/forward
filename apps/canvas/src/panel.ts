import {
  type ApiBinding,
  type DesignElement,
  type Entity,
  type EntityField,
  EntityKey,
  type EntityRelation,
  type InfraEdge,
  InfraEnv,
  InfraKind,
  type InfraNode,
  RelationCardinality,
  type StrokeStyle,
  type VersionEntry,
} from "forward-core";

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
  /**
   * Explicit "Save documentation" action — commits the current binding as a new
   * version-history entry (vs `onChange`, which only live-syncs the binding).
   * When omitted (source has no history), the button is hidden.
   */
  onDocument?: (binding: ApiBinding) => void,
  /** Close the inspector drawer (the header's ✕). When omitted, no close button
   * is shown. */
  onClose?: () => void,
  /**
   * Adopt a draft generated from code (drops its `origin`, so a later import
   * never updates it). Shown only for elements that carry an origin.
   */
  onAdopt?: () => void,
): void {
  root.replaceChildren();
  if (!el) {
    if (onClose) root.append(emptyHeader(onClose));
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Select or draw an element.";
    root.append(p);
    return;
  }

  // --- header: type chip + name + type subtitle ---
  root.append(inspectorHeader(el, onClose));
  if (el.origin) root.append(fromCodeSection(el.origin, onAdopt));

  // --- Position & size (2-col floating-label grid) ---
  const pos = section("Position & size");
  pos.append(
    fieldGrid([
      numField("X", el.x, (v) => onChange({ x: v })),
      numField("Y", el.y, (v) => onChange({ y: v })),
      numField("Width", el.width, (v) => onChange({ width: v })),
      numField("Height", el.height, (v) => onChange({ height: v })),
      numField("Rotate", el.rotation ?? 0, (v) => onChange({ rotation: v })),
    ]),
  );
  root.append(pos);

  // --- Style ---
  const style = el.style ?? {};
  const styleSec = section("Style");
  styleSec.append(
    fieldCell("Name", textInput(el.name, (v) => onChange({ name: v }))),
  );
  // Any element can carry a text label — a text element's content, or a label
  // centered on a rectangle/ellipse/frame. A textarea (not a single-line input)
  // so newlines can be typed here too; it writes the same `\n`-bearing text the
  // on-canvas inline editor does.
  styleSec.append(
    fieldCell("Text", textAreaInput(el.text ?? "", (v) => onChange({ text: v }))),
  );
  if (el.type === "text") {
    // A text element has no fill/stroke/border — its single colour is the glyph
    // colour (`style.color`). Falling back to `fill` picks up any colour set
    // before this dedicated control existed.
    styleSec.append(
      fieldCell(
        "Color",
        colorField(style.color ?? style.fill ?? "", (v) =>
          onChange({ style: { ...style, color: v } }),
        ),
      ),
    );
  } else {
    const border = borderControl(style, onChange);
    styleSec.append(
      fieldGrid([
        fieldCell(
          "Fill",
          colorField(style.fill ?? "", (v) => onChange({ style: { ...style, fill: v } })),
        ),
        fieldCell(
          "Stroke",
          colorField(style.stroke ?? "", (v) =>
            onChange({ style: { ...style, stroke: v } }),
          ),
        ),
        fieldCell(
          "Border",
          selectInput(
            style.strokeStyle ?? "solid",
            ["solid", "dashed", "dotted"],
            (v) => onChange({ style: { ...style, strokeStyle: v as StrokeStyle } }),
          ),
        ),
        border.cell,
      ]),
    );
    styleSec.append(border.grid);
  }
  if (el.type === "text") {
    styleSec.append(
      fieldCell(
        "Font",
        fontFamilySelect(style.fontFamily ?? "", (v) =>
          onChange({ style: { ...style, fontFamily: v || undefined } }),
        ),
      ),
    );
    styleSec.append(
      fieldGrid([
        numField("Size", style.fontSize ?? 16, (v) =>
          onChange({ style: { ...style, fontSize: v } }),
        ),
        fieldCell(
          "Weight",
          selectInput(
            String(style.fontWeight ?? 400),
            ["400", "500", "600", "700"],
            (v) => onChange({ style: { ...style, fontWeight: Number(v) } }),
          ),
        ),
      ]),
    );
  }
  // --- Corner radius (Linked toggle + all-corners + per-corner grid) ---
  //     Part of Style, so it lives inside the Style section and collapses with it.
  styleSec.append(radiusSection(style, onChange));
  root.append(styleSec);

  // --- API documentation (authored here in the canvas OR from VS Code; both
  //     write to the same apiBinding sub-tree, so either side can edit) ---
  const docs = section("API documentation");
  docs.classList.add("panel-section--docs"); // targetable by the canvas's "Add API docs" context-menu action
  renderApiDocs(docs, el, onChange, onDocument);
  root.append(docs);

  // --- version history ---
  const history = section("Version history");
  history.append(timelineList(timeline));
  root.append(history);
}

/** Human labels for the deployment environments. */
const INFRA_ENV_LABELS: Record<InfraEnv, string> = {
  dev: "Dev",
  staging: "Staging",
  prod: "Prod",
};

/** Human labels for the infra kinds (the enum values are terse/lowercase). */
const INFRA_KIND_LABELS: Record<InfraNode["kind"], string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  cache: "Cache",
  queue: "Queue",
  service: "Service",
  devops: "DevOps",
  external: "External",
  actor: "User / Actor",
  group: "Group",
};

/**
 * Kind → swatch colour, the single source of truth shared by the on-canvas SVG
 * overlay (canvas.ts imports this) and the inspector's dots/accents, so a node's
 * colour is identical wherever it appears.
 */
export const INFRA_COLORS: Record<InfraNode["kind"], string> = {
  frontend: "#5b8cff",
  backend: "#36c275",
  database: "#c9a227",
  cache: "#d1603d",
  queue: "#b06ad6",
  service: "#3db6c9",
  devops: "#e0507a",
  external: "#8a93a3",
  actor: "#8b7cf0",
  group: "#6b7280",
};

/** Callbacks + state the infra inspector needs from the editor. */
export interface InfraPanelHandlers {
  /** Source can persist nodes (add / edit / remove; otherwise read-only). */
  canEdit: boolean;
  /** Source can persist edges (the Link tool is available). */
  canLink: boolean;
  /** Source can delete individual edges (the connection ✕). */
  canUnlink: boolean;
  /** Link tool armed (waiting for two node clicks). */
  linking: boolean;
  /** Name of the first node picked while linking, if any (drives the guidance). */
  linkSourceName?: string;
  /** Every infra node — feeds the list, filter counts and connection lookups. */
  nodes: InfraNode[];
  /** Every infra edge. */
  edges: InfraEdge[];
  /** The currently selected node, if any (Detail mode). */
  node: InfraNode | undefined;
  /** Search query (List mode). */
  search: string;
  /** Active type filter: "all" or one of the InfraKind values. */
  typeFilter: string;
  /** Panel collapsed to just its header (the header chevron). */
  collapsed: boolean;
  onSearch(query: string): void;
  onFilter(kind: string): void;
  onAddNode(): void;
  onToggleLink(): void;
  onToggleCollapse(): void;
  /** Begin dragging the floating panel (mousedown on the handle / header). */
  onDragStart(e: MouseEvent): void;
  onSelectNode(id: string | null): void;
  onChangeNode(patch: Partial<InfraNode>): void;
  onRemoveNode(): void;
  onRemoveEdge(edgeId: string): void;
}

/**
 * The floating infrastructure inspector. A fixed header (title + node/edge
 * counts) and an Add-node / Link toolbar sit above one of three mode bodies:
 *   • LINK   — the Link tool is armed: guidance + the live connection list.
 *   • DETAIL — a node is selected: its editable fields + connected nodes.
 *   • LIST   — the default: search, type-filter chips and the node roster.
 * Mirrors the "Forward Infra Sidebar Redesign" mock, mapped onto the real
 * InfraNode/InfraEdge contract.
 */
export function renderInfraPanel(
  root: HTMLElement,
  opts: InfraPanelHandlers,
): void {
  root.replaceChildren();
  root.classList.add("ifp");

  const edgeCountFor = (id: string): number =>
    opts.edges.filter((e) => e.from === id || e.to === id).length;

  // --- shared floating chrome: drag grip + header (glyph + counts + chevron) ---
  root.append(panelHandle(opts.onDragStart));
  root.append(
    panelHeader({
      glyph: infraGlyph(),
      title: "Infrastructure",
      counts:
        `${opts.nodes.length} node${opts.nodes.length === 1 ? "" : "s"} · ` +
        `${opts.edges.length} edge${opts.edges.length === 1 ? "" : "s"}`,
      collapsed: opts.collapsed,
      onToggleCollapse: opts.onToggleCollapse,
      onDragStart: opts.onDragStart,
    }),
  );
  // Collapsed: show only the header, nothing below.
  if (opts.collapsed) return;

  // --- toolbar: Add node (primary) + Link (toggle) ---
  if (opts.canEdit || opts.canLink) {
    const btns: HTMLElement[] = [];
    if (opts.canEdit) btns.push(primaryBtn("Add node", opts.onAddNode));
    if (opts.canLink) {
      btns.push(
        toggleBtn(
          linkIcon(),
          opts.linking ? "Linking…" : "Link",
          opts.linking,
          opts.onToggleLink,
        ),
      );
    }
    root.append(toolbarRow(btns));
  }
  root.append(divider());

  if (opts.linking) {
    renderLinkMode(root, opts, edgeCountFor);
  } else if (opts.node) {
    renderNodeDetail(root, opts);
  } else {
    renderNodeList(root, opts, edgeCountFor);
  }
}

// ---- shared floating-inspector chrome (infra + data) --------------------
/** The "•••••" drag grip row that moves the floating panel. */
function panelHandle(onDragStart: (e: MouseEvent) => void): HTMLElement {
  const handle = document.createElement("div");
  handle.className = "ifp-handle";
  handle.addEventListener("mousedown", onDragStart);
  handle.append(h("span", "•••••", "ifp-handle-dots"));
  return handle;
}

/** The inspector header: glyph + title/counts + collapse chevron (a drag zone). */
function panelHeader(opts: {
  glyph: SVGElement;
  title: string;
  counts: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDragStart: (e: MouseEvent) => void;
}): HTMLElement {
  const head = document.createElement("div");
  head.className = "ifp-head";
  head.addEventListener("mousedown", opts.onDragStart);
  const meta = document.createElement("div");
  meta.className = "ifp-meta";
  meta.append(
    h("div", opts.title, "ifp-title-text"),
    h("div", opts.counts, "ifp-counts"),
  );
  const chevron = document.createElement("button");
  chevron.className = opts.collapsed ? "ifp-chevron collapsed" : "ifp-chevron";
  chevron.title = opts.collapsed ? "Expand panel" : "Collapse panel";
  chevron.append(svgNS(["M6 9l6 6 6-6"]));
  // Clicking the chevron must not also start a header drag.
  chevron.addEventListener("mousedown", (e) => e.stopPropagation());
  chevron.addEventListener("click", opts.onToggleCollapse);
  head.append(opts.glyph, meta, chevron);
  return head;
}

/** A primary (filled) toolbar button — "Add node" / "Add entity". */
function primaryBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "ifp-add";
  b.append(plusIcon(), h("span", label, "ifp-add-label"));
  b.addEventListener("click", onClick);
  return b;
}

/** A toggle (outline) toolbar button — "Link" / "Relate"; accents when active. */
function toggleBtn(
  icon: SVGElement,
  label: string,
  active: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = active ? "ifp-link on" : "ifp-link";
  b.append(icon, h("span", label, ""));
  b.addEventListener("click", onClick);
  return b;
}

/** The toolbar row wrapper holding the primary + toggle buttons. */
function toolbarRow(btns: HTMLElement[]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "ifp-toolbar";
  bar.append(...btns);
  return bar;
}

/** LINK mode: what-to-click guidance, an exit affordance, and the live edge list
 * (each removable when the source supports edge deletion). */
function renderLinkMode(
  root: HTMLElement,
  opts: InfraPanelHandlers,
  edgeCountFor: (id: string) => number,
): void {
  const body = scrollBody();

  const status = document.createElement("div");
  status.className = "ifp-linkstatus";
  status.append(h("span", "", "ifp-dot ifp-dot-accent"), h("span", "Link mode active", "ifp-linkstatus-text"));
  body.append(status);

  const guidance = opts.linkSourceName
    ? `Now click a target node to connect it to “${opts.linkSourceName}”.`
    : "Click a node on the canvas or in the list below to start a connection.";
  body.append(h("p", guidance, "ifp-guidance"));

  const exit = document.createElement("button");
  exit.className = "ifp-exit";
  exit.append(
    document.createTextNode("Exit link mode "),
    h("span", "· Esc", "ifp-kbd"),
  );
  exit.addEventListener("click", opts.onToggleLink);
  body.append(exit);

  body.append(sectionLabel(`Connections · ${opts.edges.length}`));
  const nameOf = (id: string): string =>
    opts.nodes.find((n) => n.id === id)?.label ?? "?";
  const list = document.createElement("div");
  list.className = "ifp-edgelist";
  if (!opts.edges.length) {
    list.append(h("p", "No connections yet.", "ifp-muted"));
  }
  for (const e of opts.edges) {
    const rowEl = document.createElement("div");
    rowEl.className = "ifp-edgerow";
    rowEl.append(
      h("span", `${nameOf(e.from)} → ${nameOf(e.to)}`, "ifp-edgerow-text"),
    );
    if (opts.canUnlink) {
      const del = document.createElement("button");
      del.className = "ifp-edgedel";
      del.title = "Remove connection";
      del.textContent = "✕";
      del.addEventListener("click", () => opts.onRemoveEdge(e.id));
      rowEl.append(del);
    }
    list.append(rowEl);
  }
  body.append(list);

  // Nodes stay clickable in the list while linking, so drive picks from here too.
  body.append(sectionLabel("Nodes"));
  const nodes = document.createElement("div");
  nodes.className = "ifp-rows";
  for (const n of opts.nodes) {
    nodes.append(
      nodeRow(n, edgeCountFor(n.id), () => opts.onSelectNode(n.id), true),
    );
  }
  body.append(nodes);
  root.append(body);
}

/** DETAIL mode: the selected node's editable fields + its connected nodes. */
function renderNodeDetail(root: HTMLElement, opts: InfraPanelHandlers): void {
  const node = opts.node;
  if (!node) return;
  const ro = !opts.canEdit;
  const body = scrollBody();

  const back = document.createElement("button");
  back.className = "ifp-back";
  back.append(h("span", "←", "ifp-back-arrow"), h("span", "All nodes", ""));
  back.addEventListener("click", () => opts.onSelectNode(null));
  body.append(back);

  body.append(fieldCell("Name", textInput(node.label, (v) => opts.onChangeNode({ label: v }), ro)));

  body.append(
    fieldGrid([
      fieldCell(
        "Type",
        selectInput(
          node.kind,
          InfraKind.options,
          (v) => opts.onChangeNode({ kind: v as InfraNode["kind"] }),
          ro,
          (v) => INFRA_KIND_LABELS[v as InfraNode["kind"]] ?? v,
        ),
      ),
      fieldCell(
        "Environment",
        // Optional field: a leading blank option ("—") clears it back to untagged.
        selectInput(
          node.env ?? "",
          ["", ...InfraEnv.options],
          (v) => opts.onChangeNode({ env: (v || undefined) as InfraNode["env"] }),
          ro,
          (v) => (v ? INFRA_ENV_LABELS[v as InfraEnv] : "—"),
        ),
      ),
    ]),
  );

  body.append(
    fieldCell(
      "Technology",
      textInput(node.tech ?? "", (v) => opts.onChangeNode({ tech: v || undefined }), ro),
    ),
  );

  const notes = document.createElement("textarea");
  notes.className = "fld-textarea";
  notes.rows = 3;
  notes.value = node.description;
  notes.disabled = ro;
  notes.placeholder = "Role in the system, config, gotchas…";
  notes.addEventListener("change", () => opts.onChangeNode({ description: notes.value }));
  body.append(fieldCell("Description", notes));

  body.append(divider());

  // --- connected nodes ---
  const connEdges = opts.edges.filter((e) => e.from === node.id || e.to === node.id);
  body.append(sectionLabel(`Connected nodes · ${connEdges.length}`));
  if (!connEdges.length) {
    body.append(h("p", "Not connected to any node yet.", "ifp-muted"));
  } else {
    const conns = document.createElement("div");
    conns.className = "ifp-rows";
    for (const e of connEdges) {
      const otherId = e.from === node.id ? e.to : e.from;
      const other = opts.nodes.find((n) => n.id === otherId);
      if (!other) continue;
      const rowEl = document.createElement("div");
      rowEl.className = "ifp-connrow";
      rowEl.addEventListener("click", () => opts.onSelectNode(other.id));
      rowEl.append(
        kindDot(other.kind),
        h("span", other.label, "ifp-connrow-name"),
        h("span", e.from === node.id ? "→ out" : "← in", "ifp-connrow-dir"),
      );
      conns.append(rowEl);
    }
    body.append(conns);
  }

  if (opts.canEdit) {
    body.append(divider());
    const remove = document.createElement("button");
    remove.className = "ifp-danger";
    remove.textContent = "Delete node";
    remove.addEventListener("click", opts.onRemoveNode);
    body.append(remove);
  }
  root.append(body);
}

/** LIST mode: search box, type-filter chips, node roster and a summary footer. */
function renderNodeList(
  root: HTMLElement,
  opts: InfraPanelHandlers,
  edgeCountFor: (id: string) => number,
): void {
  // search
  const searchWrap = document.createElement("div");
  searchWrap.className = "ifp-search";
  searchWrap.append(searchIcon());
  const search = document.createElement("input");
  search.type = "text";
  search.value = opts.search;
  search.placeholder = "Search nodes";
  search.addEventListener("input", () => opts.onSearch(search.value));
  searchWrap.append(search);
  root.append(searchWrap);

  // type chips
  const counts = new Map<string, number>();
  for (const n of opts.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const chips = document.createElement("div");
  chips.className = "ifp-chips";
  const chipDefs: Array<{ key: string; label: string }> = [
    { key: "all", label: `All · ${opts.nodes.length}` },
    ...[...counts.entries()].map(([k, c]) => ({
      key: k,
      label: `${INFRA_KIND_LABELS[k as InfraNode["kind"]] ?? k} · ${c}`,
    })),
  ];
  for (const c of chipDefs) {
    const chip = document.createElement("button");
    chip.className = opts.typeFilter === c.key ? "ifp-chip on" : "ifp-chip";
    chip.textContent = c.label;
    chip.addEventListener("click", () => opts.onFilter(c.key));
    chips.append(chip);
  }
  root.append(chips);
  root.append(divider());

  // rows
  const q = opts.search.trim().toLowerCase();
  const filtered = opts.nodes.filter(
    (n) =>
      (opts.typeFilter === "all" || n.kind === opts.typeFilter) &&
      (!q ||
        n.label.toLowerCase().includes(q) ||
        (n.tech ?? "").toLowerCase().includes(q)),
  );
  const body = scrollBody();
  if (!opts.nodes.length) {
    body.append(h("p", "No infrastructure nodes yet. Add one to start mapping the architecture.", "ifp-muted ifp-empty"));
  } else if (!filtered.length) {
    const none = document.createElement("div");
    none.className = "ifp-noresults";
    none.append(h("div", `No nodes match “${opts.search}”`, "ifp-noresults-text"));
    const clear = document.createElement("button");
    clear.className = "ifp-clear";
    clear.textContent = "Clear search";
    clear.addEventListener("click", () => opts.onSearch(""));
    none.append(clear);
    body.append(none);
  } else {
    const rows = document.createElement("div");
    rows.className = "ifp-rows";
    for (const n of filtered) {
      rows.append(nodeRow(n, edgeCountFor(n.id), () => opts.onSelectNode(n.id), false));
    }
    body.append(rows);
  }
  root.append(body);

  // footer summary
  const summary = [...counts.entries()]
    .map(([k, c]) => `${INFRA_KIND_LABELS[k as InfraNode["kind"]] ?? k} ${c}`)
    .join(" · ");
  if (summary) {
    const foot = h("div", summary, "ifp-foot");
    root.append(foot);
  }
}

// ---- infra-panel builders ----------------------------------------------
/** A node row: kind dot, name + tech, and its edge count. */
function nodeRow(
  n: InfraNode,
  edges: number,
  onClick: () => void,
  linking: boolean,
): HTMLElement {
  const rowEl = document.createElement("div");
  rowEl.className = linking ? "ifp-row ifp-row-link" : "ifp-row";
  rowEl.addEventListener("click", onClick);
  rowEl.append(kindDot(n.kind));
  const meta = document.createElement("div");
  meta.className = "ifp-row-meta";
  meta.append(h("div", n.label || n.id, "ifp-row-name"));
  meta.append(h("div", n.tech || "—", "ifp-row-tech"));
  rowEl.append(meta, h("span", String(edges), "ifp-row-count"));
  return rowEl;
}

/** A small coloured dot keyed to a node's kind. */
function kindDot(kind: InfraNode["kind"]): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "ifp-dot";
  dot.style.background = INFRA_COLORS[kind] ?? "var(--muted)";
  return dot;
}

/** An uppercase mono section label (e.g. "CONNECTIONS · 3"). */
function sectionLabel(text: string): HTMLElement {
  return h("div", text.toUpperCase(), "ifp-seclabel");
}

/** The scrolling body region shared by all three modes. */
function scrollBody(): HTMLElement {
  const b = document.createElement("div");
  b.className = "ifp-body fwdr-scroll";
  return b;
}

function divider(): HTMLElement {
  return h("div", "", "ifp-divider");
}

function svgNS(paths: string[], circles: Array<[number, number, number]> = []): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  for (const [cx, cy, r] of circles) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    svg.append(c);
  }
  return svg;
}

function infraGlyph(): SVGElement {
  const g = svgNS(["M7.8 8.4l2.6 8M16.4 9.6l-3 7M8.2 7.3h7.6"], [[6, 7, 2.2], [18, 8, 2.2], [12, 18, 2.2]]);
  g.classList.add("ifp-glyph");
  return g;
}
function plusIcon(): SVGElement {
  const g = svgNS(["M12 5v14M5 12h14"]);
  g.classList.add("ifp-icon");
  return g;
}
function linkIcon(): SVGElement {
  const g = svgNS(["M9 15l6-6M8 8l1-1a4 4 0 015.5 5.5l-1 1M16 16l-1 1a4 4 0 01-5.5-5.5l1-1"]);
  g.classList.add("ifp-icon");
  return g;
}
function searchIcon(): SVGElement {
  const g = svgNS(["M21 21l-4-4"], [[11, 11, 7]]);
  g.classList.add("ifp-search-icon");
  return g;
}
function dataGlyph(): SVGElement {
  const g = svgNS(["M3 4h8v16H3zM3 9h8", "M16 7h5v10h-5z", "M11 12h5"]);
  g.classList.add("ifp-glyph");
  return g;
}
/** Two connected tables — the "view as ER diagram" affordance. */
function diagramIcon(): SVGElement {
  const g = svgNS(["M3 4h7v6H3zM3 7h7", "M14 14h7v6h-7zM14 17h7", "M10 7h4v10"]);
  g.classList.add("ifp-icon");
  return g;
}

/** A plain accent-coloured dot (entities have no kind colour). */
function accentDot(): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "ifp-dot";
  dot.style.background = "var(--accent)";
  return dot;
}

/** Callbacks + state the ER (data-model) inspector needs from the editor. */
export interface EntityPanelHandlers {
  /** Source can persist entities (otherwise the drawer is read-only). */
  canEdit: boolean;
  /** Source can persist relations. */
  canRelate: boolean;
  /** Source can delete individual relations (the relation ✕). */
  canUnrelate: boolean;
  /** Relate tool armed (waiting for two entity clicks). */
  relating: boolean;
  /** Name of the first entity picked while relating, if any (drives guidance). */
  relateSourceName?: string;
  /** Panel collapsed to just its header (the header chevron). */
  collapsed: boolean;
  /** Every entity — feeds the list roster and relation lookups. */
  entities: Entity[];
  /** Every relation. */
  relations: EntityRelation[];
  /** The currently selected entity, if any. */
  entity: Entity | undefined;
  /** The currently selected relation, if any. */
  relation: EntityRelation | undefined;
  /** Search query (List mode). */
  search: string;
  /** Resolve an entity id to its display name (for the relation editor). */
  entityName(id: string): string;
  onSearch(query: string): void;
  onToggleCollapse(): void;
  onDragStart(e: MouseEvent): void;
  onAddEntity(): void;
  /** Open the read-only Mermaid ER diagram of the current model. */
  onViewDiagram(): void;
  onToggleRelate(): void;
  onSelectEntity(id: string | null): void;
  onSelectRelation(id: string | null): void;
  onChangeEntity(patch: Partial<Entity>): void;
  onRemoveEntity(): void;
  onChangeRelation(patch: Partial<EntityRelation>): void;
  onRemoveRelation(): void;
  onRemoveRelationById(id: string): void;
}

/** Human labels for the crow's-foot multiplicities (the enum values are terse). */
const CARDINALITY_LABELS: Record<EntityRelation["fromCardinality"], string> = {
  "zero-or-one": "Zero or one (0..1)",
  "exactly-one": "Exactly one (1)",
  "zero-or-many": "Zero or many (*)",
  "one-or-many": "One or many (1..*)",
};

/**
 * The floating ER (data-model) inspector — the data-model twin of
 * `renderInfraPanel`, sharing its chrome, modes and CSS. A header (title + entity/
 * relation counts) and an Add-entity / Relate toolbar sit above one of these:
 *   • RELATE — the Relate tool is armed: guidance + the live relation list.
 *   • RELATION — a relation is selected: its cardinality/verb editor.
 *   • ENTITY — an entity is selected: its name/fields/notes editor.
 *   • LIST   — the default: search + the entity roster.
 */
export function renderEntityPanel(
  root: HTMLElement,
  opts: EntityPanelHandlers,
): void {
  root.replaceChildren();
  root.classList.add("ifp");

  const entCount = opts.entities.length;
  const relCount = opts.relations.length;
  root.append(panelHandle(opts.onDragStart));
  root.append(
    panelHeader({
      glyph: dataGlyph(),
      title: "Data model",
      counts:
        `${entCount} entit${entCount === 1 ? "y" : "ies"} · ` +
        `${relCount} relation${relCount === 1 ? "" : "s"}`,
      collapsed: opts.collapsed,
      onToggleCollapse: opts.onToggleCollapse,
      onDragStart: opts.onDragStart,
    }),
  );
  if (opts.collapsed) return;

  // --- toolbar: Add entity (primary) + Relate (toggle) + Diagram (view) ---
  const btns: HTMLElement[] = [];
  if (opts.canEdit) btns.push(primaryBtn("Add entity", opts.onAddEntity));
  if (opts.canRelate) {
    btns.push(
      toggleBtn(
        linkIcon(),
        opts.relating ? "Relating…" : "Relate",
        opts.relating,
        opts.onToggleRelate,
      ),
    );
  }
  // The read-only ER diagram is always available (even on a read-only source) as
  // long as there is something to render.
  if (entCount) {
    btns.push(toggleBtn(diagramIcon(), "Diagram", false, opts.onViewDiagram));
  }
  if (btns.length) root.append(toolbarRow(btns));
  root.append(divider());

  if (opts.relating) {
    renderRelateMode(root, opts);
  } else if (opts.relation) {
    renderRelationEditor(root, opts);
  } else if (opts.entity) {
    renderEntityEditor(root, opts);
  } else {
    renderEntityList(root, opts);
  }
}

/** LIST mode: search box and the entity roster (dot + name + field count). */
function renderEntityList(root: HTMLElement, opts: EntityPanelHandlers): void {
  const searchWrap = document.createElement("div");
  searchWrap.className = "ifp-search";
  searchWrap.append(searchIcon());
  const search = document.createElement("input");
  search.type = "text";
  search.value = opts.search;
  search.placeholder = "Search entities";
  search.addEventListener("input", () => opts.onSearch(search.value));
  searchWrap.append(search);
  root.append(searchWrap);
  root.append(divider());

  const q = opts.search.trim().toLowerCase();
  const filtered = opts.entities.filter(
    (e) => !q || e.name.toLowerCase().includes(q),
  );
  const body = scrollBody();
  if (!opts.entities.length) {
    body.append(
      h(
        "p",
        "No entities yet. Add one to start mapping the data model.",
        "ifp-muted ifp-empty",
      ),
    );
  } else if (!filtered.length) {
    const none = document.createElement("div");
    none.className = "ifp-noresults";
    none.append(h("div", `No entities match “${opts.search}”`, "ifp-noresults-text"));
    const clear = document.createElement("button");
    clear.className = "ifp-clear";
    clear.textContent = "Clear search";
    clear.addEventListener("click", () => opts.onSearch(""));
    none.append(clear);
    body.append(none);
  } else {
    const rows = document.createElement("div");
    rows.className = "ifp-rows";
    for (const e of filtered) {
      rows.append(entityRow(e, () => opts.onSelectEntity(e.id), false));
    }
    body.append(rows);
  }
  root.append(body);

  if (relCount(opts)) {
    root.append(
      h("div", `${relCount(opts)} relation${relCount(opts) === 1 ? "" : "s"}`, "ifp-foot"),
    );
  }
}

const relCount = (opts: EntityPanelHandlers): number => opts.relations.length;

/** An entity roster row: accent dot, name + field count, and its field total. */
function entityRow(
  entity: Entity,
  onClick: () => void,
  relating: boolean,
): HTMLElement {
  const rowEl = document.createElement("div");
  rowEl.className = relating ? "ifp-row ifp-row-link" : "ifp-row";
  rowEl.addEventListener("click", onClick);
  rowEl.append(accentDot());
  const meta = document.createElement("div");
  meta.className = "ifp-row-meta";
  meta.append(h("div", entity.name || entity.id, "ifp-row-name"));
  meta.append(
    h(
      "div",
      `${entity.fields.length} field${entity.fields.length === 1 ? "" : "s"}`,
      "ifp-row-tech",
    ),
  );
  rowEl.append(meta, h("span", String(entity.fields.length), "ifp-row-count"));
  return rowEl;
}

/** RELATE mode: guidance, exit, the live relation list, and a pickable roster. */
function renderRelateMode(root: HTMLElement, opts: EntityPanelHandlers): void {
  const body = scrollBody();

  const status = document.createElement("div");
  status.className = "ifp-linkstatus";
  status.append(
    h("span", "", "ifp-dot ifp-dot-accent"),
    h("span", "Relate mode active", "ifp-linkstatus-text"),
  );
  body.append(status);

  const guidance = opts.relateSourceName
    ? `Now click a target entity to relate it to “${opts.relateSourceName}”.`
    : "Click an entity on the canvas or in the list below to start a relation.";
  body.append(h("p", guidance, "ifp-guidance"));

  const exit = document.createElement("button");
  exit.className = "ifp-exit";
  exit.append(document.createTextNode("Exit relate mode "), h("span", "· Esc", "ifp-kbd"));
  exit.addEventListener("click", opts.onToggleRelate);
  body.append(exit);

  body.append(sectionLabel(`Relations · ${opts.relations.length}`));
  const list = document.createElement("div");
  list.className = "ifp-edgelist";
  if (!opts.relations.length) {
    list.append(h("p", "No relations yet.", "ifp-muted"));
  }
  for (const r of opts.relations) {
    const rowEl = document.createElement("div");
    rowEl.className = "ifp-edgerow";
    rowEl.append(
      h("span", `${opts.entityName(r.from)} → ${opts.entityName(r.to)}`, "ifp-edgerow-text"),
    );
    if (opts.canUnrelate) {
      const del = document.createElement("button");
      del.className = "ifp-edgedel";
      del.title = "Remove relation";
      del.textContent = "✕";
      del.addEventListener("click", () => opts.onRemoveRelationById(r.id));
      rowEl.append(del);
    }
    list.append(rowEl);
  }
  body.append(list);

  // Entities stay clickable while relating, so drive endpoint picks from here too.
  body.append(sectionLabel("Entities"));
  const rows = document.createElement("div");
  rows.className = "ifp-rows";
  for (const e of opts.entities) {
    rows.append(entityRow(e, () => opts.onSelectEntity(e.id), true));
  }
  body.append(rows);
  root.append(body);
}

/** ENTITY detail: back link, name/notes, the fields editor, and remove. */
function renderEntityEditor(root: HTMLElement, opts: EntityPanelHandlers): void {
  const entity = opts.entity;
  if (!entity) return;
  const ro = !opts.canEdit;
  const body = scrollBody();

  const back = document.createElement("button");
  back.className = "ifp-back";
  back.append(h("span", "←", "ifp-back-arrow"), h("span", "All entities", ""));
  back.addEventListener("click", () => opts.onSelectEntity(null));
  body.append(back);

  body.append(
    fieldCell("Name", textInput(entity.name, (v) => opts.onChangeEntity({ name: v }), ro)),
  );

  const notes = document.createElement("textarea");
  notes.className = "fld-textarea";
  notes.rows = 3;
  notes.value = entity.description;
  notes.disabled = ro;
  notes.placeholder = "What this table holds, invariants…";
  notes.addEventListener("change", () => opts.onChangeEntity({ description: notes.value }));
  body.append(fieldCell("Notes", notes));

  body.append(divider());

  // --- fields editor ---
  body.append(sectionLabel(`Fields · ${entity.fields.length}`));
  entity.fields.forEach((field, i) => {
    body.append(
      fieldRow(
        field,
        ro,
        (next) => {
          const fields = entity.fields.map((f, j) => (j === i ? next : f));
          opts.onChangeEntity({ fields });
        },
        () => {
          const fields = entity.fields.filter((_, j) => j !== i);
          opts.onChangeEntity({ fields });
        },
      ),
    );
  });
  if (!entity.fields.length) {
    body.append(h("p", "No fields yet.", "ifp-muted"));
  }
  if (opts.canEdit) {
    const add = document.createElement("button");
    add.className = "ifp-addsub";
    add.textContent = "+ Add field";
    add.addEventListener("click", () => {
      const fields: EntityField[] = [
        ...entity.fields,
        { name: "field", type: "", keys: [] },
      ];
      opts.onChangeEntity({ fields });
    });
    body.append(add);
  }

  if (opts.canEdit) {
    body.append(divider());
    const remove = document.createElement("button");
    remove.className = "ifp-danger";
    remove.textContent = "Delete entity";
    remove.addEventListener("click", opts.onRemoveEntity);
    body.append(remove);
  }
  root.append(body);
}

/** One editable field row: name, type, PK/FK/UK keys, note, and a remove button. */
function fieldRow(
  field: EntityField,
  readOnly: boolean,
  onChange: (next: EntityField) => void,
  onRemove: () => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "entity-field-row";

  const name = document.createElement("input");
  name.type = "text";
  name.value = field.name;
  name.placeholder = "name";
  name.disabled = readOnly;
  name.addEventListener("change", () => onChange({ ...field, name: name.value }));

  const type = document.createElement("input");
  type.type = "text";
  type.value = field.type;
  type.placeholder = "type";
  type.disabled = readOnly;
  type.addEventListener("change", () => onChange({ ...field, type: type.value }));

  const top = document.createElement("div");
  top.className = "entity-field-top";
  top.append(name, type);
  if (!readOnly) {
    const del = document.createElement("button");
    del.className = "entity-field-del";
    del.title = "Remove field";
    del.textContent = "✕";
    del.addEventListener("click", onRemove);
    top.append(del);
  }
  wrap.append(top);

  // Key roles as a small set of toggles, validated by construction.
  const keys = document.createElement("div");
  keys.className = "entity-field-keys";
  for (const k of EntityKey.options) {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = field.keys.includes(k);
    cb.disabled = readOnly;
    cb.addEventListener("change", () => {
      const set = new Set(field.keys);
      if (cb.checked) set.add(k);
      else set.delete(k);
      onChange({ ...field, keys: EntityKey.options.filter((o) => set.has(o)) });
    });
    lab.append(cb, document.createTextNode(k));
    keys.append(lab);
  }
  wrap.append(keys);

  const note = document.createElement("input");
  note.type = "text";
  note.className = "entity-field-note";
  note.value = field.note ?? "";
  note.placeholder = "note (optional)";
  note.disabled = readOnly;
  note.addEventListener("change", () =>
    onChange({ ...field, note: note.value || undefined }),
  );
  wrap.append(note);
  return wrap;
}

/** RELATION detail: back link, endpoints' cardinality, verb, identifying, remove. */
function renderRelationEditor(root: HTMLElement, opts: EntityPanelHandlers): void {
  const r = opts.relation;
  if (!r) return;
  const ro = !opts.canRelate;
  const body = scrollBody();

  const back = document.createElement("button");
  back.className = "ifp-back";
  back.append(h("span", "←", "ifp-back-arrow"), h("span", "All entities", ""));
  back.addEventListener("click", () => opts.onSelectRelation(null));
  body.append(back);

  body.append(sectionLabel("Relation"));
  body.append(
    h("p", `${opts.entityName(r.from)} → ${opts.entityName(r.to)}`, "ifp-muted"),
  );

  body.append(
    fieldCell(
      `From — ${opts.entityName(r.from)}`,
      selectInput(
        r.fromCardinality,
        RelationCardinality.options,
        (v) => opts.onChangeRelation({ fromCardinality: v as EntityRelation["fromCardinality"] }),
        ro,
        (v) => CARDINALITY_LABELS[v as EntityRelation["fromCardinality"]],
      ),
    ),
  );
  body.append(
    fieldCell(
      `To — ${opts.entityName(r.to)}`,
      selectInput(
        r.toCardinality,
        RelationCardinality.options,
        (v) => opts.onChangeRelation({ toCardinality: v as EntityRelation["toCardinality"] }),
        ro,
        (v) => CARDINALITY_LABELS[v as EntityRelation["toCardinality"]],
      ),
    ),
  );
  body.append(
    fieldCell(
      "Verb",
      textInput(r.label ?? "", (v) => opts.onChangeRelation({ label: v || undefined }), ro),
    ),
  );

  const check = document.createElement("label");
  check.className = "ifp-check";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = r.identifying;
  cb.disabled = ro;
  cb.addEventListener("change", () => opts.onChangeRelation({ identifying: cb.checked }));
  check.append(cb, document.createTextNode("Identifying (solid line)"));
  body.append(check);

  if (opts.canRelate) {
    body.append(divider());
    const remove = document.createElement("button");
    remove.className = "ifp-danger";
    remove.textContent = "Delete relation";
    remove.addEventListener("click", opts.onRemoveRelation);
    body.append(remove);
  }
  root.append(body);
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
  onDocument?: (binding: ApiBinding) => void,
): void {
  const b = el.apiBinding;

  if (!b) {
    // Floating-label affordance: a "+" chip beside an uppercase action label.
    const add = document.createElement("button");
    add.type = "button";
    add.className = "doc-add-row";
    const plus = h("span", "+", "doc-add-plus");
    const label = h("span", "Add documentation", "doc-add-label");
    add.append(plus, label);
    add.addEventListener("click", () =>
      onChange({
        apiBinding: { title: el.name || el.id, description: "" },
      }),
    );
    const hint = h(
      "p",
      "Add it here, or from VS Code via “Document API on Design Element”.",
      "empty",
    );
    root.append(add, hint);
    return;
  }

  // Merge a single field into the existing binding and push it back up.
  const set = (patch: Partial<ApiBinding>) =>
    onChange({ apiBinding: { ...b, ...patch } });

  // Docs-first: the title + free-form Markdown body carry the meaning, and work
  // for any kind of binding (REST, GraphQL, gRPC, CLI, a background job…). We keep
  // references to the live inputs so the "Save documentation" button can read the
  // current text directly — even text the user hasn't blurred out of yet.
  const titleInput = textInput(b.title, (v) => set({ title: v }));
  root.append(row("Title", titleInput));
  const docsInput = document.createElement("textarea");
  docsInput.rows = 8;
  docsInput.value = b.description;
  docsInput.placeholder =
    "Free-form Markdown — describe the endpoint, behaviour, examples…";
  docsInput.addEventListener("change", () => set({ description: docsInput.value }));
  const docsDiv = document.createElement("div");
  docsDiv.className = "row row-stack";
  const docsLabel = document.createElement("label");
  docsLabel.textContent = "Docs";
  docsDiv.append(docsLabel, docsInput);
  root.append(docsDiv);

  // Explicit "Save documentation" — commits the current binding as a new entry in
  // the version history (and so the History timeline's API tab). Only shown when
  // the source can record history (`onDocument` provided).
  if (onDocument) {
    const save = document.createElement("button");
    save.type = "button";
    save.className = "doc-save";
    save.textContent = "Save documentation";
    // preventDefault on mousedown keeps the textarea focused, so its `change`
    // doesn't fire a panel rebuild between mousedown and click (which would drop
    // this handler). We then read the live values straight off the inputs.
    save.addEventListener("mousedown", (e) => e.preventDefault());
    save.addEventListener("click", () => {
      onDocument({
        ...b,
        title: titleInput.value.trim() || el.name || el.id,
        description: docsInput.value,
      });
    });
    root.append(save);
  }

  const remove = document.createElement("button");
  remove.className = "doc-remove";
  remove.textContent = "Remove documentation";
  remove.addEventListener("click", () => onChange({ apiBinding: undefined }));
  root.append(remove);
}

/**
 * "From code": where a generated draft came from, and the Adopt action. A
 * draft stays in step with the frontend on re-import until someone edits or
 * adopts it; adopting makes it an ordinary, designer-owned element.
 */
function fromCodeSection(
  origin: NonNullable<DesignElement["origin"]>,
  onAdopt?: () => void,
): HTMLElement {
  const sec = section("From code");
  sec.classList.add("from-code");
  const rows: Array<[string, string | undefined]> = [
    ["Route", origin.viewport ? `${origin.route} · ${origin.viewport}` : origin.route],
    ["Component", origin.component],
    ["Source", origin.source],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = document.createElement("div");
    row.className = "from-code-row";
    row.append(h("span", label, "from-code-label"), h("span", value, "from-code-value"));
    sec.append(row);
  }
  sec.append(
    h(
      "p",
      "A draft generated from the running frontend. Re-importing updates it until it is edited or adopted. Deleting it keeps it from coming back.",
      "from-code-note",
    ),
  );
  if (onAdopt) {
    const adopt = document.createElement("button");
    adopt.type = "button";
    adopt.className = "doc-save";
    adopt.textContent = "Adopt draft";
    adopt.title = "Make this a designer-owned element; code imports will no longer update it";
    adopt.addEventListener("click", onAdopt);
    sec.append(adopt);
  }
  return sec;
}

// ---- builders -----------------------------------------------------------
function h(tag: string, content: string, cls = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (cls) node.className = cls;
  return node;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const div = document.createElement("div");
  div.className = "row";
  const l = document.createElement("label");
  l.textContent = label;
  div.append(l, control);
  return div;
}

/** A bare numeric `<input>` — shared by the left-label `row()` builders and the
 * floating-label `fieldCell()` cells, so both stay in sync. */
function numInput(value: number, onChange: (v: number) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(Math.round(value));
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (!Number.isNaN(n)) onChange(n);
  });
  return input;
}

// ---- floating-label cells (the design-panel layout) ---------------------
/** A floating-label field: a small uppercase label sitting above its control.
 * Block-level by default (full width); becomes a grid cell inside `fieldGrid`. */
function fieldCell(label: string, control: HTMLElement): HTMLElement {
  const div = document.createElement("div");
  div.className = "fld";
  const l = document.createElement("label");
  l.textContent = label;
  div.append(l, control);
  return div;
}

/** Lay field cells out in a 2-col grid (or 4-col when `four`). */
function fieldGrid(cells: HTMLElement[], four = false): HTMLElement {
  const div = document.createElement("div");
  div.className = four ? "fld-grid fld-grid-4" : "fld-grid";
  div.append(...cells);
  return div;
}

/** A numeric floating-label cell. */
function numField(
  label: string,
  value: number,
  onChange: (v: number) => void,
): HTMLElement {
  return fieldCell(label, numInput(value, onChange));
}

/** Panel header: a generic element glyph chip + the element name and its type. */
function inspectorHeader(el: DesignElement, onClose?: () => void): HTMLElement {
  const head = document.createElement("div");
  head.className = "insp-head";
  const chip = document.createElement("div");
  chip.className = "insp-chip";
  const glyph = document.createElement("span");
  glyph.className = "insp-glyph";
  chip.append(glyph);
  const meta = document.createElement("div");
  meta.className = "insp-meta";
  meta.append(h("div", el.name || el.id, "insp-name"));
  meta.append(h("div", el.type.charAt(0).toUpperCase() + el.type.slice(1), "insp-type"));
  head.append(chip, meta);
  if (onClose) head.append(inspectorCloseButton(onClose));
  return head;
}

/** Header for the empty (no selection) state — just the ✕ close button so the
 * inspector can still be dismissed when nothing is selected. */
function emptyHeader(onClose: () => void): HTMLElement {
  const head = document.createElement("div");
  head.className = "insp-head insp-head-empty";
  head.append(inspectorCloseButton(onClose));
  return head;
}

/** The ✕ button that closes the inspector drawer, pinned to the header's right. */
function inspectorCloseButton(onClose: () => void): HTMLButtonElement {
  const close = document.createElement("button");
  close.type = "button";
  close.className = "insp-close";
  close.title = "Close inspector";
  close.textContent = "✕";
  close.addEventListener("click", onClose);
  return close;
}

type StyleObj = NonNullable<DesignElement["style"]>;
type CornerKey = "tl" | "tr" | "br" | "bl";
type SideKey = "top" | "right" | "bottom" | "left";

/** A small square expand/collapse toggle that sits beside a field's input. */
function fldToggle(active: boolean, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = active ? "fld-toggle active" : "fld-toggle";
  b.title = title;
  b.textContent = "⊞";
  return b;
}

/**
 * Border-width control rendered as two parts: the "Border W" field cell (a
 * uniform width input + an expand toggle) that drops into the Style grid, and a
 * separate per-side T/R/B/L grid placed below it. Expanding seeds the four
 * sides from the uniform width; collapsing clears them back to uniform. A live
 * accumulator keeps multiple side edits from clobbering each other between the
 * (non-re-rendering) onChange calls.
 */
function borderControl(
  style: StyleObj,
  onChange: (patch: Partial<DesignElement>) => void,
): { cell: HTMLElement; grid: HTMLElement } {
  const base = style.strokeWidth ?? 0;
  const live: Partial<Record<SideKey, number>> = { ...(style.strokeWidths ?? {}) };
  const perSide = Object.keys(live).length > 0;

  const input = numInput(base, (v) =>
    onChange({ style: { ...style, strokeWidth: v, strokeWidths: undefined } }),
  );
  const toggle = fldToggle(perSide, "Per-side border width");
  const ctl = document.createElement("div");
  ctl.className = "fld-inline";
  ctl.append(input, toggle);
  const cell = fieldCell("Border W", ctl);

  const sideLabels: Array<[SideKey, string]> = [
    ["top", "T"],
    ["right", "R"],
    ["bottom", "B"],
    ["left", "L"],
  ];
  const grid = fieldGrid(
    sideLabels.map(([key, label]) =>
      numField(label, live[key] ?? base, (v) => {
        live[key] = v;
        onChange({ style: { ...style, strokeWidths: { ...live } } });
      }),
    ),
    true,
  );
  grid.hidden = !perSide;

  toggle.addEventListener("click", () => {
    const show = grid.hidden;
    if (show && Object.keys(live).length === 0) {
      live.top = live.right = live.bottom = live.left = base; // seed from uniform
      onChange({ style: { ...style, strokeWidths: { ...live } } });
    } else if (!show) {
      for (const k of Object.keys(live) as SideKey[]) delete live[k];
      onChange({ style: { ...style, strokeWidths: undefined } }); // back to uniform
    }
    grid.hidden = !show;
    toggle.classList.toggle("active", show);
  });

  return { cell, grid };
}

/**
 * Corner-radius section: a header with a "Linked" toggle, an "All corners"
 * uniform field, and a per-corner TL/TR/BL/BR grid shown only when unlinked.
 * Linked = uniform (`radii` cleared, every corner follows `radius`); unlinking
 * seeds the four corners from the uniform value so they can diverge. A live
 * accumulator keeps multiple corner edits from clobbering each other between the
 * (non-re-rendering) onChange calls.
 */
function radiusSection(
  style: StyleObj,
  onChange: (patch: Partial<DesignElement>) => void,
): HTMLElement {
  const base = style.radius ?? 0;
  const live: Partial<Record<CornerKey, number>> = { ...(style.radii ?? {}) };
  let linked = Object.keys(live).length === 0;

  const sec = document.createElement("div");
  sec.className = "insp-section";

  const head = document.createElement("div");
  head.className = "insp-sec-head";
  head.append(h("span", "Corner radius", "insp-sec-label"));
  const link = document.createElement("button");
  link.type = "button";
  link.className = linked ? "insp-link active" : "insp-link";
  link.title = "Link all corners";
  const box = document.createElement("span");
  box.className = "insp-link-box";
  link.append(h("span", "Linked", "insp-link-text"), box);
  head.append(link);
  sec.append(head);

  // All-corners uniform field. While linked it also clears any overrides.
  sec.append(
    numField("All corners", base, (v) =>
      onChange({ style: { ...style, radius: v, ...(linked ? { radii: undefined } : {}) } }),
    ),
  );

  const grid = fieldGrid(
    (["tl", "tr", "bl", "br"] as CornerKey[]).map((key) =>
      numField(key.toUpperCase(), live[key] ?? base, (v) => {
        live[key] = v;
        onChange({ style: { ...style, radii: { ...live } } });
      }),
    ),
    true,
  );
  grid.hidden = linked;
  sec.append(grid);

  link.addEventListener("click", () => {
    linked = !linked;
    if (linked) {
      for (const k of Object.keys(live) as CornerKey[]) delete live[k];
      onChange({ style: { ...style, radii: undefined } });
    } else {
      live.tl = live.tr = live.bl = live.br = base; // seed from uniform
      onChange({ style: { ...style, radii: { ...live } } });
    }
    grid.hidden = linked;
    link.classList.toggle("active", linked);
  });

  return sec;
}

function textInput(
  value: string,
  onChange: (v: string) => void,
  readOnly = false,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.disabled = readOnly;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

/** A multiline `<textarea>` sized for the floating-label cells — used for the
 * design Text field so `\n`s can be entered. Grows to fit its content. */
function textAreaInput(
  value: string,
  onChange: (v: string) => void,
  readOnly = false,
): HTMLTextAreaElement {
  const ta = document.createElement("textarea");
  ta.className = "fld-textarea";
  ta.rows = Math.min(Math.max(value.split("\n").length, 1), 6);
  ta.value = value;
  ta.disabled = readOnly;
  ta.addEventListener("change", () => onChange(ta.value));
  return ta;
}

/** Normalize a stored color to the `#rrggbb` a native color input requires;
 * returns null for empty/unparseable values (e.g. named colors) so the swatch
 * can fall back without clobbering the text the user typed. */
function toHexColor(v: string): string | null {
  const s = v.trim();
  const six = /^#([0-9a-f]{6})$/i.exec(s);
  if (six?.[1]) return `#${six[1].toLowerCase()}`;
  const three = /^#([0-9a-f]{3})$/i.exec(s);
  if (three?.[1]) {
    const g = three[1];
    return `#${g[0]}${g[0]}${g[1]}${g[1]}${g[2]}${g[2]}`.toLowerCase();
  }
  return null;
}

/** A color field: a native swatch picker paired with a hex text input. The text
 * stays the source of truth (so any CSS color string is still allowed), and the
 * two stay in sync — picking updates the text, typing a valid hex updates the
 * swatch. */
function colorField(value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "color-field";

  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.className = "color-swatch";
  swatch.value = toHexColor(value) ?? "#000000";

  const text = document.createElement("input");
  text.type = "text";
  text.className = "color-text";
  text.value = value;

  swatch.addEventListener("input", () => {
    text.value = swatch.value;
    onChange(swatch.value);
  });
  text.addEventListener("input", () => {
    const hex = toHexColor(text.value);
    if (hex) swatch.value = hex;
  });
  text.addEventListener("change", () => onChange(text.value));

  wrap.append(swatch, text);
  return wrap;
}

/** Font families offered for text elements; the empty value is the canvas
 * default. Values are valid CSS font-family stacks so the canvas can apply them
 * directly. */
const FONT_FAMILIES: ReadonlyArray<{ label: string; value: string }> = [
  // Empty value = the canvas default (--sans, Space Grotesk); labelled with the
  // real font name so the picker shows what's actually rendered.
  { label: "Space Grotesk", value: "" },
  { label: "System Sans", value: "system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'SF Mono', ui-monospace, 'Courier New', monospace" },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
];

/** A font-family picker: each option previews itself in its own typeface. */
function fontFamilySelect(
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const select = document.createElement("select");
  for (const f of FONT_FAMILIES) {
    const o = document.createElement("option");
    o.value = f.value;
    o.textContent = f.label;
    // Preview each option in its own typeface; the default falls back to --sans.
    o.style.fontFamily = f.value || "var(--sans)";
    if (f.value === value) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function selectInput(
  value: string,
  options: readonly string[],
  onChange: (v: string) => void,
  readOnly = false,
  optionLabel?: (v: string) => string,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.disabled = readOnly;
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = optionLabel ? optionLabel(opt) : opt || "—";
    if (opt === value) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
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
