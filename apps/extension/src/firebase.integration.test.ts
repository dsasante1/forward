import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - .mjs sibling workspace, no types; it's a test double.
import { startMockRtdb } from "../../mock-rtdb/server.mjs";
import { paths } from "schema-nexus-core";
import {
  bindApiToElement,
  fetchTimelinesConditional,
  listElements,
  type FirebaseConfig,
} from "./firebase.js";

/**
 * Integration test: exercise the extension's real REST writers/readers against
 * the in-process mock RTDB. Asserts on the bytes actually stored, so it would
 * catch a path, method or payload-shape regression that a mocked `fetch` can't.
 */
describe("extension firebase REST integration", () => {
  let mock: Awaited<ReturnType<typeof startMockRtdb>>;
  let cfg: FirebaseConfig;
  const PROJECT = "proj_test";
  const ELEMENT = "el_login_submit";

  beforeAll(async () => {
    mock = await startMockRtdb({ port: 0 });
  });
  afterAll(async () => {
    await mock.close();
  });

  beforeEach(async () => {
    // Reset the DB and seed one element with NO binding (as a designer would).
    await fetch(`${mock.url}/.json`, { method: "PUT", body: "{}" });
    cfg = { databaseUrl: mock.url, projectId: PROJECT };
    await fetch(`${mock.url}/${paths.element(PROJECT, ELEMENT)}.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: ELEMENT,
        type: "rectangle",
        name: "Submit Button",
        x: 10,
        y: 20,
        width: 100,
        height: 40,
        parentId: null,
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    });
  });

  it("listElements returns seeded elements (id, name, type)", async () => {
    const els = await listElements(cfg);
    expect(els).toEqual([
      { id: ELEMENT, name: "Submit Button", type: "rectangle" },
    ]);
  });

  it("listElements returns [] when the project is empty", async () => {
    const els = await listElements({ ...cfg, projectId: "nonexistent" });
    expect(els).toEqual([]);
  });

  it("bindApiToElement writes the binding under the element (geometry intact)", async () => {
    await bindApiToElement(
      cfg,
      ELEMENT,
      { title: "Log in", endpoint: "/api/v1/users/login", method: "POST", description: "", parameters: [] },
      { version: "v1.0.0", author: "tester", changeLog: "first bind" },
    );

    const stored = mock.db.design_elements[PROJECT][ELEMENT];
    // Binding landed in the right sub-path…
    expect(stored.apiBinding).toMatchObject({
      title: "Log in",
      endpoint: "/api/v1/users/login",
      method: "POST",
    });
    // …without clobbering the designer's geometry/name.
    expect(stored.width).toBe(100);
    expect(stored.name).toBe("Submit Button");
    // …and updatedAt was bumped off the seed value.
    expect(stored.updatedAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("bindApiToElement appends a version entry with a server timestamp", async () => {
    const before = Date.now();
    await bindApiToElement(
      cfg,
      ELEMENT,
      { title: "Probe", endpoint: "/x", method: "GET", description: "", parameters: [] },
      { version: "v2.0.0", author: "tester", changeLog: "second bind" },
    );

    // POST yields a push-keyed object, mirroring real Firebase.
    const timeline = mock.db.version_timeline[PROJECT][ELEMENT];
    const entries = Object.values(timeline) as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      version: "v2.0.0",
      author: "tester",
      changeLog: "second bind",
    });
    expect(entry?.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("appends (not overwrites) on repeated binds to the same element", async () => {
    const bind = (v: string) =>
      bindApiToElement(
        cfg,
        ELEMENT,
        { title: "Probe", endpoint: "/x", method: "GET", description: "", parameters: [] },
        { version: v, author: "tester", changeLog: v },
      );
    await bind("v1");
    await bind("v2");

    const timeline = mock.db.version_timeline[PROJECT][ELEMENT];
    expect(Object.values(timeline)).toHaveLength(2);
  });

  it("fetchTimelinesConditional reads whole-project histories with ETag reuse", async () => {
    await bindApiToElement(
      cfg,
      ELEMENT,
      { title: "Log in", endpoint: "/api/v1/users/login", method: "POST", description: "", parameters: [] },
      { version: "v1.0.0", author: "tester", action: "created", changeLog: "first bind" },
    );

    const first = await fetchTimelinesConditional(cfg, undefined);
    expect(first).not.toBeNull();
    expect(first?.timelines[ELEMENT]).toHaveLength(1);
    expect(first?.timelines[ELEMENT]?.[0]).toMatchObject({
      version: "v1.0.0",
      action: "created",
      // bindApiToElement snapshots the endpoint so deletions stay labelled.
      endpoint: { title: "Log in", method: "POST", path: "/api/v1/users/login" },
    });

    // An unchanged subtree comes back as a bodyless 304 -> null.
    expect(await fetchTimelinesConditional(cfg, first?.etag)).toBeNull();
  });

  it("propagates an error when the database is unreachable", async () => {
    const bad: FirebaseConfig = {
      databaseUrl: "http://127.0.0.1:1", // nothing listening
      projectId: PROJECT,
    };
    await expect(
      bindApiToElement(
        bad,
        ELEMENT,
        { title: "Probe", endpoint: "/x", method: "GET", description: "", parameters: [] },
        { version: "v", author: "t", changeLog: "c" },
      ),
    ).rejects.toThrow();
  });
});
