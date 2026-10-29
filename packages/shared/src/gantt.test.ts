import { describe, expect, it } from "vitest";
import {
  buildGanttModel,
  dayToIso,
  findDependencyCycles,
  isIsoDay,
  parseTaskDay,
  taskSpan,
  tasksToMermaidGantt,
} from "./gantt.js";
import { Task } from "./schema.js";
import { applyTaskChange, newTask } from "./tasks.js";

let seq = 0;
function task(fields: Partial<Task> & { title?: string } = {}): Task {
  seq += 1;
  return Task.parse({
    id: `t${seq}`,
    key: `FWD-${seq}`,
    title: `Task ${seq}`,
    createdAt: "2026-10-26T09:00:00.000Z",
    updatedAt: "2026-10-26T09:00:00.000Z",
    ...fields,
  });
}

describe("parseTaskDay", () => {
  it("reads ISO dates and the date part of ISO datetimes", () => {
    expect(dayToIso(parseTaskDay("2026-11-05")!)).toBe("2026-11-05");
    expect(dayToIso(parseTaskDay("2026-10-29T23:30:00.000Z")!)).toBe("2026-10-29");
  });

  it("rejects free-form labels and impossible dates instead of guessing", () => {
    // new Date("Jun 24") is 2001-06-24 in V8 — never used.
    for (const v of ["Jun 24", "next week", "24/06/2026", "2026-02-30", "2026-13-01", "", undefined]) {
      expect(parseTaskDay(v)).toBeNull();
    }
  });
});

describe("isIsoDay", () => {
  it("accepts only a real YYYY-MM-DD", () => {
    expect(isIsoDay("2026-11-05")).toBe(true);
    for (const v of ["2026-11-05T10:00:00Z", "Jun 24", "2026-02-30", " 2026-11-05", ""]) {
      expect(isIsoDay(v)).toBe(false);
    }
  });
});

describe("taskSpan", () => {
  it("starts on the created day and ends on an ISO due date", () => {
    const s = taskSpan(task({ dueDate: "2026-10-30" }));
    expect([dayToIso(s.start), dayToIso(s.end)]).toEqual(["2026-10-26", "2026-10-30"]);
    expect(s.dueUnparsed).toBe(false);
  });

  it("prefers startDate over createdAt", () => {
    const s = taskSpan(task({ startDate: "2026-11-02", dueDate: "2026-11-06" }));
    expect([dayToIso(s.start), dayToIso(s.end)]).toEqual(["2026-11-02", "2026-11-06"]);
  });

  it("falls back to a one-day bar for a free-form or earlier due date", () => {
    const free = taskSpan(task({ dueDate: "next week" }));
    expect(free.end).toBe(free.start);
    expect(free.dueUnparsed).toBe(true);
    const early = taskSpan(task({ startDate: "2026-11-10", dueDate: "2026-11-01" }));
    expect(early.end).toBe(early.start);
    expect(early.dueUnparsed).toBe(false);
  });

  it("puts a milestone on its due date, else its start", () => {
    const m = taskSpan(task({ type: "milestone", dueDate: "2026-11-20" }));
    expect(m.milestone).toBe(true);
    expect([dayToIso(m.start), dayToIso(m.end)]).toEqual(["2026-11-20", "2026-11-20"]);
    expect(dayToIso(taskSpan(task({ type: "milestone" })).start)).toBe("2026-10-26");
  });

  it("uses the UTC day of createdAt whatever the machine's time zone", () => {
    const s = taskSpan(task({ createdAt: "2026-10-29T23:30:00.000Z" }));
    expect(dayToIso(s.start)).toBe("2026-10-29");
  });
});

describe("findDependencyCycles", () => {
  it("finds a cycle and a self-dependency, ignoring dangling ids", () => {
    const a = task({ id: "a", dependsOn: ["b", "gone"] });
    const b = task({ id: "b", dependsOn: ["a"] });
    const c = task({ id: "c", dependsOn: ["c"] });
    const d = task({ id: "d", dependsOn: ["a"] });
    expect(findDependencyCycles([a, b, c, d])).toEqual([["a", "b"], ["c"]]);
  });

  it("returns nothing for a DAG and survives a long chain", () => {
    const chain = Array.from({ length: 5000 }, (_, i) =>
      task({ id: `n${i}`, dependsOn: i ? [`n${i - 1}`] : [] }),
    );
    expect(findDependencyCycles(chain)).toEqual([]);
  });
});

