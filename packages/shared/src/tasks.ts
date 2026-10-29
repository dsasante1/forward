// --------------------------------------------------------------------------
// Task helpers — the ONE place task work-items are created, mutated and
// commented on. Every surface (canvas, extension, MCP and CLI, all via the
// server) calls these so a task's history is built identically no
// matter who touched it. Pure functions: they take the prior task + a change +
// the acting uid and return the next task with the right `activity` appended and
// `updatedAt` stamped. Persisting the result is the caller's job.
// --------------------------------------------------------------------------

import {
  Task,
  type TaskActivity,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "./schema.js";

/** Human labels for the enum values — used in activity lines, so shared. */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const TYPE_LABELS: Record<TaskType, string> = {
  bug: "Bug",
  feature: "Feature",
  task: "Task",
  milestone: "Milestone",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

function now(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

/** Build one activity entry stamped to the actor + now. */
function entry(
  actor: string,
  partial: Omit<TaskActivity, "id" | "actor" | "at">,
): TaskActivity {
  return { id: genId("act"), actor, at: now(), ...partial };
}

/**
 * Next sequential `FWD-NN` key from the keys already in use. Best-effort:
 * concurrent creates can race, so the key is a human label, not an identity.
 * The server backstops a missing key.
 */
export function nextTaskKey(existing: Iterable<string | undefined>): string {
  let max = 0;
  for (const k of existing) {
    const m = k?.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `FWD-${max + 1}`;
}

/** The fields a task can be opened with — everything else gets a default. */
export interface NewTaskInput {
  id?: string;
  title: string;
  description?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assignees?: string[];
  reporter?: string;
  startDate?: string;
  dueDate?: string;
  elementId?: string;
  flowId?: string;
  endpointId?: string;
  dependsOn?: string[];
}

/**
 * Create a fresh task: applies schema defaults, mints a key, defaults the
 * reporter to the actor, and seeds the activity feed with a "created" event.
 */
export function newTask(
  input: NewTaskInput,
  opts: { actor: string; existingKeys?: Iterable<string | undefined> },
): Task {
  const stamp = now();
  return Task.parse({
    ...input,
    id: input.id ?? genId("task"),
    key: nextTaskKey(opts.existingKeys ?? []),
    reporter: input.reporter ?? opts.actor,
    activity: [entry(opts.actor, { kind: "event", verb: "created this task" })],
    createdAt: stamp,
    updatedAt: stamp,
  });
}

/** The mutable fields a change can touch (everything except identity/history). */
export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "type"
    | "status"
    | "priority"
    | "labels"
    | "assignees"
    | "startDate"
    | "dueDate"
    | "elementId"
    | "flowId"
    | "endpointId"
    | "dependsOn"
  >
>;

const LINK_LABEL: Record<"elementId" | "flowId" | "endpointId", string> = {
  elementId: "element",
  flowId: "flow",
  endpointId: "endpoint",
};

/**
 * Apply a field patch and append the matching activity events. Only fields that
 * actually changed produce an event; a no-op patch still re-stamps updatedAt.
 * Pass a field as `undefined` (e.g. `{ elementId: undefined }`) to CLEAR it —
 * the key's presence in the patch, not its value, signals intent for nullable
 * fields (links, startDate, dueDate).
 */
export function applyTaskChange(
  prev: Task,
  patch: TaskPatch,
  actor: string,
): Task {
  const next: Task = { ...prev, ...patch, updatedAt: now() };
  const events: TaskActivity[] = [];
  const ev = (partial: Omit<TaskActivity, "id" | "actor" | "at" | "kind">) =>
    events.push(entry(actor, { kind: "event", ...partial }));

  if (patch.status !== undefined && patch.status !== prev.status) {
    ev({ verb: "changed status to", target: STATUS_LABELS[patch.status] });
  }
  if (patch.type !== undefined && patch.type !== prev.type) {
    ev({ verb: "changed type to", target: TYPE_LABELS[patch.type] });
  }
  if (patch.priority !== undefined && patch.priority !== prev.priority) {
    ev({ verb: "set priority", badge: PRIORITY_LABELS[patch.priority] });
  }
  if (patch.title !== undefined && patch.title !== prev.title) {
    ev({ verb: "renamed this task", target: patch.title });
  }
  if (
    patch.description !== undefined &&
    patch.description.trim() !== prev.description.trim()
  ) {
    ev({
      verb: prev.description.trim() ? "edited the description" : "added a description",
    });
  }
  if ("startDate" in patch && (patch.startDate ?? "") !== (prev.startDate ?? "")) {
    ev(
      patch.startDate
        ? { verb: "set start date", target: patch.startDate }
        : { verb: "cleared the start date" },
    );
  }
  if ("dueDate" in patch && (patch.dueDate ?? "") !== (prev.dueDate ?? "")) {
    ev(
      patch.dueDate
        ? { verb: "set due date", target: patch.dueDate }
        : { verb: "cleared the due date" },
    );
  }
  if (patch.assignees) {
    for (const u of patch.assignees)
      if (!prev.assignees.includes(u)) ev({ verb: "assigned", target: u });
    for (const u of prev.assignees)
      if (!patch.assignees.includes(u)) ev({ verb: "unassigned", target: u });
  }
  if (patch.labels) {
    for (const l of patch.labels)
      if (!prev.labels.includes(l)) ev({ verb: "added label", badge: l });
    for (const l of prev.labels)
      if (!patch.labels.includes(l)) ev({ verb: "removed label", badge: l });
  }
  if (patch.dependsOn) {
    for (const d of patch.dependsOn)
      if (!prev.dependsOn.includes(d)) ev({ verb: "added dependency", target: d });
    for (const d of prev.dependsOn)
      if (!patch.dependsOn.includes(d)) ev({ verb: "removed dependency", target: d });
  }
  for (const f of ["elementId", "flowId", "endpointId"] as const) {
    if (f in patch && patch[f] !== prev[f]) {
      ev(
        patch[f]
          ? { verb: `linked ${LINK_LABEL[f]}`, target: patch[f] }
          : { verb: `cleared ${LINK_LABEL[f]} link` },
      );
    }
  }

  next.activity = [...prev.activity, ...events];
  return next;
}

/** Append a comment to a task's feed. */
export function commentOnTask(prev: Task, actor: string, body: string): Task {
  return {
    ...prev,
    updatedAt: now(),
    activity: [...prev.activity, entry(actor, { kind: "comment", body })],
  };
}
