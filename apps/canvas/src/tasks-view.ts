import { buildGanttModel, type GanttModel, type Task, type TaskStatus } from "forward-core";

/**
 * The project task tracker (pillar 4): one overlay panel that lists the
 * project's work items grouped by status, and ties each task to what it's about
 * via its optional links (a design element, an infra flow, a documented
 * endpoint). When an element or flow is selected on the canvas, the panel can
 * filter to just the tasks linked to it — the "link-driven" view — and new tasks
 * are pre-linked to that selection.
 *
 * Two layouts: the List, and the Timeline — the same tasks on a calendar (the
 * Gantt), laid out by forward-core's `buildGanttModel` so it matches the Mermaid
 * export and the `get_task_timeline` agent tool. On a read-only source (the
 * static export) both render without any write control.
 *
 * This module only draws; the source-of-truth lives on the server and the writes
 * go back through the CanvasSource via the callbacks.
 */

/** Which layout the panel shows. */
export type TasksMode = "list" | "timeline";

export interface TaskFocus {
  /** The selected design element id, if any. */
  elementId?: string;
  /** The selected infra flow id, if any. */
  flowId?: string;
  /** Human label for the current selection (for the filter row + create hint). */
  label?: string;
}

export interface TasksContext {
  focus: TaskFocus;
  /** Whether the list is filtered to tasks linked to the current focus. */
  filterLinked: boolean;
  /** Resolve a design element id to a display name (for link chips). */
  elementName: (id: string) => string | undefined;
  /** Resolve an infra flow id to a display name (for link chips). */
  flowName: (id: string) => string | undefined;
  mode: TasksMode;
  /** The source can't persist tasks: show them, offer no write control. */
  readOnly: boolean;
  /** The viewer's today, `YYYY-MM-DD`, marked on the timeline. */
  today: string;
}

export interface TasksCallbacks {
  onClose: () => void;
  onSetMode: (mode: TasksMode) => void;
  onToggleFilter: () => void;
  /** Create a task; the panel supplies title + the focus links it derives. */
  onCreate: (input: {
    title: string;
    elementId?: string;
    flowId?: string;
  }) => void;
  onChangeStatus: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
  /** Select the linked design element on the canvas. */
  onSelectElement: (elementId: string) => void;
  /** Clear a now-dangling link off a task (the repair for a stale chip). */
  onClearLink: (taskId: string, field: TaskLinkField) => void;
}

/** The optional cross-layer link fields a task can carry. */
export type TaskLinkField = "elementId" | "flowId" | "endpointId";

const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/** Next status in the cycle, so a single click advances a card. */
function nextStatus(s: TaskStatus): TaskStatus {
  const i = STATUS_ORDER.indexOf(s);
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length]!;
}

function hEl(tag: string, content = "", cls = ""): HTMLElement {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (cls) node.className = cls;
  return node;
}