describe("buildGanttModel", () => {
  it("returns null with no tasks", () => {
    expect(buildGanttModel([], { today: "2026-10-29" })).toBeNull();
  });

  it("covers whole Monday-start weeks including today, grouped by status", () => {
    const a = task({ id: "a", status: "done", dueDate: "2026-10-28" });
    const b = task({ id: "b", startDate: "2026-11-02", dueDate: "2026-11-04", dependsOn: ["a"] });
    const m = task({ id: "m", type: "milestone", dueDate: "2026-11-12", dependsOn: ["b", "missing"] });
    const model = buildGanttModel([a, b, m], { today: "2026-10-29", dayWidth: 10, rowHeight: 20, sectionHeight: 5 })!;

    expect(model.rangeStart).toBe("2026-10-26"); // a Monday
    expect(model.totalDays).toBe(21);
    expect(model.weeks.map((w) => w.label)).toEqual(["Oct 26", "Nov 2", "Nov 9"]);
    expect(model.days[5]).toMatchObject({ weekend: true, dayNum: 31 });
    expect(model.today).toEqual({ xPx: 35, label: "Oct 29" });
    expect(model.sections.map((s) => s.status)).toEqual(["todo", "done"]);

    const rows = new Map(model.sections.flatMap((s) => s.rows).map((r) => [r.task.id, r]));
    expect(rows.get("b")).toMatchObject({ xPx: 70, wPx: 30, start: "2026-11-02", end: "2026-11-04" });
    expect(rows.get("m")).toMatchObject({ milestone: true, xPx: 175, wPx: 0 });
    expect(rows.get("a")).toMatchObject({ progress: 1, wPx: 30 });

    // a→b and b→m drawn; the dangling dependency is skipped.
    expect(model.connectors.map((c) => `${c.from}>${c.to}`).sort()).toEqual(["a>b", "b>m"]);
    expect(model.connectors.every((c) => !c.conflict)).toBe(true);
  });

  it("flags a dependent that starts before its dependency is due", () => {
    const a = task({ id: "a", startDate: "2026-11-02", dueDate: "2026-11-09" });
    const b = task({ id: "b", startDate: "2026-11-03", dependsOn: ["a", "b"] });
    const model = buildGanttModel([a, b], { today: "2026-11-02" })!;
    expect(model.connectors).toHaveLength(1);
    expect(model.connectors[0]).toMatchObject({ from: "a", to: "b", conflict: true });
  });

  it("caps the window so one typo'd year can't lay out a million days", () => {
    const typo = task({ id: "typo", startDate: "0226-11-02", dueDate: "9999-12-31" });
    const model = buildGanttModel([typo, task({ dueDate: "2026-10-30" })], { today: "2026-10-29" })!;
    expect(model.totalDays).toBeLessThanOrEqual(5 * 366 + 14);
    const row = model.sections[0]!.rows.find((r) => r.task.id === "typo")!;
    expect(row).toMatchObject({ clipped: true, xPx: 0, start: "0226-11-02", end: "9999-12-31" });
    expect(row.wPx).toBe(model.timelineW);
  });

  it("reads two-digit years literally rather than as 19xx", () => {
    expect(dayToIso(parseTaskDay("0026-11-02")!)).toBe("0026-11-02");
  });

  it("keeps a far-off today in range", () => {
    const model = buildGanttModel([task({ dueDate: "2026-10-27" })], { today: "2026-12-25" })!;
    expect(model.today?.label).toBe("Dec 25");
    expect(model.days.at(-1)!.xPx).toBe((model.totalDays - 1) * model.dayW);
  });
});

describe("tasksToMermaidGantt", () => {
  it("writes sections, keys, status tags, milestones and whole-day durations", () => {
    const out = tasksToMermaidGantt(
      [
        task({ key: "FWD-1", title: "Auth API", status: "in_progress", startDate: "2026-11-02", dueDate: "2026-11-04" }),
        task({ key: "FWD-2", title: "Launch", type: "milestone", dueDate: "2026-11-20" }),
        task({ key: "FWD-3", title: "Old bug", status: "done" }),
        task({ key: "FWD-4", title: "Blocked", status: "blocked", dueDate: "Jun 24" }),
      ],
      { title: "Shop" },
    );
    expect(out).toBe(
      [
        "gantt",
        "  title Shop",
        "  dateFormat YYYY-MM-DD",
        "  axisFormat %b %d",
        "  section To do",
        "  FWD-2 Launch :milestone, t1, 2026-11-20, 0d",
        "  section In progress",
        "  FWD-1 Auth API :active, t2, 2026-11-02, 3d",
        "  section Blocked",
        "  FWD-4 Blocked :crit, t3, 2026-10-26, 1d",
        "  section Done",
        "  FWD-3 Old bug :done, t4, 2026-10-26, 1d",
      ].join("\n"),
    );
  });

  it("keeps hostile titles on one valid line", () => {
    const out = tasksToMermaidGantt([
      task({ key: "FWD-9", title: "title: x; #1 <script>alert(1)</script>\nsection Evil" }),
    ]);
    const line = out.split("\n").at(-1)!;
    expect(out.split("\n")).toHaveLength(5);
    expect(line.indexOf(":")).toBe(line.lastIndexOf(":"));
    expect(line).not.toMatch(/[<>;#]/);
    expect(line.startsWith("  FWD-9 title")).toBe(true);
  });

  it("prints only the header for an empty project", () => {
    expect(tasksToMermaidGantt([])).toBe("gantt\n  dateFormat YYYY-MM-DD\n  axisFormat %b %d");
  });
});

describe("startDate on the contract", () => {
  it("accepts an ISO date and rejects anything else", () => {
    expect(() => task({ startDate: "2026-11-02" })).not.toThrow();
    for (const bad of ["next week", "2026-02-30", "2026-11-02T10:00:00Z"]) {
      expect(() => task({ startDate: bad })).toThrow();
    }
  });

  it("logs setting and clearing it in the activity feed", () => {
    const t = newTask({ title: "T", startDate: "2026-11-02" }, { actor: "u1" });
    expect(t.startDate).toBe("2026-11-02");
    const moved = applyTaskChange(t, { startDate: "2026-11-09" }, "u2");
    expect(moved.activity.at(-1)).toMatchObject({ verb: "set start date", target: "2026-11-09" });
    const cleared = applyTaskChange(moved, { startDate: undefined }, "u2");
    expect(cleared.startDate).toBeUndefined();
    expect(cleared.activity.at(-1)).toMatchObject({ verb: "cleared the start date" });
  });
});
