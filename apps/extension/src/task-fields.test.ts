import { describe, it, expect } from "vitest";
import { newTask, type Task } from "forward-core";
import { cycleWith, dayError, dueDateError, startDateError, taskPickItem } from "./task-fields.js";

const task = (key: string, extra: Partial<Task> = {}): Task => ({
  ...newTask({ id: key.toLowerCase(), title: `Task ${key}` }, { actor: "t" }),
  key,
  ...extra,
});

describe("dayError", () => {
  it("accepts empty and real ISO dates", () => {
    expect(dayError("")).toBeUndefined();
    expect(dayError("  ")).toBeUndefined();
    expect(dayError("2026-11-03")).toBeUndefined();
  });

  it("rejects what the store would reject", () => {
    expect(dayError("next sprint")).toMatch(/YYYY-MM-DD/);
    expect(dayError("2026-02-30")).toMatch(/YYYY-MM-DD/);
    expect(dayError("2026-11-03T10:00")).toMatch(/YYYY-MM-DD/);
  });
});

describe("dueDateError", () => {
  it("flags a due date before the start", () => {
    expect(dueDateError("2026-11-01", "2026-11-03")).toMatch(/before the start date \(2026-11-03\)/);
    expect(dueDateError("2026-11-03", "2026-11-03")).toBeUndefined();
    expect(dueDateError("2026-11-04", undefined)).toBeUndefined();
  });

  it("checks the format first", () => {
    expect(dueDateError("soon", "2026-11-03")).toMatch(/YYYY-MM-DD/);
  });
});

describe("startDateError", () => {
  it("flags a start after the due date", () => {
    expect(startDateError("2026-11-05", "2026-11-03")).toMatch(/after the due date \(2026-11-03\)/);
    expect(startDateError("2026-11-03", "2026-11-03")).toBeUndefined();
    expect(startDateError("", "2026-11-03")).toBeUndefined();
  });

  it("doesn't compare against a legacy free-text due date", () => {
    expect(startDateError("2026-11-05", "next sprint")).toBeUndefined();
  });
});

describe("taskPickItem", () => {
  it("shows key, status, dates and dependencies by key", () => {
    const a = task("FWD-1");
    const b = task("FWD-2", {
      status: "in_progress",
      type: "milestone",
      dueDate: "2026-11-03",
      dependsOn: [a.id, "task_gone"],
      elementId: "el_login",
    });
    const byId = new Map([a, b].map((t) => [t.id, t]));
    expect(taskPickItem(b, byId)).toEqual({
      label: "FWD-2  Task FWD-2",
      description: "in_progress · milestone · due 2026-11-03",
      detail: "linked to el_login · depends on FWD-1, task_gone",
    });
    expect(taskPickItem(a, byId)).toEqual({ label: "FWD-1  Task FWD-1", description: "todo" });
  });
});

describe("cycleWith", () => {
  it("names the cycle a new dependency would close", () => {
    const a = task("FWD-1");
    const b = task("FWD-2", { dependsOn: [a.id] });
    const c = task("FWD-3", { dependsOn: [b.id] });
    expect(cycleWith([a, b, c], a, [c.id])).toBe("FWD-1 → FWD-2 → FWD-3 → FWD-1");
    expect(cycleWith([a, b, c], c, [a.id, b.id])).toBeUndefined();
  });

  it("ignores a cycle elsewhere in the project", () => {
    const a = task("FWD-1");
    const x = task("FWD-8", { dependsOn: ["fwd-9"] });
    const y = task("FWD-9", { dependsOn: ["fwd-8"] });
    expect(cycleWith([a, x, y], a, [x.id])).toBeUndefined();
  });
});
