import type { Task, TaskStatus } from "./schema.js";
import { STATUS_LABELS } from "./tasks.js";

/**
 * The task layer's timeline (Gantt) — the ONE place a task's span on the
 * calendar is decided, so the canvas Timeline view, the Mermaid `gantt` export,
 * the `get_task_timeline` agent tool and the PR digest all agree.
 *
 * The rule: a task starts on its `startDate`, else on the day it was created; it
 * ends on its `dueDate` when that is an ISO date on or after the start, else on
 * the start day (a one-day bar). A milestone is a single point on its due date
 * (else its start). Dependencies never move a date — they are drawn, not solved.
 *
 * Dates are calendar days, read from the `YYYY-MM-DD` prefix exactly as written
 * (so `createdAt`, always UTC, lands on its UTC day) and handled as whole-day
 * integers — no time zone, no clock: "today" is passed in. Free-form labels
 * ("Jun 24", "next week") are not dates here; `new Date("Jun 24")` would read
 * that as 2001.
 */

const DAY_MS = 86_400_000;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Lifecycle order the timeline groups rows by (same as the task list). */
export const GANTT_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

/**
 * The widest window a drawn timeline covers, around today: one typo'd year
 * (`0226-11-02`) must not lay out a million day cells. Bars beyond it are
 * clipped to its edge (their real dates stay on the row).
 */
const MAX_PAST_DAYS = 2 * 366;
const MAX_FUTURE_DAYS = 3 * 366;

/** How "filled" a bar looks, by lifecycle status. */
const PROGRESS: Record<TaskStatus, number> = {
  todo: 0.06,
  in_progress: 0.5,
  blocked: 0.35,
  done: 1,
};

/**
 * A stored date string as a whole-day number (days since 1970-01-01), or null
 * when it is not an ISO date. Accepts `YYYY-MM-DD`, optionally followed by an
 * ISO time, and rejects impossible dates like `2026-02-30`.
 */
export function parseTaskDay(value: string | undefined): number | null {
  const m = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // setUTCFullYear, not Date.UTC, which reads years 0–99 as 1900–1999.
  const back = new Date(0);
  back.setUTCFullYear(y, mo - 1, d);
  const ms = back.getTime();
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / DAY_MS);
}

/**
 * Whether a value is exactly a real calendar date `YYYY-MM-DD` — the form a
 * new or changed `dueDate` must take (no time part, no free-form label).
 */
export function isIsoDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseTaskDay(value) !== null;
}

/** A whole-day number back to `YYYY-MM-DD`. */
export function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Where one task sits on the calendar, by the rule above. */
export interface TaskSpan {
  task: Task;
  /** First day (inclusive). */
  start: number;
  /** Last day (inclusive). Equals `start` for a milestone or a one-day bar. */
  end: number;
  milestone: boolean;
  /** The task has a `dueDate` that isn't an ISO date, so it couldn't plot. */
  dueUnparsed: boolean;
}

export function taskSpan(task: Task): TaskSpan {
  // createdAt is schema-checked as an ISO datetime, so it always parses.
  const start = parseTaskDay(task.startDate) ?? parseTaskDay(task.createdAt) ?? 0;
  const due = parseTaskDay(task.dueDate);
  const dueUnparsed = Boolean(task.dueDate?.trim()) && due === null;
  if (task.type === "milestone") {
    const at = due ?? start;
    return { task, start: at, end: at, milestone: true, dueUnparsed };
  }
  const end = due !== null && due >= start ? due : start;
  return { task, start, end, milestone: false, dueUnparsed };
}

/** Spans grouped by status (lifecycle order), each group sorted by start, then key. */
function groupedSpans(tasks: Task[]): { status: TaskStatus; spans: TaskSpan[] }[] {
  const spans = tasks.map(taskSpan);
  return GANTT_STATUS_ORDER.map((status) => ({
    status,
    spans: spans
      .filter((s) => s.task.status === status)
      .sort((a, b) => a.start - b.start || (a.task.key ?? "").localeCompare(b.task.key ?? "", undefined, { numeric: true })),
  })).filter((g) => g.spans.length > 0);
}

/**
 * Every dependency cycle among the tasks, each as the ids in it (in input
 * order). A task that depends on itself is a cycle of one. Dangling ids are
 * ignored — `dependsOn` is a soft reference. Never loops on a cyclic graph.
 */
