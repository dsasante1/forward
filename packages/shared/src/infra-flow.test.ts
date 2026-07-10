import { describe, it, expect } from "vitest";
import {
  flowToMermaid,
  infraToComponentMermaid,
  filterInfraGraph,
  infraViewToMermaid,
} from "./infra-flow.js";
import { InfraEdge, InfraFlow, InfraNode } from "./schema.js";

function node(
  id: string,
  label: string,
  kind: InfraNode["kind"] = "backend",
  extra: Partial<InfraNode> = {},
): InfraNode {
  return InfraNode.parse({
    id,
    kind,
    label,
    x: 0,
    y: 0,
    updatedAt: "2026-05-28T11:45:00Z",
    ...extra,
  });
}

function edge(id: string, from: string, to: string, label?: string): InfraEdge {
  return InfraEdge.parse({
    id,
    from,
    to,
    ...(label ? { label } : {}),
    updatedAt: "2026-05-28T11:45:00Z",
  });
}

describe("flowToMermaid (sequence diagram)", () => {
  const nodes = new Map([
    ["web", node("web", "Web App", "frontend")],
    ["api", node("api", "API Server", "backend")],
    ["redis", node("redis", "Redis", "cache")],
  ]);

  it("serialises steps to a numbered sequenceDiagram with per-kind arrows", () => {
    const flow = InfraFlow.parse({
      id: "f1",
      name: "Signup",
      steps: [
        { from: "web", to: "api", label: "POST /auth/register" },
        { from: "api", to: "redis", label: "store token", kind: "async" },
        { from: "api", to: "web", label: "201 Created", kind: "reply" },
      ],
      updatedAt: "2026-05-28T11:45:00Z",
    });
    const out = flowToMermaid(flow, nodes);
    expect(out).toContain("sequenceDiagram");
    // A frontend node is an actor; internal nodes are participants.
    expect(out).toContain("actor N0 as Web App");
    expect(out).toContain("participant N1 as API Server");
    expect(out).toContain("participant N2 as Redis");
    expect(out).toContain("N0->>N1: 1. POST /auth/register");
    expect(out).toContain("N1-)N2: 2. store token");
    expect(out).toContain("N1-->>N0: 3. 201 Created");
  });

  it("renders an actor (human) node as a sequence-diagram actor, not a participant", () => {
    const journeyNodes = new Map([
      ["user", node("user", "User", "actor")],
      ["api", node("api", "API Server", "backend")],
    ]);
    const flow = InfraFlow.parse({
      id: "f3",
      name: "User sign up",
      steps: [{ from: "user", to: "api", label: "submits form" }],
      updatedAt: "2026-05-28T11:45:00Z",
    });
    const out = flowToMermaid(flow, journeyNodes);
    expect(out).toContain("actor N0 as User");
    expect(out).not.toContain("participant N0 as User");
    expect(out).toContain("participant N1 as API Server");
  });

  it("appends the endpointId when a step carries one", () => {
    const flow = InfraFlow.parse({
      id: "f2",
      name: "Login",
      steps: [
        {
          from: "web",
          to: "api",
          label: "authenticate",
          endpointId: "el_login",
        },
      ],
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(flowToMermaid(flow, nodes)).toContain(
      "N0->>N1: 1. authenticate (el_login)",
    );
  });

  it("entity-escapes HTML-significant characters in labels (XSS-safe)", () => {
    const evil = new Map([
      ["web", node("web", '<img src=x onerror="alert(1)">', "frontend")],
      ["api", node("api", "API", "backend")],
    ]);
    const flow = InfraFlow.parse({
      id: "f4",
      name: "Evil",
      steps: [{ from: "web", to: "api", label: "<script>alert(1)</script>" }],
      updatedAt: "2026-05-28T11:45:00Z",
    });
    const out = flowToMermaid(flow, evil);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;img");
    expect(out).toContain("&lt;script&gt;");
  });

  it("skips steps that reference a node missing from the map", () => {
    const flow = InfraFlow.parse({
      id: "f3",
      name: "Dangling",
      steps: [
        { from: "web", to: "ghost", label: "nowhere" },
        { from: "web", to: "api", label: "real" },
      ],
      updatedAt: "2026-05-28T11:45:00Z",
    });
    const out = flowToMermaid(flow, nodes);
    expect(out).not.toContain("nowhere");
    // Numbering follows the original step index so the overlay and the diagram
    // agree on step numbers even when a dangling hop is skipped (hence "2.").
    expect(out).toContain("N0->>N1: 2. real");
  });
});

describe("infraToComponentMermaid (component diagram)", () => {
  it("renders nodes as «component» boxes and edges as dependencies", () => {
    const nodes = [
      node("web", "Web App", "frontend"),
      node("api", "API Server", "backend"),
      node("pg", "PostgreSQL", "database"),
    ];
    const edges = [
      edge("e1", "web", "api", "HTTP"),
      edge("e2", "api", "pg", "reads/writes"),
    ];
    const out = infraToComponentMermaid(nodes, edges);
    expect(out).toContain("flowchart LR");
    expect(out).toContain('C0["«component»<br/>Web App<br/>[frontend]"]');
    expect(out).toContain('C2["«component»<br/>PostgreSQL<br/>[database]"]');
    expect(out).toContain('C0 -->|"HTTP"| C1');
    expect(out).toContain('C1 -->|"reads/writes"| C2');
  });

  it("wraps a group's children in a «subsystem» subgraph", () => {
    const nodes = [
      node("ci", "CI/CD", "group"),
      node("gha", "GitHub Actions", "devops", { parentId: "ci" }),
      node("api", "API Server", "backend"),
    ];
    const out = infraToComponentMermaid(nodes, []);
    expect(out).toContain('subgraph C0["«subsystem»<br/>CI/CD"]');
    expect(out).toContain('C1["«component»<br/>GitHub Actions<br/>[devops]"]');
    expect(out).toContain("end");
    // The ungrouped node still appears at the top level.
    expect(out).toContain('C2["«component»<br/>API Server<br/>[backend]"]');
  });

  it("entity-escapes node and edge labels (XSS-safe), keeping the stereotype <br/>", () => {
    const out = infraToComponentMermaid(
      [node("api", '<b onmouseover="x">API</b>', "backend")],
      [edge("e1", "api", "api", "<i>calls</i>")],
    );
    expect(out).not.toContain("<b ");
    expect(out).not.toContain("<i>");
    expect(out).toContain("&lt;b");
    expect(out).toContain("&lt;i&gt;calls");
    // The intentional «component» line break is still a real <br/>.
    expect(out).toContain("«component»<br/>");
  });

  it("skips dependencies touching a missing node", () => {
    const out = infraToComponentMermaid(
      [node("api", "API Server", "backend")],
      [edge("e1", "api", "ghost", "calls")],
    );
    expect(out).not.toContain("calls");
  });
});

describe("filterInfraGraph (kind-based views of one graph)", () => {
  // One shared graph; each view is a different lens over it.
  const nodes = [
    node("web", "Web App", "frontend"),
    node("api", "API Server", "backend"),
    node("svc", "Auth Service", "service"),
    node("pg", "PostgreSQL", "database"),
    node("redis", "Redis", "cache"),
    node("gha", "GitHub Actions", "devops"),
    node("sg", "SendGrid", "external"),
  ];
  const edges = [
    edge("e1", "web", "api", "HTTP"),
    edge("e2", "api", "svc", "calls"),
    edge("e3", "api", "pg", "reads/writes"),
    edge("e4", "api", "redis", "caches"),
    edge("e5", "gha", "api", "deploys"),
    edge("e6", "api", "sg", "sends"),
  ];

  it("architecture keeps every node", () => {
    const out = filterInfraGraph(nodes, edges, "architecture");
    expect(out.nodes).toHaveLength(7);
    expect(out.edges).toHaveLength(6);
  });

  it("infrastructure drops frontend + service, keeping the runtime substrate", () => {
    const out = filterInfraGraph(nodes, edges, "infrastructure");
    const ids = out.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["api", "gha", "pg", "redis", "sg"]);
    // The web->api and api->svc edges drop with their endpoints; gha->api stays.
    expect(out.edges.map((e) => e.id).sort()).toEqual(["e3", "e4", "e5", "e6"]);
  });

  it("modules keeps only the internal code units", () => {
    const out = filterInfraGraph(nodes, edges, "modules");
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["api", "svc"]);
    expect(out.edges.map((e) => e.id)).toEqual(["e2"]);
  });

  it("drops a group container left empty by the filter", () => {
    const grouped = [
      node("ci", "CI/CD", "group"),
      node("gha", "GitHub Actions", "devops", { parentId: "ci" }),
      node("api", "API Server", "backend"),
    ];
    // `modules` keeps `group` and `backend` but not `devops`, so the CI group is
    // left childless and must be dropped (not rendered as an empty subsystem).
    const out = filterInfraGraph(grouped, [], "modules");
    expect(out.nodes.map((n) => n.id)).toEqual(["api"]);
  });

  it("keeps a group whose child survives the filter", () => {
    const grouped = [
      node("data", "Data", "group"),
      node("pg", "PostgreSQL", "database", { parentId: "data" }),
    ];
    const out = filterInfraGraph(grouped, [], "infrastructure");
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["data", "pg"]);
  });

  it("infraViewToMermaid filters then serialises to a component diagram", () => {
    const out = infraViewToMermaid(nodes, edges, "modules");
    expect(out).toContain("flowchart LR");
    expect(out).toContain("API Server");
    expect(out).toContain("Auth Service");
    expect(out).not.toContain("PostgreSQL");
  });
});
