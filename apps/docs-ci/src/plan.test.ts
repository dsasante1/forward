import { describe, it, expect } from "vitest";
import { GridPlacer } from "./layout.js";
import { AgentInput, BindingInput, EntityInput, InfraNodeInput, McpServerInput, Plan } from "./plan.js";

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

  it("leaves omitted geometry unset so a re-run never resizes or reparents an existing box", () => {
    const inputs = [
      EntityInput.parse({ id: "ent_user", name: "User" }),
      InfraNodeInput.parse({ id: "n1", kind: "backend", label: "API" }),
      McpServerInput.parse({ id: "mcp_1", label: "forward-mcp" }),
      AgentInput.parse({ id: "ag_1", label: "Reviewer" }),
    ];
    for (const input of inputs) {
      for (const k of ["x", "y", "width", "height", "parentId"]) expect(input).not.toHaveProperty(k);
    }
    // What that protects: a box someone resized and nested keeps its geometry.
    const previous = { x: 40, y: 50, width: 333, height: 222, parentId: "frame_1" };
    expect(new GridPlacer([]).place(inputs[0]!, previous, 180, 120)).toEqual(previous);
  });

  it("rejects an unknown infra kind (still bound by the canonical schema)", () => {
    expect(() =>
      Plan.parse({ infraNodes: [{ id: "n1", kind: "not-a-kind", label: "x" }] }),
    ).toThrow();
  });
});