export function findDependencyCycles(tasks: Task[]): string[][] {
  const ids = new Set(tasks.map((t) => t.id));
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn.filter((d) => ids.has(d))]));
  const order = new Map(tasks.map((t, i) => [t.id, i]));

  // Tarjan's strongly-connected components, iterative so a long chain can't
  // overflow the stack.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let next = 0;

  for (const root of ids) {
    if (index.has(root)) continue;
    const work: { id: string; i: number }[] = [{ id: root, i: 0 }];
    index.set(root, next);
    low.set(root, next++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1]!;
      const out = deps.get(frame.id)!;
      if (frame.i < out.length) {
        const d = out[frame.i++]!;
        if (!index.has(d)) {
          index.set(d, next);
          low.set(d, next++);
          stack.push(d);
          onStack.add(d);
          work.push({ id: d, i: 0 });
        } else if (onStack.has(d)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(d)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) === index.get(frame.id)) {
        const scc: string[] = [];
        let id: string;
        do {
          id = stack.pop()!;
          onStack.delete(id);
          scc.push(id);
        } while (id !== frame.id);
        if (scc.length > 1 || deps.get(frame.id)!.includes(frame.id)) {
          cycles.push(scc.sort((a, b) => order.get(a)! - order.get(b)!));
        }
      }
    }
  }
  return cycles.sort((a, b) => order.get(a[0]!)! - order.get(b[0]!)!);
}

// --------------------------------------------------------------------------
// Layout — pure geometry for a drawn timeline (the canvas turns it into DOM)
// --------------------------------------------------------------------------

export interface GanttOptions {
  /** The viewer's today as `YYYY-MM-DD` — kept in view and marked. */
  today: string;
  dayWidth?: number;
  rowHeight?: number;
  sectionHeight?: number;
}

export interface GanttDay {
  /** Day of the month. */
  dayNum: number;
  weekend: boolean;
  today: boolean;
  xPx: number;
}

export interface GanttWeek {
  /** Its Monday, e.g. "Oct 26". */
  label: string;
  xPx: number;
  widthPx: number;
}

export interface GanttRow {
  task: Task;
  /** Milestones render as a diamond at one date; tasks as a bar. */
  milestone: boolean;
  /** Task: the bar's left edge. Milestone: the diamond's centre. */
  xPx: number;
  /** Task only: the bar width (0 for a milestone). */
  wPx: number;
  /** The row's top, from the top of the body. */
  yPx: number;
  /** 0–1 fill of the bar, by status. */
  progress: number;
  /** First and last day, `YYYY-MM-DD`. */
  start: string;
  end: string;
  dueUnparsed: boolean;
  /** The span runs past the drawn window, so the bar is cut at its edge. */
  clipped: boolean;
}

/** A finish-to-start dependency drawn as an elbow connector between two rows. */
export interface GanttConnector {
  /** The task depended on. */
  from: string;
  /** The dependent task. */
  to: string;
  /** SVG path from the dependency's end to the dependent's start. */
  path: string;
  dotCx: number;
  dotCy: number;
  /** The dependent starts before its dependency is due to finish. */
  conflict: boolean;
}

export interface GanttSection {
  status: TaskStatus;
  label: string;
  /** The section header's top, from the top of the body. */
  yPx: number;
  rows: GanttRow[];
}

export interface GanttModel {
  /** First day shown, `YYYY-MM-DD` (always a Monday). */
  rangeStart: string;
  totalDays: number;
  dayW: number;
  rowH: number;
  secH: number;
  timelineW: number;
  bodyH: number;
  days: GanttDay[];
  weeks: GanttWeek[];
  sections: GanttSection[];
  connectors: GanttConnector[];
  today: { xPx: number; label: string } | null;
}

/**
 * Lay the tasks out on a day-granular axis: whole Monday-start weeks (at least
 * two) covering every task and today — within about two years back and three
 * ahead of today — with rows grouped by status. Returns null when there is
 * nothing to plot.
 */
