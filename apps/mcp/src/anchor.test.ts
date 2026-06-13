import { describe, it, expect } from "vitest";
import { findAnchorsInSource } from "./anchor.js";

describe("findAnchorsInSource", () => {
  it("finds an anchor in a line comment with its line number", () => {
    const src = ["const x = 1;", "// @adc el_login_submit", "login();"].join("\n");
    expect(findAnchorsInSource(src)).toEqual([{ elementId: "el_login_submit", line: 2 }]);
  });

  it("is comment-syntax-agnostic (#, /* */, <!-- -->)", () => {
    const src = [
      "# @adc el_python",
      "/* @adc el_block */",
      "<!-- @adc el_html -->",
    ].join("\n");
    expect(findAnchorsInSource(src).map((a) => a.elementId)).toEqual([
      "el_python",
      "el_block",
      "el_html",
    ]);
  });

  it("does not mistake an email or longer token for an anchor", () => {
    const src = "contact user@adc.io and see foo@adcbar";
    expect(findAnchorsInSource(src)).toEqual([]);
  });

  it("requires whitespace between @adc and the id", () => {
    expect(findAnchorsInSource("// @adcel_login")).toEqual([]);
  });

  it("captures multiple anchors and attaches the file when given", () => {
    const src = "// @adc el_a\n// @adc el_b";
    expect(findAnchorsInSource(src, "routes.ts")).toEqual([
      { elementId: "el_a", line: 1, file: "routes.ts" },
      { elementId: "el_b", line: 2, file: "routes.ts" },
    ]);
  });
});
