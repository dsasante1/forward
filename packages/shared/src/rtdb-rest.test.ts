import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMember,
  deleteElement,
  descendantIds,
  listMembers,
  patchElement,
  removeMember,
  saveElement,
  type FirebaseConfig,
} from "./rtdb-rest.js";
import type { DesignElement } from "./schema.js";

const cfg: FirebaseConfig = {
  databaseUrl: "https://test-db.firebaseio.com",
  projectId: "proj",
};

/** A minimal valid design element. */
function el(id: string, parentId: string | null = null): DesignElement {
  return {
    id,
    type: "rectangle",
    name: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parentId,
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

/** Records every fetch and answers GETs from `elements`, OKs everything else. */
function mockFetch(elements: DesignElement[] = []) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const body =
      method === "GET"
        ? Object.fromEntries(elements.map((e) => [e.id, e]))
        : null;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("descendantIds", () => {
  it("walks the whole parentId subtree, excluding the root", () => {
    const tree = [
      el("frame"),
      el("a", "frame"),
      el("b", "frame"),
      el("a1", "a"),
      el("orphan"),
    ];
    expect(descendantIds("frame", tree).sort()).toEqual(["a", "a1", "b"]);
  });

  it("returns [] for a leaf", () => {
    expect(descendantIds("x", [el("x"), el("y")])).toEqual([]);
  });
});

describe("deleteElement", () => {
  it("cascades to descendants by default", async () => {
    const calls = mockFetch([el("frame"), el("child", "frame"), el("other")]);
    const removed = await deleteElement(cfg, "frame");
    expect(removed.sort()).toEqual(["child", "frame"]);
    const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(deletes).toHaveLength(2);
    expect(deletes.some((u) => u.includes("/frame.json"))).toBe(true);
    expect(deletes.some((u) => u.includes("/child.json"))).toBe(true);
  });

  it("removes only the one element when cascade is false", async () => {
    const calls = mockFetch([el("frame"), el("child", "frame")]);
    const removed = await deleteElement(cfg, "frame", { cascade: false });
    expect(removed).toEqual(["frame"]);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });
});

describe("patchElement", () => {
  it("merges the patch over the current element and stamps updatedAt", async () => {
    const calls = mockFetch([el("x")]);
    const next = await patchElement(cfg, "x", { x: 42, name: "renamed" });
    expect(next.x).toBe(42);
    expect(next.name).toBe("renamed");
    expect(next.width).toBe(10); // untouched field preserved
    expect(next.updatedAt).not.toBe("2024-01-01T00:00:00.000Z");
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/x.json");
  });

  it("throws when the element does not exist", async () => {
    mockFetch([el("x")]);
    await expect(patchElement(cfg, "ghost", { x: 1 })).rejects.toThrow(/ghost/);
  });
});

describe("saveElement", () => {
  it("PUTs the parsed element and re-stamps updatedAt", async () => {
    const calls = mockFetch();
    await saveElement(cfg, el("new"));
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/design_elements/proj/new.json");
    expect((put?.body as DesignElement).id).toBe("new");
  });
});

describe("membership", () => {
  it("addMember PUTs a roster entry with role + addedAt", async () => {
    const calls = mockFetch();
    await addMember(cfg, "uid123", "owner");
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/project_members/proj/uid123.json");
    expect(put?.body).toMatchObject({ role: "owner" });
    expect((put?.body as { addedAt: string }).addedAt).toBeTruthy();
  });

  it("addMember defaults the role to member", async () => {
    const calls = mockFetch();
    await addMember(cfg, "uid123");
    expect((calls[0].body as { role: string }).role).toBe("member");
  });

  it("removeMember DELETEs the roster entry", async () => {
    const calls = mockFetch();
    await removeMember(cfg, "uid123");
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    expect(calls[0].url).toContain("/project_members/proj/uid123.json");
  });

  it("listMembers parses the roster into uid + role rows", async () => {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        owner1: { role: "owner", addedAt: "2024-01-01T00:00:00.000Z" },
        m2: { role: "member", addedAt: "2024-02-01T00:00:00.000Z" },
      }),
    }));
    vi.stubGlobal("fetch", fn);
    const members = await listMembers(cfg);
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.uid === "owner1")?.role).toBe("owner");
  });
});
