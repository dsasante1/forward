import { describe, expect, it } from "vitest";
import { diffBindings } from "./api-diff.js";
import type { ApiBinding } from "./schema.js";

const b = (title: string, description = ""): ApiBinding => ({ title, description });

describe("diffBindings", () => {
  it("treats a create (no previous) as all-added", () => {
    const d = diffBindings(undefined, b("Login", "Line A\nLine B"));
    expect(d.removed).toBe(0);
    expect(d.added).toBe(3); // title + 2 description lines
    const desc = d.sections.find((s) => s.label === "Description");
    expect(desc?.rows.every((r) => r.op === "added")).toBe(true);
  });

  it("treats a delete (no next) as all-removed", () => {
    const d = diffBindings(b("Login", "Line A"), undefined);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(2);
  });

  it("renders an unchanged title as context, not a change", () => {
    const d = diffBindings(b("Login", "old"), b("Login", "new"));
    const title = d.sections.find((s) => s.label === "Title");
    expect(title?.rows).toEqual([{ op: "unchanged", cols: ["Login"] }]);
  });

  it("pairs a changed title as removed → added", () => {
    const d = diffBindings(b("Login", "x"), b("Sign in", "x"));
    const title = d.sections.find((s) => s.label === "Title");
    expect(title?.rows).toEqual([
      { op: "removed", cols: ["Login"] },
      { op: "added", cols: ["Sign in"] },
    ]);
  });

  it("keeps shared lines as context and only marks the real edit", () => {
    const prev = b("E", "intro\nkeep\nold tail");
    const next = b("E", "intro\nkeep\nnew tail");
    const d = diffBindings(prev, next);
    const rows = d.sections.find((s) => s.label === "Description")?.rows ?? [];
    expect(rows).toEqual([
      { op: "unchanged", cols: ["intro"] },
      { op: "unchanged", cols: ["keep"] },
      { op: "removed", cols: ["old tail"] },
      { op: "added", cols: ["new tail"] },
    ]);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it("emits no sections when nothing changed", () => {
    const d = diffBindings(b("Same", "body"), b("Same", "body"));
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    // Title + Description both all-context, so they still appear as context only.
    expect(d.sections.flatMap((s) => s.rows).every((r) => r.op === "unchanged")).toBe(
      true,
    );
  });

  it("never sets breaking (caller owns that flag)", () => {
    const d = diffBindings(b("A"), b("B"));
    expect(d.breaking).toBeUndefined();
  });
});
