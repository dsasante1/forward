import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASKS_MODE,
  loadTasksMode,
  saveTasksMode,
  TASKS_MODE_KEY,
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
