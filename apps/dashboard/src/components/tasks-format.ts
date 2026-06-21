import type { TaskPriority, TaskStatus, TaskType } from "forward-core";
import type { Member } from "../api/client.js";

/** Lifecycle order — drives the filter bar and the status picker. */
export const STATUS_ORDER: TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
];

export const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "To do", color: "#9c9488" },
  in_progress: { label: "In progress", color: "#3a6ea8" },
  blocked: { label: "Blocked", color: "#b3402a" },
  done: { label: "Done", color: "#5b8c6e" },
};

export const PRIORITY_ORDER: TaskPriority[] = ["low", "medium", "high", "urgent"];

export const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "#9c9488" },
  medium: { label: "Medium", color: "#a98f5e" },
  high: { label: "High", color: "#c0492f" },
  urgent: { label: "Urgent", color: "#c0492f" },
};

export const TYPE_ORDER: TaskType[] = ["bug", "feature", "task"];

export const TYPE_META: Record<TaskType, { label: string; color: string }> = {
  bug: { label: "Bug", color: "#c0492f" },
  feature: { label: "Feature", color: "#3a6ea8" },
  task: { label: "Task", color: "#7a6f60" },
};

/** Known label names get a stable colour; anything else falls back to the accent. */
export const LABEL_COLORS: Record<string, string> = {
  bug: "#c0492f",
  important: "#bf5a36",
  backend: "#3a6ea8",
  frontend: "#5b8c6e",
  design: "#8a6db0",
  infra: "#a98f5e",
  blocked: "#7a6f60",
};

export const KNOWN_LABELS = Object.keys(LABEL_COLORS);

export function labelColor(name: string): string {
  return LABEL_COLORS[name] ?? "#bf5a36";
}

/**
 * Resolve an activity value (a type/status/priority label or a label name) to
 * its colour so the feed can highlight what changed. Returns undefined for
 * free-form values like people or dates, which render as plain text.
 */
export function metaColor(value: string): string | undefined {
  const v = value.trim();
  for (const m of Object.values(STATUS_META)) if (m.label === v) return m.color;
  for (const m of Object.values(TYPE_META)) if (m.label === v) return m.color;
  for (const m of Object.values(PRIORITY_META)) if (m.label === v) return m.color;
  if (KNOWN_LABELS.includes(v)) return labelColor(v);
  return undefined;
}

/** `#rrggbb` → `rgba(...)` so a colour can be used as a faint chip background. */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const AVATAR_COLORS = [
  "#3a6ea8",
  "#a98f5e",
  "#8a6db0",
  "#5b8c6e",
  "#bf5a36",
  "#7a6f60",
  "#c0492f",
  "#b3402a",
];

/** A member resolved for display: a name, two-letter initials and a stable colour. */
export interface Person {
  uid: string;
  name: string;
  initials: string;
  color: string;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initialsFrom(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Resolve a uid against the roster for display. Members only carry uid + email,
 * so we derive a friendly name from the email's local part (or the raw uid) and
 * a deterministic avatar colour. The signed-in user shows as "You".
 */
export function personOf(
  uid: string,
  members: Member[] | undefined,
  myUid: string | undefined,
): Person {
  const member = members?.find((m) => m.uid === uid);
  const base = member?.email
    ? member.email.split("@")[0]!
    : uid;
  const name = uid === myUid ? "You" : base;
  return {
    uid,
    name,
    initials: uid === myUid ? "YO" : initialsFrom(base),
    color: AVATAR_COLORS[hash(uid) % AVATAR_COLORS.length]!,
  };
}

/** Compact relative time for the activity feed and "updated" stamp. */
export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return shortDate(iso);
}

/** "Jun 24" style date for due/created stamps. Tolerates non-date labels. */
export function shortDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // already a free-form label
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A stored due-date → the `YYYY-MM-DD` value an <input type="date"> expects. */
export function dateInputValue(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return ""; // free-form label has no date value
  return d.toISOString().slice(0, 10);
}
