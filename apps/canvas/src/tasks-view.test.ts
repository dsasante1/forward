import { describe, expect, it } from "vitest";
import type { Task } from "forward-core";
import {
  dateInputValue,
  DEFAULT_TASKS_MODE,
  loadTasksMode,
  saveTasksMode,
  TASKS_MODE_KEY,
  taskEditPatch,
  tasksPanelWide,
} from "./tasks-view.js";

/** An in-memory stand-in for `window.localStorage`; the suite has no DOM environment. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("the task panel's layout", () => {
  it("opens on the timeline when the user has never picked one", () => {
    expect(DEFAULT_TASKS_MODE).toBe("timeline");
    expect(loadTasksMode(() => memoryStorage())).toBe("timeline");
  });

  it("restores the layout the user picked last", () => {
    const storage = memoryStorage();
    saveTasksMode(() => storage, "list");
    expect(storage.items.get(TASKS_MODE_KEY)).toBe("list");
    expect(loadTasksMode(() => storage)).toBe("list");

    saveTasksMode(() => storage, "timeline");
    expect(loadTasksMode(() => storage)).toBe("timeline");
  });

  it("ignores a stored value that is not a layout", () => {
    expect(loadTasksMode(() => memoryStorage({ [TASKS_MODE_KEY]: "kanban" }))).toBe("timeline");
  });

  it("falls back to the default, and saves nothing, where storage is blocked", () => {
    expect(loadTasksMode(blocked)).toBe("timeline");
    expect(() => saveTasksMode(blocked, "list")).not.toThrow();
  });

  it("goes full width only for a timeline with tasks to draw", () => {
    expect(tasksPanelWide("timeline", 3)).toBe(true);
    expect(tasksPanelWide("timeline", 0)).toBe(false); // "No tasks yet." stays a side panel
    expect(tasksPanelWide("list", 3)).toBe(false);
  });
});

describe("task edit form", () => {
  const task = (over: Partial<Task> = {}) =>
    ({ id: "t1", title: "Ship", description: "", type: "task", priority: "medium", dueDate: "2026-03-14", ...over }) as Task;
  const form = (t: Task, over: Partial<Parameters<typeof taskEditPatch>[1]> = {}) => ({
    title: t.title,
    description: t.description,
    type: t.type,
    priority: t.priority,
    startDate: dateInputValue(t.startDate),
    dueDate: dateInputValue(t.dueDate),
    ...over,
  });

  it("shows an ISO due date in the date input, and a legacy label as empty", () => {
    expect(dateInputValue("2026-03-14")).toBe("2026-03-14");
    expect(dateInputValue("next week")).toBe("");
    expect(dateInputValue(undefined)).toBe("");
  });

  it("keeps the due date when only the title changes", () => {
    const t = task();
    const patch = taskEditPatch(t, form(t, { title: "  Ship it " }));
    expect(patch).toEqual({ title: "Ship it", description: "", type: "task", priority: "medium" });
    expect("dueDate" in patch).toBe(false);
    // A legacy label the input can't show survives an edit too.
    const legacy = task({ dueDate: "next week" });
    expect("dueDate" in taskEditPatch(legacy, form(legacy))).toBe(false);
  });

  it("sends a changed date, and clears an emptied one", () => {
    const t = task();
    expect(taskEditPatch(t, form(t, { dueDate: "2026-04-01" })).dueDate).toBe("2026-04-01");
    const cleared = taskEditPatch(t, form(t, { dueDate: "" }));
    expect("dueDate" in cleared && cleared.dueDate === undefined).toBe(true);
  });
});
