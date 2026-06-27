// --------------------------------------------------------------------------
// Pure layout maths for the Tasks timeline (Gantt) view. Given the project's
// tasks it lays them out on a day-granular date axis: each task becomes a bar
// running from its createdAt to its dueDate, grouped into sections by status.
// No React, no DOM — just geometry, so it can be unit-tested in isolation. The
// component turns these numbers into positioned elements.
// --------------------------------------------------------------------------

import type { Task, TaskStatus } from "forward-core";
import { STATUS_META, STATUS_ORDER, TYPE_META, tint } from "./tasks-format.js";

const DAY_MS = 86_400_000;

/** Pixel constants shared with the CSS so the left labels and the timeline
 * rows stay vertically aligned. */
export const GANTT_DAY_W = 28;
export const GANTT_LABEL_W = 230;
export const GANTT_ROW_H = 46;
export const GANTT_SEC_H = 34;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** How "filled" a bar looks, by lifecycle status. */
const PROGRESS: Record<TaskStatus, number> = {
  todo: 0.06,
  in_progress: 0.5,
  blocked: 0.35,
  done: 1,
};

export interface GanttDay {
  dayNum: number;
  weekend: boolean;
  today: boolean;
  xPx: number;
}

export interface GanttWeek {
  label: string;
  widthPx: number;
}

export interface GanttRow {
  task: Task;
  /** Milestones render as a diamond at a single date; tasks as a bar. */
  milestone: boolean;
  /** Task: the bar's left edge. Milestone: the diamond's centre. */
  xPx: number;
  /** Task only: the bar width. */
  wPx: number;
  /** 0–1 fill of the bar (tasks only). */
  progress: number;
  /** Colour, keyed off the task type (matches the list view's type dot). */
  color: string;
  done: boolean;
}

/** A finish-to-start dependency drawn as an elbow connector between two rows. */
export interface GanttConnector {
  /** SVG path from the dependency's end to the dependent's start. */
  path: string;
  dotCx: number;
  dotCy: number;
  color: string;
}

export interface GanttSection {
  status: TaskStatus;
  label: string;
  color: string;
  count: number;
  rows: GanttRow[];
}

export interface GanttModel {
  dayW: number;
  labelW: number;
  rowH: number;
  secH: number;
  timelineW: number;
  bodyH: number;
  days: GanttDay[];
  weeks: GanttWeek[];
  sections: GanttSection[];
  connectors: GanttConnector[];
  today: { xPx: number; label: string } | null;
  plottedCount: number;
}

/** Parse a stored timestamp/label to a midnight Date, or null if not a date
 * (free-form due labels like "next week" can't be plotted). */
function parseDay(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday on or before the given day — so week columns start on Mondays. */
function startOfWeek(d: Date): Date {
  const daysSinceMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday);
}

function dayIndex(rangeStart: Date, d: Date): number {
  return Math.round((d.getTime() - rangeStart.getTime()) / DAY_MS);
}

/**
 * Build the timeline layout. Returns null when there is nothing to plot. Every
 * task is plottable: createdAt always parses, and a missing/free-form dueDate
 * falls back to a same-day (one-cell) bar.
 */
