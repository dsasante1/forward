import { describe, it, expect } from "vitest";
import {
  DesignElement,
  DatabaseTree,
  InfraNode,
  InfraEdge,
  InfraFlow,
  Task,
  Checkpoint,
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
    expect(el.rotation).toBe(0);
  });

  it("keeps a non-zero rotation when supplied", () => {
    const el = DesignElement.parse({
      id: "el_btn_rot",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      rotation: 45,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.rotation).toBe(45);
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

  it("accepts an ellipse shape", () => {
    const el = DesignElement.parse({
      id: "el_avatar",
      type: "ellipse",
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.type).toBe("ellipse");
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

describe("Infrastructure flows", () => {
  it("parses a flow and applies step defaults", () => {
    const flow = InfraFlow.parse({
      id: "flow_signup",
      name: "User signup",
      steps: [
        { from: "infra_web", to: "infra_api", label: "POST /auth/register" },
        {
          from: "infra_api",
          to: "infra_redis",
          label: "store verification token",
          kind: "async",
          endpointId: "el_register_form",
        },
      ],
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(flow.description).toBe("");
    // First step defaults kind to "sync"; nothing supplied for endpointId.
    expect(flow.steps[0]?.kind).toBe("sync");
    expect(flow.steps[0]?.endpointId).toBeUndefined();
    expect(flow.steps[1]?.kind).toBe("async");
    expect(flow.steps[1]?.endpointId).toBe("el_register_form");
  });

  it("defaults to an empty step list", () => {
    const flow = InfraFlow.parse({
      id: "flow_empty",
      name: "Draft",
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(flow.steps).toEqual([]);
  });

  it("rejects an unknown step kind", () => {
    expect(() =>
      InfraFlow.parse({
        id: "flow_bad",
        name: "Bad",
        steps: [{ from: "a", to: "b", kind: "telepathy" }],
        updatedAt: "2026-05-28T11:45:00Z",
      }),
    ).toThrow();
  });

  it("accepts a tree carrying infra flows", () => {
    const tree = DatabaseTree.parse({
      infra_flows: {
        project_xyz: {
          flow_signup: {
            id: "flow_signup",
            name: "User signup",
            steps: [{ from: "infra_web", to: "infra_api", label: "register" }],
            updatedAt: "2026-05-28T11:45:00Z",
          },
        },
      },
    });
    expect(tree.infra_flows.project_xyz?.flow_signup?.name).toBe("User signup");
    expect(tree.infra_flows.project_xyz?.flow_signup?.steps[0]?.to).toBe(
      "infra_api",
    );
  });
});

describe("Task layer", () => {
  it("parses a minimal task and applies defaults", () => {
    const task = Task.parse({
      id: "task_1",
      title: "Implement POST /auth/verify",
      createdAt: "2026-06-19T09:00:00Z",
      updatedAt: "2026-06-19T09:00:00Z",
    });
    expect(task.description).toBe("");
    expect(task.status).toBe("todo");
    expect(task.type).toBe("task");
    expect(task.priority).toBe("medium");
    expect(task.labels).toEqual([]);
    expect(task.assignees).toEqual([]);
    expect(task.activity).toEqual([]);
    expect(task.reporter).toBeUndefined();
    expect(task.elementId).toBeUndefined();
    expect(task.flowId).toBeUndefined();
    expect(task.endpointId).toBeUndefined();
  });

  it("keeps optional cross-layer links when supplied", () => {
    const task = Task.parse({
      id: "task_2",
      title: "Wire signup flow",
      status: "in_progress",
      assignees: ["uid_abc"],
      elementId: "el_register_form",
      flowId: "flow_signup",
      endpointId: "el_register_form",
      createdAt: "2026-06-19T09:00:00Z",
      updatedAt: "2026-06-19T10:00:00Z",
    });
    expect(task.status).toBe("in_progress");
    expect(task.elementId).toBe("el_register_form");
    expect(task.flowId).toBe("flow_signup");
    expect(task.endpointId).toBe("el_register_form");
  });

  it("rejects an unknown status", () => {
    expect(() =>
      Task.parse({
        id: "task_bad",
        title: "Bad",
        status: "procrastinating",
        createdAt: "2026-06-19T09:00:00Z",
        updatedAt: "2026-06-19T09:00:00Z",
      }),
    ).toThrow();
  });

  it("requires a non-empty title", () => {
    expect(() =>
      Task.parse({
        id: "task_notitle",
        title: "",
        createdAt: "2026-06-19T09:00:00Z",
        updatedAt: "2026-06-19T09:00:00Z",
      }),
    ).toThrow();
  });

  it("accepts a tree carrying tasks", () => {
    const tree = DatabaseTree.parse({
      tasks: {
        project_xyz: {
          task_1: {
            id: "task_1",
            title: "Implement POST /auth/verify",
            elementId: "el_register_form",
            createdAt: "2026-06-19T09:00:00Z",
            updatedAt: "2026-06-19T09:00:00Z",
          },
        },
      },
    });
    expect(tree.tasks.project_xyz?.task_1?.title).toBe(
      "Implement POST /auth/verify",
    );
    expect(tree.tasks.project_xyz?.task_1?.status).toBe("todo");
  });
});

describe("Checkpoint layer", () => {
  it("parses a checkpoint and applies snapshot/field defaults", () => {
    const cp = Checkpoint.parse({
      id: "c1",
      title: "Checkout v1 layout",
      snapshot: {},
      createdAt: "2026-06-22T10:00:00.000Z",
    });
    expect(cp.description).toBe("");
    expect(cp.tag).toBe("checkpoint");
    expect(cp.changes).toEqual([]);
    expect(cp.snapshot.elements).toEqual([]);
    expect(cp.snapshot.infraNodes).toEqual([]);
  });

  it("keeps a tag, author and per-layer change counts", () => {
    const cp = Checkpoint.parse({
      id: "c2",
      title: "402 decline handling",
      tag: "milestone",
      author: "user_maya",
      changes: [
        { layer: "API", n: 2 },
        { layer: "DESIGN", n: 1 },
      ],
      snapshot: {},
      createdAt: "2026-06-22T10:00:00.000Z",
    });
    expect(cp.tag).toBe("milestone");
    expect(cp.author).toBe("user_maya");
    expect(cp.changes).toHaveLength(2);
  });

  it("requires a non-empty title and rejects an unknown tag", () => {
    const base = { id: "c", snapshot: {}, createdAt: "2026-06-22T10:00:00.000Z" };
    expect(Checkpoint.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(
      Checkpoint.safeParse({ ...base, title: "x", tag: "draft" }).success,
    ).toBe(false);
  });

  it("accepts a tree carrying checkpoints", () => {
    const tree = DatabaseTree.parse({
      checkpoints: {
        project_xyz: {
          c1: {
            id: "c1",
            title: "Initial canvas",
            snapshot: {},
            createdAt: "2026-06-22T10:00:00.000Z",
          },
        },
      },
    });
    expect(tree.checkpoints.project_xyz?.c1?.title).toBe("Initial canvas");
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
    expect(paths.infraFlows("p")).toBe("infra_flows/p");
    expect(paths.infraFlow("p", "f")).toBe("infra_flows/p/f");
    expect(paths.tasks("p")).toBe("tasks/p");
    expect(paths.task("p", "t")).toBe("tasks/p/t");
    expect(paths.checkpoints("p")).toBe("checkpoints/p");
    expect(paths.checkpoint("p", "c")).toBe("checkpoints/p/c");
  });
});
