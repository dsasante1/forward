import { describe, expect, it } from "vitest";
import { applyTaskChange, commentOnTask, newTask, nextTaskKey } from "./tasks.js";
import type { Task } from "./schema.js";

describe("nextTaskKey", () => {
  it("returns FWD-1 for an empty project", () => {
    expect(nextTaskKey([])).toBe("FWD-1");
  });
  it("uses the max existing number + 1, ignoring gaps and undefineds", () => {
    expect(nextTaskKey(["FWD-2", undefined, "FWD-9", "FWD-5"])).toBe("FWD-10");
  });
});

describe("newTask", () => {
  it("applies defaults, mints a key, defaults the reporter, and logs creation", () => {
    const t = newTask({ title: "Wire signup" }, { actor: "u1", existingKeys: ["FWD-4"] });
    expect(t.key).toBe("FWD-5");
    expect(t.reporter).toBe("u1");
    expect(t.status).toBe("todo");
    expect(t.type).toBe("task");
    expect(t.priority).toBe("medium");
    expect(t.activity).toHaveLength(1);
    expect(t.activity[0]).toMatchObject({ kind: "event", actor: "u1", verb: "created this task" });
  });
});

describe("applyTaskChange", () => {
  const base = newTask({ title: "T" }, { actor: "u1" });

  it("logs a status change with the human label", () => {
    const next = applyTaskChange(base, { status: "in_progress" }, "u2");
    expect(next.status).toBe("in_progress");
    expect(next.activity.at(-1)).toMatchObject({
      kind: "event",
      actor: "u2",
      verb: "changed status to",
      target: "In progress",
    });
  });

  it("does not log a no-op change but still re-stamps updatedAt", () => {
    const next = applyTaskChange(base, { status: base.status }, "u2");
    expect(next.activity).toHaveLength(base.activity.length);
  });

  it("emits an event per added and removed assignee", () => {
    const withTwo: Task = { ...base, assignees: ["a", "b"] };
    const next = applyTaskChange(withTwo, { assignees: ["b", "c"] }, "u2");
    const verbs = next.activity.slice(base.activity.length).map((a) => `${a.verb} ${a.target}`);
    expect(verbs).toContain("assigned c");
    expect(verbs).toContain("unassigned a");
  });

  it("treats a present-but-undefined nullable field as a clear", () => {
    const linked: Task = { ...base, elementId: "el_1" };
    const next = applyTaskChange(linked, { elementId: undefined }, "u2");
    expect(next.elementId).toBeUndefined();
    expect(next.activity.at(-1)).toMatchObject({ verb: "cleared element link" });
  });
});

describe("commentOnTask", () => {
  it("appends a comment entry", () => {
    const base = newTask({ title: "T" }, { actor: "u1" });
    const next = commentOnTask(base, "u2", "looks good");
    expect(next.activity.at(-1)).toMatchObject({ kind: "comment", actor: "u2", body: "looks good" });
  });
});
