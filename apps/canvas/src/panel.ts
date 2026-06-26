import {
  type ApiBinding,
  type DesignElement,
  type Entity,
  type EntityField,
  EntityKey,
  type EntityRelation,
  HttpMethod,
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
): void {
  root.replaceChildren();
  if (!el) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Select or draw an element.";
    root.append(p);
    return;
  }

  // --- header: type chip + name + type subtitle ---
  root.append(inspectorHeader(el));

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
  if (el.type === "text" || el.text !== undefined) {
    styleSec.append(
      fieldCell("Text", textInput(el.text ?? "", (v) => onChange({ text: v }))),
    );
  }
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
  root.append(styleSec);

  // --- Corner radius (Linked toggle + all-corners + per-corner grid) ---
  root.append(radiusSection(style, onChange));

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

/** Callbacks + state the infra drawer needs from the editor. */
export interface InfraPanelHandlers {
  /** Source can persist nodes (otherwise the drawer is read-only). */
  canEdit: boolean;
  /** Source can persist edges. */
  canLink: boolean;
  /** Link tool armed (waiting for two node clicks). */
  linking: boolean;
  /** The currently selected infra node, if any. */
  node: InfraNode | undefined;
  onAddNode(): void;
  onToggleLink(): void;
  onChangeNode(patch: Partial<InfraNode>): void;
  onRemoveNode(): void;
}

/**
 * The right-hand drawer for infrastructure mode — the infra analogue of
 * `renderPanel`. Top: add-node / link actions. Below: an editor for the selected
 * node (name, kind, tech, notes) and a remove button. Mirrors the design panel's
 * builders so the two drawers look and behave the same.
 */
export function renderInfraPanel(
  root: HTMLElement,
  opts: InfraPanelHandlers,
): void {
  root.replaceChildren();
  root.append(h("h2", "Infrastructure"));
  root.append(
    h("p", "Add nodes, link them, and drag to arrange the architecture.", "empty"),
  );

  const actions = document.createElement("div");
  actions.className = "infra-actions";
  if (opts.canEdit) {
    const add = document.createElement("button");
    add.className = "doc-add";
    add.textContent = "+ Add node";
    add.addEventListener("click", opts.onAddNode);
    actions.append(add);
  }
  if (opts.canLink) {
    const link = document.createElement("button");
    link.className = opts.linking ? "doc-add active" : "doc-add";
    link.textContent = opts.linking
      ? "Linking… click two nodes (Esc to cancel)"
      : "Link nodes";
    link.addEventListener("click", opts.onToggleLink);
    actions.append(link);
  }
  root.append(actions);

  const node = opts.node;
  if (!node) {
    root.append(
      h("p", "Select a node to edit its details, or add one above.", "empty"),
    );
    return;
  }

  root.append(h("h2", node.label || node.id));
  root.append(h("p", node.kind, "empty"));

  const sec = section("Node");
  const ro = !opts.canEdit;
  sec.append(textRow("Name", node.label, (v) => opts.onChangeNode({ label: v }), ro));
  sec.append(
    selectRow(
      "Kind",
      node.kind,
      InfraKind.options,
      (v) => opts.onChangeNode({ kind: v as InfraNode["kind"] }),
      ro,
    ),
  );
  sec.append(
    textRow("Tech", node.tech ?? "", (v) => opts.onChangeNode({ tech: v || undefined }), ro),
  );
  sec.append(
    textareaRow(
      "Notes",
      node.description,
      (v) => opts.onChangeNode({ description: v }),
      5,
      "Role in the system, config, gotchas…",
      ro,
    ),
  );
  root.append(sec);

  if (opts.canEdit) {
    const remove = document.createElement("button");
    remove.className = "doc-remove";
    remove.textContent = "Remove node";
    remove.addEventListener("click", opts.onRemoveNode);
    root.append(remove);
  }
}

