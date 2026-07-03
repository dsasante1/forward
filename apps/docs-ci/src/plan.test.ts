import { describe, it, expect } from "vitest";
import { BindingInput, EntityInput, McpServerInput, Plan } from "./plan.js";

describe("forward-docs plan contract", () => {
  it("defaults every layer to empty and the version to 1", () => {
    expect(Plan.parse({})).toMatchObject({
      version: 1,
      bindings: [],
      entities: [],
      entityRelations: [],
      infraNodes: [],
      infraEdges: [],
      infraFlows: [],
      mcpServers: [],
      agents: [],
    });
  });

  it("requires a binding's elementId and title, and defaults its description", () => {
    expect(() => BindingInput.parse({ title: "POST /x" })).toThrow(); // no elementId
    expect(() => BindingInput.parse({ elementId: "el_1" })).toThrow(); // no title
    expect(BindingInput.parse({ elementId: "el_1", title: "POST /x" }).description).toBe("");
  });

  it("strips the machine-owned updatedAt so a full canonical object re-applies cleanly", () => {
    // This is what makes forward-docs.rollback.json (full Entity objects with
    // updatedAt) valid input to `apply` again.
    const parsed = EntityInput.parse({
      id: "ent_user",
      name: "User",
      updatedAt: "2026-01-01T00:00:00.000Z",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      parentId: null,
      fields: [],
      description: "",
    });
    expect("updatedAt" in parsed).toBe(false);
    expect(parsed).toMatchObject({ id: "ent_user", name: "User" });
  });

  it("keeps geometry optional (the AI supplies content, apply supplies layout)", () => {
    expect(() => EntityInput.parse({ id: "ent_user", name: "User" })).not.toThrow();
    expect(() =>
      McpServerInput.parse({ id: "mcp_1", label: "forward-mcp" }),
    ).not.toThrow();
  });

  it("rejects an unknown infra kind (still bound by the canonical schema)", () => {
    expect(() =>
      Plan.parse({ infraNodes: [{ id: "n1", kind: "not-a-kind", label: "x" }] }),
    ).toThrow();
  });
});
