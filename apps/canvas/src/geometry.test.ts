import { describe, it, expect } from "vitest";
import { contains, findParent, descendants, snap } from "./geometry.js";
import type { DesignElement } from "forward-core";

function el(
  id: string,
  type: DesignElement["type"],
  rect: { x: number; y: number; width: number; height: number },
  parentId: string | null = null,
): DesignElement {
  return {
    id,
    type,
    name: id,
    parentId,
    ...rect,
    updatedAt: "2026-05-28T11:45:00Z",
  };
}

describe("contains", () => {
  it("detects full containment", () => {
    expect(
      contains(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 10, y: 10, width: 20, height: 20 },
      ),
    ).toBe(true);
  });
  it("rejects overflow", () => {
    expect(
      contains(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 90, y: 0, width: 20, height: 20 },
      ),
    ).toBe(false);
  });
});

describe("findParent", () => {
  const frameBig = el("big", "frame", { x: 0, y: 0, width: 400, height: 400 });
  const frameSmall = el("small", "frame", {
    x: 50,
    y: 50,
    width: 100,
    height: 100,
  });
  const rect = el("r", "rectangle", { x: 60, y: 60, width: 20, height: 20 });

  it("picks the smallest containing frame", () => {
    expect(findParent(rect, "r", [frameBig, frameSmall])).toBe("small");
  });
  it("ignores non-frames and self", () => {
    const other = el("o", "rectangle", { x: 0, y: 0, width: 400, height: 400 });
    expect(findParent(rect, "r", [other])).toBeNull();
  });
  it("returns null when nothing contains it", () => {
    const loose = el("l", "rectangle", {
      x: 500,
      y: 500,
      width: 10,
      height: 10,
    });
    expect(findParent(loose, "l", [frameBig, frameSmall])).toBeNull();
  });
});

describe("descendants", () => {
  it("collects transitive children", () => {
    const els = [
      el("frame", "frame", { x: 0, y: 0, width: 100, height: 100 }),
      el("child", "rectangle", { x: 1, y: 1, width: 1, height: 1 }, "frame"),
      el("grand", "text", { x: 2, y: 2, width: 1, height: 1 }, "child"),
      el("outside", "rectangle", { x: 9, y: 9, width: 1, height: 1 }, null),
    ];
    expect(descendants("frame", els).sort()).toEqual(["child", "grand"]);
  });
});

describe("snap", () => {
  it("snaps a left edge to a nearby left edge", () => {
    const moving = { x: 103, y: 200, width: 50, height: 20 };
    const other = { x: 100, y: 0, width: 50, height: 20 };
    const result = snap(moving, [other]);
    expect(result.dx).toBe(-3); // 103 -> 100
    expect(result.vGuides).toContain(100);
  });
  it("does not snap when outside the threshold", () => {
    const moving = { x: 200, y: 200, width: 50, height: 20 };
    const other = { x: 100, y: 0, width: 50, height: 20 };
    const result = snap(moving, [other]);
    expect(result.dx).toBe(0);
    expect(result.vGuides).toHaveLength(0);
  });
});
