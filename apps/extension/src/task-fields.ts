import {
  findDependencyCycles,
  isIsoDay,
  parseTaskDay,
  type Task,
} from "forward-core";

/**
 * The pure parts of the task commands — date checks, picker rows, dependency
 * cycles — kept apart from `extension.ts` so they test without VS Code.
 */

/**
 * Input-box check for an optional date. Empty skips it; anything else must be
 * `YYYY-MM-DD`, the rule `RepoStore.saveTask` enforces on a new or changed
 * due date, so the user hears it while typing rather than after every prompt.
 */
export function dayError(value: string): string | undefined {
  const v = value.trim();
  if (!v || isIsoDay(v)) return undefined;
  return "Use an ISO date, YYYY-MM-DD (e.g. 2026-11-03), or leave it empty.";
}

/**
 * Input-box check for a due date against the start: a due date before the start
 * would be drawn as a one-day bar at the start, so catch it while typing.
 */
export function dueDateError(value: string, start: string | undefined): string | undefined {
  const bad = dayError(value);
  if (bad) return bad;
  const s = parseTaskDay(start);
  const d = parseTaskDay(value.trim());
  return s !== null && d !== null && d < s
    ? `The due date is before the start date (${start}).`
    : undefined;
}

/**
 * Input-box check for a start date against the due date, the mirror of
 * `dueDateError`. A due date that isn't an ISO date (a legacy free-text one)
 * isn't compared, since the timeline doesn't plot it either.
 */
export function startDateError(value: string, due: string | undefined): string | undefined {
  const bad = dayError(value);
  if (bad) return bad;
  const s = parseTaskDay(value.trim());
  const d = parseTaskDay(due);
  return s !== null && d !== null && s > d
    ? `The start date is after the due date (${due}).`
    : undefined;
}

/** A task's short name in messages: its key when it has one, else its title. */
export function taskName(task: Task): string {
  return task.key ?? task.title;
}

/** One quick-pick row: key + title, then status and dates, then links. */
export function taskPickItem(
  task: Task,
  byId: ReadonlyMap<string, Task>,
): { label: string; description: string; detail?: string } {
  const description = [
    task.status,
    task.type === "milestone" ? "milestone" : undefined,
    task.startDate ? `start ${task.startDate}` : undefined,
    task.dueDate ? `due ${task.dueDate}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const deps = task.dependsOn.map((id) => {
    const dep = byId.get(id);
    return dep ? taskName(dep) : id;
  });
  const detail = [
    task.elementId ? `linked to ${task.elementId}` : undefined,
    deps.length ? `depends on ${deps.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    label: task.key ? `${task.key}  ${task.title}` : task.title,
    description,
    ...(detail ? { detail } : {}),
  };
}

/**
 * The dependency cycle that giving `task` these `dependsOn` ids would leave it
 * in, written as `forward validate` writes it ("FWD-1 → FWD-2 → FWD-1"), or
 * undefined when there is none.
 */
export function cycleWith(
  tasks: readonly Task[],
  task: Task,
  dependsOn: string[],
): string | undefined {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  byId.set(task.id, { ...task, dependsOn });
  const cycle = findDependencyCycles([...byId.values()]).find((c) => c.includes(task.id));
  if (!cycle) return undefined;
  const names = cycle.map((id) => taskName(byId.get(id)!));
  return [...names, names[0]].join(" → ");
}
