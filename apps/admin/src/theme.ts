import type { CSSProperties } from "react";
import type { Plan } from "./api.js";

/**
 * Design tokens + small style helpers ported verbatim from the Forward Admin
 * design (Forward Admin.dc.html / support.js). Dark theme, terracotta accent.
 */
export const C = {
  bg: "#0c0d11",
  panel: "#131419",
  panel2: "#191b22",
  border: "rgba(255,255,255,0.07)",
  border2: "rgba(255,255,255,0.12)",
  text: "#e8e5de",
  dim: "#8d8b85",
  faint: "#62615c",
  hover: "rgba(255,255,255,0.03)",
  accent: "#d06a40",
  accentSoft: "rgba(208,106,64,0.14)",
  accentLine: "rgba(208,106,64,0.4)",
  good: "#5db98a",
  warn: "#d6a85b",
  bad: "#d8654a",
};

export const PLAN_COLOR: Record<Plan, string> = {
  solo: "#8a8378",
  team: "#5b8fd6",
  enterprise: "#8a6db0",
};
export const PLAN_LABEL: Record<Plan, string> = {
  solo: "Solo",
  team: "Team",
  enterprise: "Enterprise",
};

export const SYNC = { ok: "#5db98a", degraded: "#d6a85b", error: "#d8654a" };

/** Audit action → category color (matches the design's ATYPE map by prefix). */
export function auditType(action: string): {
  label: string;
  key: string;
  color: string;
} {
  if (action.startsWith("token") || action.startsWith("user.impersonate"))
    return { label: "access", key: "access", color: "#d06a40" };
  if (action.startsWith("user") || action.startsWith("org.suspend") || action.startsWith("org.restore"))
    return { label: "access", key: "access", color: "#d06a40" };
  if (action.startsWith("project") || action.endsWith("delete"))
    return { label: "data", key: "data", color: "#8a6db0" };
  if (action.startsWith("org"))
    return { label: "billing", key: "billing", color: "#5b8c6e" };
  return { label: "system", key: "system", color: "#5b8fd6" };
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function initials(n: string | null | undefined): string {
  if (!n) return "—";
  const p = n.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "—";
}

const PAL = ["#5b8fd6", "#a98f5e", "#8a6db0", "#5b8c6e", "#d06a40", "#3a6ea8"];
export function uColor(n: string | null | undefined): string {
  const s = n ?? "?";
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PAL[h % PAL.length]!;
}

/** A monospace pill badge in a tinted color. */
export function badge(color: string): CSSProperties {
  return {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 10.5,
    padding: "3px 9px",
    borderRadius: 5,
    whiteSpace: "nowrap",
    color,
    background: hexA(color, 0.15),
  };
}

export function planBadge(plan: Plan): CSSProperties {
  return badge(PLAN_COLOR[plan]);
}

/** A rounded status chip with a leading dot baked into its tint. */
export function statusBadge(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    padding: "3px 10px",
    borderRadius: 20,
    whiteSpace: "nowrap",
    color,
    background: hexA(color, 0.13),
  };
}

/** Compute an SVG sparkline (line + filled area) from a numeric series. */
export function spark(vals: number[]): { line: string; area: string } {
  const w = 120;
  const h = 30;
  if (vals.length < 2) return { line: "", area: "" };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const r = max - min || 1;
  const step = w / (vals.length - 1);
  const pts = vals.map(
    (v, i) => [i * step, h - 3 - ((v - min) / r) * (h - 6)] as const,
  );
  const line = "M " + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ");
  return { line, area: `${line} L ${w} ${h} L 0 ${h} Z` };
}

/** Relative "time ago" for ISO timestamps. */
export function ago(iso: string | null): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