export function buildGanttModel(tasks: Task[], opts: GanttOptions): GanttModel | null {
  if (tasks.length === 0) return null;
  const dayW = opts.dayWidth ?? 28;
  const rowH = opts.rowHeight ?? 40;
  const secH = opts.sectionHeight ?? 30;
  const groups = groupedSpans(tasks);
  const today = parseTaskDay(opts.today);

  let min = Infinity;
  let max = -Infinity;
  for (const g of groups) {
    for (const s of g.spans) {
      min = Math.min(min, s.start);
      max = Math.max(max, s.end);
    }
  }
  if (today !== null) {
    min = Math.min(min, today);
    max = Math.max(max, today);
  }
  const anchor = today ?? min;
  min = Math.max(min, anchor - MAX_PAST_DAYS);
  max = Math.min(max, anchor + MAX_FUTURE_DAYS);

  // 1970-01-01 was a Thursday: (day + 3) % 7 is days since Monday.
  const rangeStart = min - ((((min + 3) % 7) + 7) % 7);
  const totalDays = Math.max(14, Math.ceil((max - rangeStart + 1) / 7) * 7);
  const lastDay = rangeStart + totalDays - 1;
  const x = (day: number) => (Math.min(Math.max(day, rangeStart), lastDay) - rangeStart) * dayW;

  const days: GanttDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date((rangeStart + i) * DAY_MS);
    const dow = d.getUTCDay();
    days.push({
      dayNum: d.getUTCDate(),
      weekend: dow === 0 || dow === 6,
      today: rangeStart + i === today,
      xPx: i * dayW,
    });
  }

  const weeks: GanttWeek[] = [];
  for (let w = 0; w * 7 < totalDays; w++) {
    const d = new Date((rangeStart + w * 7) * DAY_MS);
    weeks.push({ label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, xPx: w * 7 * dayW, widthPx: 7 * dayW });
  }

  // Each row's anchor points, so connectors can reach a row in any section.
  const geo = new Map<string, { startX: number; endX: number; cy: number; start: number; end: number }>();
  const sections: GanttSection[] = [];
  let y = 0;
  for (const { status, spans } of groups) {
    const section: GanttSection = { status, label: STATUS_LABELS[status], yPx: y, rows: [] };
    y += secH;
    for (const s of spans) {
      const cy = y + rowH / 2;
      const base = {
        task: s.task,
        yPx: y,
        progress: PROGRESS[status],
        start: dayToIso(s.start),
        end: dayToIso(s.end),
        dueUnparsed: s.dueUnparsed,
        clipped: s.start < rangeStart || s.end > lastDay,
      };
      if (s.milestone) {
        const cx = x(s.start) + dayW / 2;
        geo.set(s.task.id, { startX: cx - 9, endX: cx + 9, cy, start: s.start, end: s.end });
        section.rows.push({ ...base, milestone: true, xPx: cx, wPx: 0 });
      } else {
        const wPx = x(s.end) - x(s.start) + dayW;
        geo.set(s.task.id, { startX: x(s.start), endX: x(s.start) + wPx, cy, start: s.start, end: s.end });
        section.rows.push({ ...base, milestone: false, xPx: x(s.start), wPx });
      }
      y += rowH;
    }
    sections.push(section);
  }

  // From each dependency's end to the dependent's start. Dangling ids and
  // self-dependencies are skipped (soft references, cycles are validate's job).
  const connectors: GanttConnector[] = [];
  for (const { spans } of groups) {
    for (const { task } of spans) {
      const to = geo.get(task.id)!;
      for (const depId of new Set(task.dependsOn)) {
        const from = depId === task.id ? undefined : geo.get(depId);
        if (!from) continue;
        const midX = Math.max(from.endX + 12, to.startX - 12);
        connectors.push({
          from: depId,
          to: task.id,
          path: `M ${from.endX} ${from.cy} H ${midX} V ${to.cy} H ${to.startX}`,
          dotCx: to.startX,
          dotCy: to.cy,
          conflict: from.end > to.start,
        });
      }
    }
  }

  const todayIn = today !== null && today >= rangeStart && today < rangeStart + totalDays;
  return {
    rangeStart: dayToIso(rangeStart),
    totalDays,
    dayW,
    rowH,
    secH,
    timelineW: totalDays * dayW,
    bodyH: y,
    days,
    weeks,
    sections,
    connectors,
    today: todayIn
      ? {
          xPx: x(today) + dayW / 2,
          label: `${MONTHS[new Date(today * DAY_MS).getUTCMonth()]} ${new Date(today * DAY_MS).getUTCDate()}`,
        }
      : null,
  };
}

// --------------------------------------------------------------------------
// Mermaid — the export/print renderer, like entity.ts and infra-flow.ts
// --------------------------------------------------------------------------

/**
 * Make user text safe on a Mermaid gantt line. A task line is `name :data`, and
 * the name may not hold `:`, `;` or `#` (they end it or start a comment), so
 * those become look-alikes; newlines collapse; `<`/`>` become angle quotes so
 * no renderer can read a tag out of a title.
 */
function ganttText(s: string): string {
  return s
    .replace(/[\r\n]+/g, " ")
    .replace(/:/g, "꞉")
    .replace(/;/g, ",")
    .replace(/#/g, "＃")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Serialise the tasks to a Mermaid `gantt` chart: one section per status, one
 * line per task, prefixed with its key (which also keeps a title like "title
 * page" from reading as a Mermaid keyword). Dates come from {@link taskSpan},
 * written as a start plus a whole-day duration so there's no end-date ambiguity.
 * Done tasks are tagged `done`, in-progress `active`, blocked `crit`. Mermaid
 * has no dependency arrows for explicit dates, so `dependsOn` isn't drawn here.
 */
export function tasksToMermaidGantt(tasks: Task[], opts: { title?: string } = {}): string {
  const lines = ["gantt"];
  const title = opts.title ? ganttText(opts.title) : "";
  if (title) lines.push(`  title ${title}`);
  lines.push("  dateFormat YYYY-MM-DD", "  axisFormat %b %d");
  let n = 0;
  for (const { status, spans } of groupedSpans(tasks)) {
    lines.push(`  section ${STATUS_LABELS[status]}`);
    for (const s of spans) {
      const name = ganttText(`${s.task.key ?? "Task"} ${s.task.title}`);
      const tags = [
        ...(s.milestone ? ["milestone"] : []),
        ...(status === "done" ? ["done"] : status === "in_progress" ? ["active"] : status === "blocked" ? ["crit"] : []),
      ];
      const duration = s.milestone ? "0d" : `${s.end - s.start + 1}d`;
      lines.push(`  ${name} :${[...tags, `t${++n}`, dayToIso(s.start), duration].join(", ")}`);
    }
  }
  return lines.join("\n");
}
