import { describe, it, expect } from "vitest";
import { GridPlacer, type Geom } from "./layout.js";

const geom = (x: number, y: number, w = 10, h = 10): Geom => ({
  x,
  y,
  width: w,
  height: h,
  parentId: null,
});

describe("GridPlacer", () => {
  it("starts at the origin when there is no existing content", () => {
    const p = new GridPlacer([]);
    expect(p.place({}, undefined, 100, 50)).toMatchObject({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      parentId: null,
    });
  });

  it("drops new nodes in a fresh band below all existing content", () => {
    const p = new GridPlacer([geom(0, 0, 10, 100), geom(0, 50, 10, 80)]); // max bottom 130
    expect(p.place({}, undefined, 10, 10).y).toBe(130 + 48); // + gap
  });

  it("never moves a node that already exists (reuses its position)", () => {
    const p = new GridPlacer([]);
    const previous = geom(999, 888, 20, 30);
    expect(p.place({}, previous, 10, 10)).toMatchObject({ x: 999, y: 888, width: 20, height: 30 });
  });

  it("honors an explicit position over the grid", () => {
    const p = new GridPlacer([]);
    expect(p.place({ x: 5, y: 7 }, undefined, 10, 10)).toMatchObject({ x: 5, y: 7 });
  });

  it("consumes a grid slot only for genuinely new, unpositioned nodes", () => {
    const p = new GridPlacer([]);
    p.place({ x: 1, y: 1 }, undefined, 10, 10); // explicit → no slot taken
    p.place({}, geom(2, 2), 10, 10); // has previous → no slot taken
    // The first true grid slot is therefore still the origin.
    expect(p.place({}, undefined, 10, 10)).toMatchObject({ x: 0, y: 0 });
  });

  it("wraps to a new row after the column count", () => {
    const p = new GridPlacer([]); // defaults: cols 5, cellW 220, cellH 180
    const slots = Array.from({ length: 6 }, () => p.place({}, undefined, 10, 10));
    expect(slots[0]).toMatchObject({ x: 0, y: 0 });
    expect(slots[4]).toMatchObject({ x: 880, y: 0 });
    expect(slots[5]).toMatchObject({ x: 0, y: 180 });
  });
});
