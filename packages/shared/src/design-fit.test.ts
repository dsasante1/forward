import { describe, expect, it } from "vitest";
import { estimateTextSize, fitWarnings, outsideParent } from "./design-fit.js";

describe("estimateTextSize", () => {
  it("grows with length, size, weight and lines", () => {
    const base = estimateTextSize("Sign in", { fontSize: 16 });
    expect(base.height).toBe(20);
    expect(estimateTextSize("Sign in to Harbor", { fontSize: 16 }).width).toBeGreaterThan(base.width);
    expect(estimateTextSize("Sign in", { fontSize: 32 }).width).toBe(base.width * 2);
    expect(estimateTextSize("Sign in", { fontSize: 16, fontWeight: 700 }).width).toBeGreaterThan(base.width);
    expect(estimateTextSize("a\nb\nc", { fontSize: 10 }).height).toBe(37);
  });
});

describe("fitWarnings", () => {
  const frame = { name: "Dash", x: 1000, y: 0, width: 400, height: 300 };
  it("says nothing about a child that fits", () => {
    expect(fitWarnings({ type: "rectangle", x: 1010, y: 10, width: 50, height: 20 }, frame)).toEqual([]);
  });
  it("flags a child entirely outside its parent, and one past an edge", () => {
    expect(outsideParent({ x: 10, y: 10, width: 50, height: 20 }, frame)).toBe(true);
    expect(fitWarnings({ name: "Btn", type: "rectangle", x: 10, y: 10, width: 50, height: 20 }, frame)[0]).toMatch(/"Btn" .* entirely outside "Dash".*relative:true/);
    expect(fitWarnings({ type: "rectangle", x: 1380, y: 290, width: 50, height: 20 }, frame)).toEqual([
      `The element extends past "Dash"'s right by 30px, bottom by 10px.`,
    ]);
  });
  it("flags text that won't fit its box", () => {
    const text = { type: "text", text: "A much longer label than the box", x: 0, y: 0, width: 80, height: 20, style: { fontSize: 14 } };
    expect(fitWarnings(text)[0]).toMatch(/text needs about \d+×\d+ but its box is 80×20/);
    expect(fitWarnings({ ...text, ...estimateTextSize(text.text, text.style) })).toEqual([]);
  });
});
