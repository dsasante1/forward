import { describe, it, expect } from "vitest";
import {
  DesignElement,
  DatabaseTree,
  InfraNode,
  InfraEdge,
  paths,
} from "./schema.js";

describe("DesignElement contract", () => {
  it("accepts a plain shape with no API binding and applies defaults", () => {
    const el = DesignElement.parse({
      id: "el_btn_1",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.parentId).toBeNull();
    expect(el.name).toBe("");
    expect(el.apiBinding).toBeUndefined();
  });

  it("accepts an element carrying an optional apiBinding", () => {
    const el = DesignElement.parse({
      id: "el_login_card",
      type: "frame",
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      apiBinding: {
        title: "Log in",
        endpoint: "/api/v1/users/login",
        method: "POST",
      },
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.apiBinding?.title).toBe("Log in");
    expect(el.apiBinding?.method).toBe("POST");
    expect(el.apiBinding?.parameters).toEqual([]);
  });

  it("accepts a framework-agnostic binding with no HTTP fields", () => {
    const el = DesignElement.parse({
      id: "el_resolver",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      apiBinding: {
        title: "createOrder mutation",
        language: "GraphQL",
        description: "Places an order for the current cart.",
      },
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.apiBinding?.language).toBe("GraphQL");
    expect(el.apiBinding?.method).toBeUndefined();
    expect(el.apiBinding?.endpoint).toBeUndefined();
  });

  it("records hierarchy via parentId and component links", () => {
    const instance = DesignElement.parse({
      id: "el_inst_1",
      type: "instance",
      parentId: "el_frame_1",
      componentId: "el_comp_button",
      x: 5,
      y: 5,
      width: 100,
      height: 32,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(instance.parentId).toBe("el_frame_1");
    expect(instance.componentId).toBe("el_comp_button");
  });

  it("rejects an unknown element type", () => {
    expect(() =>
      DesignElement.parse({
        id: "x",
        type: "circle",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        updatedAt: "2026-05-28T11:45:00Z",
      }),
    ).toThrow();
  });
});

describe("DatabaseTree", () => {
  it("parses a project with elements + timeline", () => {
    const tree = DatabaseTree.parse({
      user_configs: {
        user_unique_id_123: {
          repositoryUrl: "https://github.com/acme/suite",
          projectName: "E-Commerce Suite",
        },
      },
      design_elements: {
        project_xyz: {
          el_login_card: {
            id: "el_login_card",
            type: "frame",
            name: "Login Card",
            x: 40,
            y: 40,
            width: 320,
            height: 200,
            apiBinding: {
              title: "Log in",
              endpoint: "/api/v1/users/login",
              method: "POST",
              description: "Body: email, password.",
            },
            updatedAt: "2026-05-28T11:45:00Z",
          },
        },
      },
      version_timeline: {
        project_xyz: {
          el_login_card: [
            {
              version: "v1.2.0",
              timestamp: 1774864000,
              author: "BackendDevGuy",
              commitHash: "ab12cd3",
              changeLog: "Strict regex on email field.",
            },
          ],
        },
      },
    });
    expect(
      tree.design_elements.project_xyz?.el_login_card?.apiBinding?.method,
    ).toBe("POST");
  });
});

describe("Infrastructure layer", () => {
  it("parses a node and applies size defaults", () => {
    const node = InfraNode.parse({
      id: "infra_pg",
      kind: "database",
      label: "PostgreSQL",
      tech: "v15",
      x: 200,
      y: 120,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(node.width).toBe(160);
    expect(node.height).toBe(72);
    expect(node.parentId).toBeNull();
    expect(node.description).toBe("");
  });

  it("rejects an unknown infra kind", () => {
    expect(() =>
      InfraNode.parse({
        id: "x",
        kind: "spaceship",
        label: "Nope",
        x: 0,
        y: 0,
        updatedAt: "2026-05-28T11:45:00Z",
      }),
    ).toThrow();
  });

  it("parses a directed edge between two nodes", () => {
    const edge = InfraEdge.parse({
      id: "edge_api_pg",
      from: "infra_api",
      to: "infra_pg",
      label: "reads/writes",
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(edge.from).toBe("infra_api");
    expect(edge.to).toBe("infra_pg");
  });

  it("accepts a tree carrying infra nodes + edges", () => {
    const tree = DatabaseTree.parse({
      infra_nodes: {
        project_xyz: {
          infra_api: {
            id: "infra_api",
            kind: "backend",
            label: "API Server",
            x: 0,
            y: 0,
            updatedAt: "2026-05-28T11:45:00Z",
          },
        },
      },
      infra_edges: {
        project_xyz: {
          edge_api_pg: {
            id: "edge_api_pg",
            from: "infra_api",
            to: "infra_pg",
            updatedAt: "2026-05-28T11:45:00Z",
          },
        },
      },
    });
    expect(tree.infra_nodes.project_xyz?.infra_api?.kind).toBe("backend");
    expect(tree.infra_edges.project_xyz?.edge_api_pg?.to).toBe("infra_pg");
  });
});

describe("paths", () => {
  it("builds RTDB paths consistently", () => {
    expect(paths.element("p", "e")).toBe("design_elements/p/e");
    expect(paths.apiBinding("p", "e")).toBe("design_elements/p/e/apiBinding");
    expect(paths.timeline("p", "e")).toBe("version_timeline/p/e");
    expect(paths.infraNodes("p")).toBe("infra_nodes/p");
    expect(paths.infraNode("p", "n")).toBe("infra_nodes/p/n");
    expect(paths.infraEdges("p")).toBe("infra_edges/p");
    expect(paths.infraEdge("p", "x")).toBe("infra_edges/p/x");
  });
});
