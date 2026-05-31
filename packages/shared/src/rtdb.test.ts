import { describe, it, expect } from "vitest";
import { normalizeList } from "./rtdb.js";

describe("normalizeList", () => {
  it("returns [] for null/undefined (empty RTDB path)", () => {
    expect(normalizeList(null)).toEqual([]);
    expect(normalizeList(undefined)).toEqual([]);
  });

  it("passes through a literal array", () => {
    expect(normalizeList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("drops null holes Firebase leaves in sparse arrays", () => {
    expect(normalizeList([null, "a", null, "b"])).toEqual(["a", "b"]);
  });

  it("converts a push-keyed object into an ordered array", () => {
    // Push keys are time-ordered lexicographically.
    const pushKeyed = {
      "-Nb": { v: 2 },
      "-Na": { v: 1 },
      "-Nc": { v: 3 },
    };
    expect(normalizeList(pushKeyed)).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
  });

  it("returns [] for a primitive", () => {
    expect(normalizeList("nope")).toEqual([]);
  });
});
