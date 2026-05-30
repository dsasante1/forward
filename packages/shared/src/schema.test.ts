import { describe, it, expect } from "vitest";
import { CanvasNode, DatabaseTree, paths } from "./schema.js";

describe("CanvasNode contract", () => {
  it("accepts a well-formed node and applies defaults", () => {
    const node = CanvasNode.parse({
      endpoint: "/api/v1/users/login",
      method: "POST",
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(node.parameters).toEqual([]);
    expect(node.description).toBe("");
  });

  it("rejects an unknown HTTP method", () => {
    expect(() =>
      CanvasNode.parse({
        endpoint: "/x",
        method: "FETCH",
        updatedAt: "2026-05-28T11:45:00Z",
      }),
    ).toThrow();
  });
});

describe("DatabaseTree", () => {
  it("parses the sample tree from the brief", () => {
    const tree = DatabaseTree.parse({
      user_configs: {
        user_unique_id_123: {
          repositoryUrl: "https://github.com/acme/suite",
          projectName: "E-Commerce Suite",
        },
      },
      canvas_nodes: {
        project_xyz: {
          screen_login_card_99: {
            endpoint: "/api/v1/users/login",
            method: "POST",
            description: "Authenticates user accounts.",
            requestBody: { email: "string", password: "string" },
            updatedAt: "2026-05-28T11:45:00Z",
          },
        },
      },
      version_timeline: {
        project_xyz: {
          screen_login_card_99: [
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
    expect(tree.canvas_nodes.project_xyz?.screen_login_card_99?.method).toBe(
      "POST",
    );
  });
});

describe("paths", () => {
  it("builds RTDB paths consistently", () => {
    expect(paths.node("p", "n")).toBe("canvas_nodes/p/n");
    expect(paths.timeline("p", "n")).toBe("version_timeline/p/n");
  });
});
