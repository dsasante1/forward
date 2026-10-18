import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { findAnchorsInSource, resolveAnchors, scanPath } from "./anchor.js";
import type { AnchorElement } from "./anchor.js";

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

  it("captures an optional quoted label after the id", () => {
    const src = '// @adc el_login_submit "Login submit button"';
    expect(findAnchorsInSource(src)).toEqual([
      { elementId: "el_login_submit", line: 1, label: "Login submit button" },
    ]);
  });

  it("ignores the trailing comment close of a block/HTML comment in the label", () => {
    const src = [
      '/* @adc el_block "Block label" */',
      '<!-- @adc el_html "HTML label" -->',
    ].join("\n");
    expect(findAnchorsInSource(src)).toEqual([
      { elementId: "el_block", line: 1, label: "Block label" },
      { elementId: "el_html", line: 2, label: "HTML label" },
    ]);
  });

  it("omits the label when it is empty or absent", () => {
    const src = ['// @adc el_a ""', "// @adc el_b"].join("\n");
    expect(findAnchorsInSource(src)).toEqual([
      { elementId: "el_a", line: 1 },
      { elementId: "el_b", line: 2 },
    ]);
  });
});

describe("resolveAnchors", () => {
  const byId = new Map<string, AnchorElement>([
    ["el_login", { name: "Login button", type: "component", documented: true }],
  ]);

  it("flags labelDrifted when the label no longer matches the element name", () => {
    const anchors = findAnchorsInSource('// @adc el_login "Sign in button"');
    expect(resolveAnchors(anchors, byId, true)).toEqual([
      {
        elementId: "el_login",
        line: 1,
        label: "Sign in button",
        exists: true,
        name: "Login button",
        type: "component",
        documented: true,
        labelDrifted: true,
        currentName: "Login button",
      },
    ]);
  });

  it("does not flag drift when the label still matches the current name", () => {
    const anchors = findAnchorsInSource('// @adc el_login "Login button"');
    const [resolved] = resolveAnchors(anchors, byId, true);
    expect(resolved).not.toHaveProperty("labelDrifted");
    expect(resolved).toMatchObject({ exists: true, name: "Login button" });
  });

  it("does not flag drift for a bare anchor with no label", () => {
    const anchors = findAnchorsInSource("// @adc el_login");
    const [resolved] = resolveAnchors(anchors, byId, true);
    expect(resolved).not.toHaveProperty("labelDrifted");
  });

  it("reports a missing element as exists:false without drift", () => {
    const anchors = findAnchorsInSource('// @adc el_ghost "Anything"');
    expect(resolveAnchors(anchors, byId, true)).toEqual([
      { elementId: "el_ghost", line: 1, label: "Anything", exists: false },
    ]);
  });

  it("reports exists:null and skips drift when the canvas is unvalidated", () => {
    const anchors = findAnchorsInSource('// @adc el_login "Sign in button"');
    const [resolved] = resolveAnchors(anchors, byId, false);
    expect(resolved).not.toHaveProperty("labelDrifted");
    expect(resolved).toMatchObject({ exists: null });
  });
});

describe("scanPath", () => {
  it("scans files in any language, including extensionless ones, and skips binaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adc-scan-"));
    try {
      await writeFile(join(dir, "index.html"), '<!-- @adc el_html "Hero" -->\n<div></div>');
      await writeFile(join(dir, "handler.lua"), "-- @adc el_lua\nreturn {}");
      await writeFile(join(dir, "Dockerfile"), "# @adc el_docker\nFROM node:22");
      await writeFile(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x40, ...Buffer.from("@adc el_bin")]));
      await mkdir(join(dir, "node_modules"));
      await writeFile(join(dir, "node_modules", "dep.js"), "// @adc el_vendored");
      await mkdir(join(dir, ".forward"));
      await writeFile(join(dir, ".forward", "el.json"), '{"description":"// @adc el_quoted"}');

      const ids = (await scanPath(dir)).map((a) => a.elementId).sort();
      expect(ids).toEqual(["el_docker", "el_html", "el_lua"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
