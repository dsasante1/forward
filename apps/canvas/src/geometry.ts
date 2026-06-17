import type { DesignElement } from "schema-nexus-core";

/** Axis-aligned rectangle in absolute canvas space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SNAP_THRESHOLD = 6;

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function area(r: Rect): number {
  return r.width * r.height;
}

/**
 * Find the best parent for `rect`: the smallest frame that fully contains it,
 * excluding the element itself. Returns null when nothing contains it — so a
 * dropped element nests into the tightest frame, Figma-style.
 */
export function findParent(
  rect: Rect,
  selfId: string,
  elements: Iterable<DesignElement>,
): string | null {
  let best: DesignElement | null = null;
  for (const el of elements) {
    if (el.id === selfId || el.type !== "frame") continue;
    if (contains(el, rect) && (!best || area(el) < area(best))) best = el;
  }
  return best ? best.id : null;
}

/** All descendant ids of `id` (transitive), so moving a frame moves its kids. */
export function descendants(
  id: string,
  elements: Iterable<DesignElement>,
): string[] {
  const all = [...elements];
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const el of all) {
      if (el.parentId === current) {
        out.push(el.id);
        stack.push(el.id);
      }
    }
  }
  return out;
}

export interface SnapResult {
  dx: number;
  dy: number;
  /** Absolute x coordinates of vertical guide lines to draw. */
  vGuides: number[];
  /** Absolute y coordinates of horizontal guide lines to draw. */
  hGuides: number[];
}

/**
 * Snap a moving rect's edges (and centre) to nearby other-element edges.
 * Returns the small dx/dy nudge to apply plus guide lines to render.
 */
export function snap(
  rect: Rect,
  others: Iterable<Rect>,
  threshold = SNAP_THRESHOLD,
): SnapResult {
  const xs = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
  const ys = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];

  let dx = 0;
  let dy = 0;
  let bestX = threshold + 1;
  let bestY = threshold + 1;
  const vGuides: number[] = [];
  const hGuides: number[] = [];

  for (const o of others) {
    const targetXs = [o.x, o.x + o.width / 2, o.x + o.width];
    const targetYs = [o.y, o.y + o.height / 2, o.y + o.height];
    for (const sx of xs) {
      for (const tx of targetXs) {
        const d = Math.abs(sx - tx);
        if (d <= threshold && d < bestX) {
          bestX = d;
          dx = tx - sx;
          vGuides.length = 0;
          vGuides.push(tx);
        }
      }
    }
    for (const sy of ys) {
      for (const ty of targetYs) {
        const d = Math.abs(sy - ty);
        if (d <= threshold && d < bestY) {
          bestY = d;
          dy = ty - sy;
          hGuides.length = 0;
          hGuides.push(ty);
        }
      }
    }
  }

  return { dx, dy, vGuides, hGuides };
}