export function renderTasksView(
  host: HTMLElement,
  tasks: Task[],
  ctx: TasksContext,
  cb: TasksCallbacks,
): void {
  host.replaceChildren();

  // --- header ---
  const head = hEl("div", "", "tk-head");
  head.append(hEl("h2", "Tasks"));
  const modes = hEl("div", "", "tk-modes");
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Layout");
  for (const [mode, text] of [["list", "List"], ["timeline", "Timeline"]] as const) {
    const b = hEl("button", text, "tk-mode") as HTMLButtonElement;
    b.type = "button";
    b.setAttribute("aria-pressed", String(ctx.mode === mode));
    b.addEventListener("click", () => {
      if (ctx.mode !== mode) cb.onSetMode(mode);
    });
    modes.append(b);
  }
  head.append(modes);
  const close = hEl("button", "✕", "tk-close") as HTMLButtonElement;
  close.title = "Close";
  close.addEventListener("click", cb.onClose);
  head.append(close);
  host.append(head);

  const body = hEl("div", "", "tk-body");
  host.append(body);

  // --- create row (pre-links to the current selection when there is one) ---
  if (!ctx.readOnly) body.append(createForm(ctx, cb));

  // --- filter row: only meaningful when something is selected ---
  if (ctx.focus.elementId || ctx.focus.flowId) {
    const filter = hEl("label", "", "tk-filter");
    const cbx = document.createElement("input");
    cbx.type = "checkbox";
    cbx.checked = ctx.filterLinked;
    cbx.addEventListener("change", cb.onToggleFilter);
    filter.append(cbx);
    filter.append(hEl("span", `Only tasks linked to ${ctx.focus.label ?? "selection"}`));
    body.append(filter);
  }

  if (!tasks.length) {
    body.append(hEl("p", "No tasks yet.", "tk-empty"));
    return;
  }

  if (ctx.mode === "timeline") {
    body.append(timeline(buildGanttModel(tasks, { today: ctx.today })!, cb));
    return;
  }

  // --- grouped by status, in lifecycle order ---
  const byStatus = new Map<TaskStatus, Task[]>();
  for (const s of STATUS_ORDER) byStatus.set(s, []);
  for (const t of tasks) byStatus.get(t.status)!.push(t);

  for (const status of STATUS_ORDER) {
    const group = byStatus.get(status)!;
    if (!group.length) continue;
    const title = hEl("div", "", "tk-group-title");
    title.append(hEl("span", STATUS_LABEL[status]));
    title.append(hEl("span", String(group.length), "tk-count"));
    body.append(title);

    for (const task of group) {
      body.append(taskCard(task, status, ctx, cb));
    }
  }
}

function createForm(ctx: TasksContext, cb: TasksCallbacks): HTMLElement {
  const form = hEl("form", "", "tk-create") as HTMLFormElement;
  const input = document.createElement("input");
  input.className = "tk-input";
  input.placeholder = ctx.focus.label
    ? `New task for ${ctx.focus.label}…`
    : "New task…";
  const addBtn = hEl("button", "Add", "tk-add") as HTMLButtonElement;
  addBtn.type = "submit";
  form.append(input, addBtn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    cb.onCreate({
      title,
      ...(ctx.focus.elementId ? { elementId: ctx.focus.elementId } : {}),
      ...(ctx.focus.flowId ? { flowId: ctx.focus.flowId } : {}),
    });
    input.value = "";
  });
  return form;
}

function taskCard(
  task: Task,
  status: TaskStatus,
  ctx: TasksContext,
  cb: TasksCallbacks,
): HTMLElement {
  const card = hEl("div", "", `tk-card tk-card-${status}`);

  const headRow = hEl("div", "", "tk-card-head");
  // Status dot doubles as the "advance status" control.
  if (ctx.readOnly) {
    const dot = hEl("span", "", `tk-dot tk-dot-${status}`);
    dot.title = STATUS_LABEL[status];
    headRow.append(dot);
  } else {
    const dot = hEl("button", "", `tk-dot tk-dot-${status}`) as HTMLButtonElement;
    dot.title = `Mark ${STATUS_LABEL[nextStatus(status)]}`;
    dot.addEventListener("click", () => cb.onChangeStatus(task.id, nextStatus(status)));
    headRow.append(dot);
  }
  headRow.append(hEl("span", task.title, "tk-title"));

  if (!ctx.readOnly) {
    const del = hEl("button", "✕", "tk-del") as HTMLButtonElement;
    del.title = "Delete task";
    del.addEventListener("click", () => cb.onDelete(task.id));
    headRow.append(del);
  }
  card.append(headRow);

  if (task.description.trim()) {
    card.append(hEl("p", task.description.trim(), "tk-desc"));
  }

  // --- link chips ---
  // A live link is clickable (jumps to the element); a dangling one (its target
  // was deleted upstream) renders as a struck-through "stale" chip whose click
  // CLEARS the broken link — the honest repair, with no background mutation.
  const chips = hEl("div", "", "tk-chips");
  const elementId = task.elementId;
  if (elementId) {
    const name = ctx.elementName(elementId);
    chips.append(
      name
        ? linkChip(`▢ ${name}`, "tk-chip", () => cb.onSelectElement(elementId))
        : staleChip(`▢ ${elementId}`, "elementId", task.id, ctx, cb),
    );
  }
  const endpointId = task.endpointId;
  if (endpointId && endpointId !== task.elementId) {
    const name = ctx.elementName(endpointId);
    chips.append(
      name
        ? linkChip(`⛓ ${name}`, "tk-chip", () => cb.onSelectElement(endpointId))
        : staleChip(`⛓ ${endpointId}`, "endpointId", task.id, ctx, cb),
    );
  }
  const flowId = task.flowId;
  if (flowId) {
    const name = ctx.flowName(flowId);
    chips.append(
      name
        ? hEl("span", `↳ ${name}`, "tk-chip")
        : staleChip(`↳ ${flowId}`, "flowId", task.id, ctx, cb),
    );
  }
  for (const uid of task.assignees) chips.append(hEl("span", `@${uid}`, "tk-chip"));
  if (chips.childElementCount) card.append(chips);

  return card;
}

