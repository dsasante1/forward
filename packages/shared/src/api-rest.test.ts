import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindApiToElement,
  deleteElement,
  fetchElements,
  fetchInfra,
  saveInfraNode,
  unbindApiFromElement,
  type ApiConfig,
} from "./api-rest.js";
import type { DesignElement } from "./schema.js";

const cfg: ApiConfig = {
  baseUrl: "http://127.0.0.1:4747",
  projectId: "proj",
  token: "session_token",
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Records every fetch; answers GETs from `routes`, OKs everything else. */
function mockFetch(routes: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const path = url.replace("http://127.0.0.1:4747", "");
    const payload = routes[path] ?? null;
    return {
      ok: true,
      status: 200,
      text: async () => (payload === null ? "" : JSON.stringify(payload)),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function el(id: string): DesignElement {
  return {
    id,
    type: "rectangle",
    name: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parentId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("api-rest client", () => {
  it("sends the token as a Bearer header and never in the query string", async () => {
    const calls = mockFetch();
    await saveInfraNode(cfg, {
      id: "n1",
      kind: "database",
      label: "Postgres",
      description: "",
      x: 0,
      y: 0,
      width: 160,
      height: 72,
      parentId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const [call] = calls;
    expect(call?.headers["authorization"]).toBe("Bearer session_token");
    expect(call?.url).not.toContain("auth=");
    expect(call?.url).toBe(
      "http://127.0.0.1:4747/projects/proj/infra/nodes/n1",
    );
    expect(call?.method).toBe("PUT");
  });

  it("fetchElements GETs the project elements and parses them", async () => {
    mockFetch({ "/projects/proj/elements": [el("a"), el("b")] });
    const els = await fetchElements(cfg);
    expect(els.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("bindApiToElement PUTs to the binding sub-route with server-owned identity dropped", async () => {
    const calls = mockFetch();
    await bindApiToElement(
      cfg,
      "el1",
      {
        title: "Log in",
        description: "",
      },
      { version: "v1.0.0", author: "ignored-by-server", changeLog: "first" },
    );
    const [call] = calls;
    expect(call?.method).toBe("PUT");
    expect(call?.url).toBe(
      "http://127.0.0.1:4747/projects/proj/elements/el1/binding",
    );
    expect(call?.body).toMatchObject({
      version: "v1.0.0",
      changeLog: "first",
      action: "modified",
      binding: { title: "Log in" },
    });
    // The client does NOT send author/timestamp — the server stamps identity.
    expect(call?.body).not.toHaveProperty("author");
  });

  it("unbindApiFromElement DELETEs the binding with the endpoint title", async () => {
    const calls = mockFetch();
    await unbindApiFromElement(cfg, "el1", {
      version: "v2",
      author: "x",
      changeLog: "remove",
      endpoint: { title: "Log in" },
    });
    const [call] = calls;
    expect(call?.method).toBe("DELETE");
    expect(call?.url).toContain("/elements/el1/binding");
    expect(call?.body).toMatchObject({ title: "Log in", version: "v2" });
  });

  it("deleteElement passes the cascade flag and returns the deleted ids", async () => {
    const calls = mockFetch({
      "/projects/proj/elements/frame1?cascade=true": { deleted: ["frame1", "c1"] },
    });
    const deleted = await deleteElement(cfg, "frame1");
    expect(deleted).toEqual(["frame1", "c1"]);
    expect(calls[0]?.url).toContain("cascade=true");
  });

  it("fetchInfra splits nodes and edges from the combined response", async () => {
    mockFetch({
      "/projects/proj/infra": {
        nodes: [
          {
            id: "n1",
            kind: "backend",
            label: "API",
            description: "",
            x: 0,
            y: 0,
            width: 160,
            height: 72,
            parentId: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        edges: [],
        flows: [],
      },
    });
    const { nodes, edges } = await fetchInfra(cfg);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response),
    );
    await expect(fetchElements(cfg)).rejects.toThrow(/403/);
  });
});