export function buildGanttModel(
  tasks: Task[],
  now: Date = new Date(),
): GanttModel | null {
  if (tasks.length === 0) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const spans = tasks.map((task) => {
    const start = parseDay(task.createdAt) ?? today;
    let end = parseDay(task.dueDate);
    if (!end || end.getTime() < start.getTime()) end = start;
    return { task, start, end };
  });

  let min = spans[0]!.start;
  let max = spans[0]!.end;
  for (const s of spans) {
    if (s.start.getTime() < min.getTime()) min = s.start;
    if (s.end.getTime() > max.getTime()) max = s.end;
  }
  // Always keep "today" inside the window so the marker is visible.
  if (today.getTime() < min.getTime()) min = today;
  if (today.getTime() > max.getTime()) max = today;

  const rangeStart = startOfWeek(min);
  let totalDays = dayIndex(rangeStart, max) + 1;
  totalDays = Math.ceil(totalDays / 7) * 7; // whole weeks
  if (totalDays < 14) totalDays = 14;

  const timelineW = totalDays * GANTT_DAY_W;

  const days: GanttDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(rangeStart.getTime() + i * DAY_MS);
    const dow = d.getDay();
    days.push({
      dayNum: d.getDate(),
      weekend: dow === 0 || dow === 6,
      today: d.getTime() === today.getTime(),
      xPx: i * GANTT_DAY_W,
    });
  }

  const weeks: GanttWeek[] = [];
  for (let w = 0; w * 7 < totalDays; w++) {
    const d = new Date(rangeStart.getTime() + w * 7 * DAY_MS);
    weeks.push({ label: `${MONTHS[d.getMonth()]} · W${w + 1}`, widthPx: 7 * GANTT_DAY_W });
  }

  // Each row's anchor points, accumulated top-down so dependency connectors can
  // find any row's vertical centre regardless of which section it sits in.
  const geo = new Map<
    string,
    { startX: number; endX: number; cy: number; color: string }
  >();

  const sections: GanttSection[] = [];
  let y = 0;
  for (const status of STATUS_ORDER) {
    const inStatus = spans
      .filter((s) => s.task.status === status)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (inStatus.length === 0) continue;

    y += GANTT_SEC_H; // section header / spacer
    const rows = inStatus.map(({ task, start, end }): GanttRow => {
      const cy = y + GANTT_ROW_H / 2;
      const color = TYPE_META[task.type].color;
      y += GANTT_ROW_H;

      if (task.type === "milestone") {
        // A milestone is a point in time (its due date, falling back to start).
        const centerX = dayIndex(rangeStart, end) * GANTT_DAY_W + GANTT_DAY_W / 2;
        geo.set(task.id, { startX: centerX - 9, endX: centerX + 9, cy, color });
        return { task, milestone: true, xPx: centerX, wPx: 0, progress: 0, color, done: status === "done" };
      }

      const sIdx = dayIndex(rangeStart, start);
      const eIdx = dayIndex(rangeStart, end);
      const xPx = sIdx * GANTT_DAY_W;
      const wPx = (eIdx - sIdx + 1) * GANTT_DAY_W;
      geo.set(task.id, { startX: xPx, endX: xPx + wPx, cy, color });
      return { task, milestone: false, xPx, wPx, progress: PROGRESS[status], color, done: status === "done" };
    });

    sections.push({
      status,
      label: STATUS_META[status].label,
      color: STATUS_META[status].color,
      count: rows.length,
      rows,
    });
  }

  const bodyH = y;

  // Dependency connectors: from each dependency's end to the dependent's start.
  // Dangling ids (a dependency that isn't plotted) are skipped, matching the
  // contract's soft-reference semantics.
  const connectors: GanttConnector[] = [];
  for (const { task } of spans) {
    const dependent = geo.get(task.id);
    if (!dependent) continue;
    for (const depId of task.dependsOn) {
      const dep = geo.get(depId);
      if (!dep) continue;
      const x1 = dep.endX;
      const y1 = dep.cy;
      const x2 = dependent.startX;
      const y2 = dependent.cy;
      const midX = Math.max(x1 + 12, x2 - 12);
      connectors.push({
        path: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
        dotCx: x2,
        dotCy: y2,
        color: tint(dependent.color, 0.7),
      });
    }
  }

  const todayIdx = dayIndex(rangeStart, today);
  const todayInRange = todayIdx >= 0 && todayIdx < totalDays;

  return {
    dayW: GANTT_DAY_W,
    labelW: GANTT_LABEL_W,
    rowH: GANTT_ROW_H,
    secH: GANTT_SEC_H,
    timelineW,
    bodyH,
    days,
    weeks,
    sections,
    connectors,
    today: todayInRange
      ? {
          xPx: todayIdx * GANTT_DAY_W + GANTT_DAY_W / 2,
          label: `${MONTHS[today.getMonth()]} ${today.getDate()}`.toUpperCase(),
        }
      : null,
    plottedCount: spans.length,
  };
}
