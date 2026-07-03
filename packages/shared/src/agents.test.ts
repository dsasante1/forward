import { describe, it, expect } from "vitest";
import { agentsToComponentMermaid } from "./agents.js";
import { AgentNode, McpServerNode } from "./schema.js";

function agent(
  id: string,
  label: string,
  extra: Partial<AgentNode> = {},
): AgentNode {
  return AgentNode.parse({
    id,
    label,
    x: 0,
    y: 0,
    updatedAt: "2026-05-28T11:45:00Z",
    ...extra,
  });
}

function server(
  id: string,
  label: string,
  extra: Partial<McpServerNode> = {},
): McpServerNode {
  return McpServerNode.parse({
    id,
    label,
    x: 0,
    y: 0,
    updatedAt: "2026-05-28T11:45:00Z",
    ...extra,
  });
}

describe("AgentNode / McpServerNode contract", () => {
  it("applies defaults for an agent", () => {
    const a = agent("a1", "Digest agent");
    expect(a.systemPrompt).toBe("");
    expect(a.mcpServerIds).toEqual([]);
    expect(a.parentId).toBeNull();
    expect(a.width).toBe(200);
    expect(a.model).toBeUndefined();
  });

  it("applies defaults for an MCP server", () => {
    const s = server("s1", "forward-mcp");
    expect(s.transport).toBe("stdio");
    expect(s.origin).toBe("consumed");
    expect(s.tools).toEqual([]);
  });

  it("keeps a tool's optional endpoint link", () => {
    const s = server("s1", "forward-mcp", {
      tools: [{ name: "documentEndpoint", endpointId: "el_login" }],
    });
    expect(s.tools[0]?.description).toBe("");
    expect(s.tools[0]?.endpointId).toBe("el_login");
  });
});

describe("agentsToComponentMermaid (UML wiring diagram)", () => {
  it("renders agents and servers as stereotyped components and wires them", () => {
    const agents = [
      agent("a1", "Digest agent", {
        model: "claude-opus-4-8",
        mcpServerIds: ["s1"],
      }),
    ];
    const servers = [
      server("s1", "forward-mcp", {
        transport: "http",
        tools: [{ name: "listEndpoints", description: "" }],
      }),
    ];
    const out = agentsToComponentMermaid(agents, servers);
    expect(out).toContain("flowchart LR");
    expect(out).toContain("«agent»");
    expect(out).toContain("[claude-opus-4-8]");
    expect(out).toContain("«mcp»");
    expect(out).toContain("[http]");
    expect(out).toContain("listEndpoints");
    expect(out).toMatch(/A0 -->\|"uses"\| S0/);
  });

  it("labels a tool arrow with the endpoint it wraps", () => {
    const servers = [
      server("s1", "forward-mcp", {
        tools: [{ name: "documentEndpoint", endpointId: "el_login" }],
      }),
    ];
    const out = agentsToComponentMermaid([], servers);
    expect(out).toContain('S0 -->|"el_login"| S0T0');
  });

  it("skips wiring to a server id that does not resolve", () => {
    const agents = [agent("a1", "Orphan", { mcpServerIds: ["ghost"] })];
    const out = agentsToComponentMermaid(agents, []);
    expect(out).not.toContain("uses");
  });

  it("escapes HTML-significant characters in labels", () => {
    const agents = [agent("a1", "<script>alert(1)</script>")];
    const out = agentsToComponentMermaid(agents, []);
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });
});
