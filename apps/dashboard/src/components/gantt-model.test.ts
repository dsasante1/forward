import { describe, expect, it } from "vitest";
import type { Task } from "forward-core";
import {
  buildGanttModel,
  GANTT_DAY_W,
  GANTT_ROW_H,
  GANTT_SEC_H,
} from "./gantt-model.js";

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? "t1",
    title: over.title ?? "A task",
    description: "",
    type: over.type ?? "task",
    status: over.status ?? "todo",
    priority: "medium",
    labels: [],
    assignees: [],
    dependsOn: [],
    activity: [],
    createdAt: over.createdAt ?? "2026-06-08T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-06-08T00:00:00.000Z",
    ...over,
  };
}

const NOW = new Date(2026, 5, 24); // Wed Jun 24 2026

describe("buildGanttModel", () => {
  it("returns null for no tasks", () => {
    expect(buildGanttModel([], NOW)).toBeNull();
  });

  it("starts the range on the Monday of the earliest task", () => {
    // Jun 8 2026 is a Monday, so the range starts exactly there.
    const m = buildGanttModel(
      [task({ createdAt: "2026-06-10T12:00:00.000Z", dueDate: "2026-06-12" })],
      NOW,
    )!;
    // first day cell is day 8
    expect(m.days[0]!.dayNum).toBe(8);
    // weeks are whole 7-day columns
    expect(m.timelineW).toBe(m.days.length * GANTT_DAY_W);
    expect(m.days.length % 7).toBe(0);
  });

  it("places a bar from createdAt to dueDate", () => {
    const m = buildGanttModel(
      [task({ createdAt: "2026-06-09T00:00:00.000Z", dueDate: "2026-06-11" })],
      NOW,
    )!;
    const row = m.sections[0]!.rows[0]!;
    // Jun 9 is index 1 from Mon Jun 8 → x = 1 * DAY_W
    expect(row.xPx).toBe(1 * GANTT_DAY_W);
    // Jun 9..Jun 11 inclusive = 3 cells
    expect(row.wPx).toBe(3 * GANTT_DAY_W);
  });

  it("falls back to a one-day bar when dueDate is missing or free-form", () => {
    const m = buildGanttModel(
      [
        task({ id: "a", createdAt: "2026-06-09T00:00:00.000Z" }),
        task({ id: "b", createdAt: "2026-06-09T00:00:00.000Z", dueDate: "someday" }),
      ],
      NOW,
    )!;
    for (const r of m.sections[0]!.rows) expect(r.wPx).toBe(GANTT_DAY_W);
  });

  it("groups rows into sections by status in lifecycle order", () => {
    const m = buildGanttModel(
      [
        task({ id: "a", status: "done" }),
        task({ id: "b", status: "todo" }),
        task({ id: "c", status: "in_progress" }),
      ],
      NOW,
    )!;
    expect(m.sections.map((s) => s.status)).toEqual(["todo", "in_progress", "done"]);
    expect(m.sections.every((s) => s.rows.length === 1)).toBe(true);
  });

  it("computes a body height that matches its sections and rows", () => {
    const m = buildGanttModel(
      [task({ id: "a", status: "todo" }), task({ id: "b", status: "done" })],
      NOW,
    )!;
    // two sections, one row each
    expect(m.bodyH).toBe(2 * GANTT_SEC_H + 2 * GANTT_ROW_H);
  });

  it("renders a milestone as a single point at its date", () => {
    const m = buildGanttModel(
      [
        task({
          id: "ms",
          type: "milestone",
          status: "todo",
          createdAt: "2026-06-08T00:00:00.000Z",
          dueDate: "2026-06-15",
        }),
      ],
      NOW,
    )!;
    const row = m.sections[0]!.rows[0]!;
    expect(row.milestone).toBe(true);
    // Jun 15 is index 7 from Mon Jun 8 → centre = 7*DAY_W + DAY_W/2
    expect(row.xPx).toBe(7 * GANTT_DAY_W + GANTT_DAY_W / 2);
  });

  it("builds a connector from a dependency's end to the dependent's start", () => {
    const m = buildGanttModel(
      [
        task({ id: "a", status: "in_progress", createdAt: "2026-06-09T00:00:00.000Z", dueDate: "2026-06-10" }),
        task({ id: "b", status: "todo", createdAt: "2026-06-12T00:00:00.000Z", dueDate: "2026-06-13", dependsOn: ["a"] }),
      ],
      NOW,
    )!;
    expect(m.connectors).toHaveLength(1);
    // path starts at A's end-x (Jun 9..10 → x=DAY_W, w=2*DAY_W → end=3*DAY_W)
    expect(m.connectors[0]!.path.startsWith(`M ${3 * GANTT_DAY_W} `)).toBe(true);
  });

  it("ignores dependencies on tasks that aren't plotted", () => {
    const m = buildGanttModel(
      [task({ id: "b", dependsOn: ["ghost"] })],
      NOW,
    )!;
    expect(m.connectors).toHaveLength(0);
  });

  it("marks today inside the window even if no task spans it", () => {
    const m = buildGanttModel(
      [task({ createdAt: "2026-06-01T00:00:00.000Z", dueDate: "2026-06-03" })],
      NOW,
    )!;
    expect(m.today).not.toBeNull();
    expect(m.today!.label).toBe("JUN 24");
    expect(m.days.some((d) => d.today)).toBe(true);
  });
});
