import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the Marketplace README", () => {
  it("links outside the extension with absolute URLs", () => {
    // vsce drops `repository.directory`, so `../mcp/README.md` packages as a
    // 404 on the published page.
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme.match(/\]\(\.\.?\/[^)]*\)/g) ?? []).toEqual([]);
  });
});