/** Callbacks + state the ER (data-model) drawer needs from the editor. */
export interface EntityPanelHandlers {
  /** Source can persist entities (otherwise the drawer is read-only). */
  canEdit: boolean;
  /** Source can persist relations. */
  canRelate: boolean;
  /** Relate tool armed (waiting for two entity clicks). */
  relating: boolean;
  /** The currently selected entity, if any. */
  entity: Entity | undefined;
  /** The currently selected relation, if any. */
  relation: EntityRelation | undefined;
  /** Resolve an entity id to its display name (for the relation editor). */
  entityName(id: string): string;
  onAddEntity(): void;
  onToggleRelate(): void;
  onChangeEntity(patch: Partial<Entity>): void;
  onRemoveEntity(): void;
  onChangeRelation(patch: Partial<EntityRelation>): void;
  onRemoveRelation(): void;
}

/** Human labels for the crow's-foot multiplicities (the enum values are terse). */
const CARDINALITY_LABELS: Record<EntityRelation["fromCardinality"], string> = {
  "zero-or-one": "Zero or one (0..1)",
  "exactly-one": "Exactly one (1)",
  "zero-or-many": "Zero or many (*)",
  "one-or-many": "One or many (1..*)",
};

/**
 * The right-hand drawer for ER (data-model) mode — the data-model analogue of
 * `renderInfraPanel`. Top: add-entity / relate actions. Below: an editor for the
 * selected entity (name, its fields, notes) or the selected relation (endpoints,
 * per-end cardinality, verb, identifying). Mirrors the other drawers' builders.
 */
export function renderEntityPanel(
  root: HTMLElement,
  opts: EntityPanelHandlers,
): void {
  root.replaceChildren();
  root.append(h("h2", "Data model"));
  root.append(
    h("p", "Add entities, relate them, and drag to arrange the ER diagram.", "empty"),
  );

  const actions = document.createElement("div");
  actions.className = "infra-actions";
  if (opts.canEdit) {
    const add = document.createElement("button");
    add.className = "doc-add";
    add.textContent = "+ Add entity";
    add.addEventListener("click", opts.onAddEntity);
    actions.append(add);
  }
  if (opts.canRelate) {
    const relate = document.createElement("button");
    relate.className = opts.relating ? "doc-add active" : "doc-add";
    relate.textContent = opts.relating
      ? "Relating… click two entities (Esc to cancel)"
      : "Relate entities";
    relate.addEventListener("click", opts.onToggleRelate);
    actions.append(relate);
  }
  root.append(actions);

  if (opts.relation) {
    renderRelationEditor(root, opts);
    return;
  }
  if (opts.entity) {
    renderEntityEditor(root, opts);
    return;
  }
  root.append(
    h("p", "Select an entity or relation to edit, or add one above.", "empty"),
  );
}