function linkChip(text: string, cls: string, onClick: () => void): HTMLElement {
  const b = hEl("button", text, cls) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

/** A chip for a dangling link; clicking clears the broken reference. */
function staleChip(
  text: string,
  field: TaskLinkField,
  taskId: string,
  ctx: TasksContext,
  cb: TasksCallbacks,
): HTMLElement {
  if (ctx.readOnly) return hEl("span", text, "tk-chip tk-chip-stale");
  const b = hEl("button", text, "tk-chip tk-chip-stale") as HTMLButtonElement;
  b.title = "Linked item was removed — click to clear this link";
  b.addEventListener("click", () => cb.onClearLink(taskId, field));
  return b;
}

// --------------------------------------------------------------------------
// Timeline (Gantt)
// --------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

/** Absolutely position a box from the model's pixel geometry. */
function place(node: HTMLElement, x: number, y: number, w: number, h: number): HTMLElement {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
  return node;
}

/**
 * The timeline: a sticky label column (key + title per row, under a header per
 * status) beside a scrolling day grid with a sticky week/day axis. Bars fill by
 * status and colour by type; milestones are diamonds; dependency connectors run
 * from a task's end to its dependent's start, red when the dependent starts
 * before its dependency is due. Clicking a row's label selects its linked
 * element on the canvas.
 */
function timeline(model: GanttModel, cb: TasksCallbacks): HTMLElement {
  const AXIS_H = 44;
  const LABEL_W = 220;
  const wrap = hEl("div", "", "tk-gantt");
  const grid = hEl("div", "", "tk-g-grid");
  grid.style.gridTemplateColumns = `${LABEL_W}px ${model.timelineW}px`;
  grid.style.gridTemplateRows = `${AXIS_H}px ${model.bodyH}px`;
  wrap.append(grid);

  grid.append(hEl("div", "", "tk-g-corner"));

  // --- axis: weeks over days ---
  const axis = hEl("div", "", "tk-g-axis");
  for (const w of model.weeks) {
    axis.append(place(hEl("div", w.label, "tk-g-week"), w.xPx, 0, w.widthPx, AXIS_H / 2));
  }
  for (const d of model.days) {
    const cls = `tk-g-day${d.weekend ? " tk-g-weekend" : ""}${d.today ? " tk-g-today-num" : ""}`;
    axis.append(place(hEl("div", String(d.dayNum), cls), d.xPx, AXIS_H / 2, model.dayW, AXIS_H / 2));
  }
  grid.append(axis);

  // --- label column ---
  const labels = hEl("div", "", "tk-g-labels");
  for (const section of model.sections) {
    const head = place(hEl("div", "", "tk-g-sec"), 0, section.yPx, LABEL_W, model.secH);
    head.append(hEl("span", section.label), hEl("span", String(section.rows.length), "tk-count"));
    labels.append(head);
    for (const row of section.rows) {
      const elementId = row.task.elementId ?? row.task.endpointId;
      const label = place(
        hEl(elementId ? "button" : "div", "", `tk-g-label${row.task.status === "done" ? " tk-g-done" : ""}`),
        0,
        row.yPx,
        LABEL_W,
        model.rowH,
      );
      if (row.task.key) label.append(hEl("span", row.task.key, "tk-g-key"));
      label.append(hEl("span", row.task.title, "tk-g-title"));
      label.title = row.task.title;
      if (elementId) {
        (label as HTMLButtonElement).type = "button";
        label.addEventListener("click", () => cb.onSelectElement(elementId));
      }
      labels.append(label);
    }
  }
  grid.append(labels);

  // --- body: weekend stripes, today, connectors, bars ---
  const body = hEl("div", "", "tk-g-body");
  for (const d of model.days) {
    if (d.weekend) body.append(place(hEl("div", "", "tk-g-stripe"), d.xPx, 0, model.dayW, model.bodyH));
  }
  for (const section of model.sections) {
    body.append(place(hEl("div", "", "tk-g-secband"), 0, section.yPx, model.timelineW, model.secH));
  }
  if (model.today) {
    body.append(place(hEl("div", "", "tk-g-today"), model.today.xPx - 1, 0, 2, model.bodyH));
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "tk-g-links");
  svg.setAttribute("width", String(model.timelineW));
  svg.setAttribute("height", String(model.bodyH));
  for (const c of model.connectors) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", c.path);
    path.setAttribute("class", c.conflict ? "tk-g-link tk-g-conflict" : "tk-g-link");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(c.dotCx));
    dot.setAttribute("cy", String(c.dotCy));
    dot.setAttribute("r", "3");
    dot.setAttribute("class", c.conflict ? "tk-g-linkdot tk-g-conflict" : "tk-g-linkdot");
    svg.append(path, dot);
  }
  body.append(svg);

  for (const section of model.sections) {
    for (const row of section.rows) {
      const when = row.start === row.end ? row.start : `${row.start} → ${row.end}`;
      const tip = `${row.task.key ? `${row.task.key} ` : ""}${row.task.title}\n${STATUS_LABEL[row.task.status]} · ${when}${
        row.dueUnparsed ? `\nDue "${row.task.dueDate}" isn't an ISO date, so it isn't plotted.` : ""
      }`;
      if (row.milestone) {
        const size = 14;
        const m = place(
          hEl("div", "", `tk-g-milestone tk-type-${row.task.type}`),
          row.xPx - size / 2,
          row.yPx + (model.rowH - size) / 2,
          size,
          size,
        );
        m.title = tip;
        body.append(m);
        continue;
      }
      const bar = place(
        hEl("div", "", `tk-g-bar tk-type-${row.task.type} tk-g-${row.task.status}${row.dueUnparsed ? " tk-g-unplotted" : ""}${
          row.clipped ? " tk-g-clipped" : ""
        }`),
        row.xPx + 2,
        row.yPx + 9,
        Math.max(row.wPx - 4, 6),
        model.rowH - 18,
      );
      const fill = hEl("div", "", "tk-g-fill");
      fill.style.width = `${Math.round(row.progress * 100)}%`;
      bar.append(fill);
      bar.title = tip;
      body.append(bar);
    }
  }
  grid.append(body);

  // Open scrolled so today is in view (a left margin of about a week).
  if (model.today) {
    const x = Math.max(0, model.today.xPx - 7 * model.dayW);
    requestAnimationFrame(() => {
      wrap.scrollLeft = x;
    });
  }
  return wrap;
}
