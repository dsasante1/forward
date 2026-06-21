import type { Task, TaskStatus } from "forward-core";

/**
 * The project task tracker (pillar 4): one overlay panel that lists the
 * project's work items grouped by status, and ties each task to what it's about
 * via its optional links (a design element, an infra flow, a documented
 * endpoint). When an element or flow is selected on the canvas, the panel can
 * filter to just the tasks linked to it — the "link-driven" view — and new tasks
 * are pre-linked to that selection.
 *
 * This module only draws; the source-of-truth lives in the RTDB and the writes
 * go back through the CanvasSource via the callbacks.
 */

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
}

export interface TasksCallbacks {
  onClose: () => void;
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
  const close = hEl("button", "✕", "tk-close") as HTMLButtonElement;
  close.title = "Close";
  close.addEventListener("click", cb.onClose);
  head.append(close);
  host.append(head);

  const body = hEl("div", "", "tk-body");
  host.append(body);

  // --- create row (pre-links to the current selection when there is one) ---
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
  body.append(form);

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

function taskCard(
  task: Task,
  status: TaskStatus,
  ctx: TasksContext,
  cb: TasksCallbacks,
): HTMLElement {
  const card = hEl("div", "", `tk-card tk-card-${status}`);

  const headRow = hEl("div", "", "tk-card-head");
  // Status dot doubles as the "advance status" control.
  const dot = hEl("button", "", `tk-dot tk-dot-${status}`) as HTMLButtonElement;
  dot.title = `Mark ${STATUS_LABEL[nextStatus(status)]}`;
  dot.addEventListener("click", () => cb.onChangeStatus(task.id, nextStatus(status)));
  headRow.append(dot);
  headRow.append(hEl("span", task.title, "tk-title"));

  const del = hEl("button", "✕", "tk-del") as HTMLButtonElement;
  del.title = "Delete task";
  del.addEventListener("click", () => cb.onDelete(task.id));
  headRow.append(del);
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
        : staleChip(`▢ ${elementId}`, "elementId", task.id, cb),
    );
  }
  const endpointId = task.endpointId;
  if (endpointId && endpointId !== task.elementId) {
    const name = ctx.elementName(endpointId);
    chips.append(
      name
        ? linkChip(`⛓ ${name}`, "tk-chip", () => cb.onSelectElement(endpointId))
        : staleChip(`⛓ ${endpointId}`, "endpointId", task.id, cb),
    );
  }
  const flowId = task.flowId;
  if (flowId) {
    const name = ctx.flowName(flowId);
    chips.append(
      name
        ? hEl("span", `↳ ${name}`, "tk-chip")
        : staleChip(`↳ ${flowId}`, "flowId", task.id, cb),
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
  cb: TasksCallbacks,
): HTMLElement {
  const b = hEl("button", text, "tk-chip tk-chip-stale") as HTMLButtonElement;
  b.title = "Linked item was removed — click to clear this link";
  b.addEventListener("click", () => cb.onClearLink(taskId, field));
  return b;
}