/** Editor for the selected entity: name, its fields (add/remove/edit), notes. */
function renderEntityEditor(root: HTMLElement, opts: EntityPanelHandlers): void {
  const entity = opts.entity;
  if (!entity) return;
  const ro = !opts.canEdit;

  root.append(h("h2", entity.name || entity.id));
  root.append(h("p", `${entity.fields.length} field${entity.fields.length === 1 ? "" : "s"}`, "empty"));

  const sec = section("Entity");
  sec.append(textRow("Name", entity.name, (v) => opts.onChangeEntity({ name: v }), ro));
  sec.append(
    textareaRow(
      "Notes",
      entity.description,
      (v) => opts.onChangeEntity({ description: v }),
      4,
      "What this table holds, invariants…",
      ro,
    ),
  );
  root.append(sec);

  // --- fields editor ---
  const fieldsSec = section("Fields");
  entity.fields.forEach((field, i) => {
    fieldsSec.append(fieldRow(field, ro, (next) => {
      const fields = entity.fields.map((f, j) => (j === i ? next : f));
      opts.onChangeEntity({ fields });
    }, () => {
      const fields = entity.fields.filter((_, j) => j !== i);
      opts.onChangeEntity({ fields });
    }));
  });
  if (!entity.fields.length) {
    fieldsSec.append(h("p", "No fields yet.", "empty"));
  }
  if (opts.canEdit) {
    const add = document.createElement("button");
    add.className = "doc-add";
    add.textContent = "+ Add field";
    add.addEventListener("click", () => {
      const fields: EntityField[] = [
        ...entity.fields,
        { name: "field", type: "", keys: [] },
      ];
      opts.onChangeEntity({ fields });
    });
    fieldsSec.append(add);
  }
  root.append(fieldsSec);

  if (opts.canEdit) {
    const remove = document.createElement("button");
    remove.className = "doc-remove";
    remove.textContent = "Remove entity";
    remove.addEventListener("click", opts.onRemoveEntity);
    root.append(remove);
  }
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

/** Editor for the selected relation: endpoints, per-end cardinality, verb, line. */
function renderRelationEditor(root: HTMLElement, opts: EntityPanelHandlers): void {
  const r = opts.relation;
  if (!r) return;
  const ro = !opts.canRelate;

  root.append(h("h2", "Relation"));
  root.append(
    h("p", `${opts.entityName(r.from)} → ${opts.entityName(r.to)}`, "empty"),
  );

  const sec = section("Relation");
  sec.append(
    selectRow(
      `From (${opts.entityName(r.from)})`,
      r.fromCardinality,
      RelationCardinality.options,
      (v) => opts.onChangeRelation({ fromCardinality: v as EntityRelation["fromCardinality"] }),
      ro,
      (v) => CARDINALITY_LABELS[v as EntityRelation["fromCardinality"]],
    ),
  );
  sec.append(
    selectRow(
      `To (${opts.entityName(r.to)})`,
      r.toCardinality,
      RelationCardinality.options,
      (v) => opts.onChangeRelation({ toCardinality: v as EntityRelation["toCardinality"] }),
      ro,
      (v) => CARDINALITY_LABELS[v as EntityRelation["toCardinality"]],
    ),
  );
  sec.append(
    textRow("Verb", r.label ?? "", (v) => opts.onChangeRelation({ label: v || undefined }), ro),
  );
  sec.append(
    checkboxRow(
      "Identifying (solid line)",
      r.identifying,
      (v) => opts.onChangeRelation({ identifying: v }),
      ro,
    ),
  );
  root.append(sec);

  if (opts.canRelate) {
    const remove = document.createElement("button");
    remove.className = "doc-remove";
    remove.textContent = "Remove relation";
    remove.addEventListener("click", opts.onRemoveRelation);
    root.append(remove);
  }
}

/** A labelled checkbox row, matching the other row builders. */
function checkboxRow(
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
  readOnly = false,
): HTMLElement {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = value;
  cb.disabled = readOnly;
  cb.addEventListener("change", () => onChange(cb.checked));
  return row(label, cb);
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
    // Floating-label affordance: a "+" chip beside an uppercase action label.
    const add = document.createElement("button");
    add.type = "button";
    add.className = "doc-add-row";
    const plus = h("span", "+", "doc-add-plus");
    const label = h("span", "Add documentation", "doc-add-label");
    add.append(plus, label);
    add.addEventListener("click", () =>
      onChange({
        apiBinding: { title: el.name || el.id, description: "", parameters: [] },
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
function inspectorHeader(el: DesignElement): HTMLElement {
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
  return head;
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

function textRow(
  label: string,
  value: string,
  onChange: (v: string) => void,
  readOnly = false,
): HTMLElement {
  return row(label, textInput(value, onChange, readOnly));
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

function selectRow(
  label: string,
  value: string,
  options: readonly string[],
  onChange: (v: string) => void,
  readOnly = false,
  optionLabel?: (v: string) => string,
): HTMLElement {
  return row(label, selectInput(value, options, onChange, readOnly, optionLabel));
}

function textareaRow(
  label: string,
  value: string,
  onChange: (v: string) => void,
  rows = 4,
  placeholder = "",
  readOnly = false,
): HTMLElement {
  const ta = document.createElement("textarea");
  ta.rows = rows;
  ta.value = value;
  ta.disabled = readOnly;
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
