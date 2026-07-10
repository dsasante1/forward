import "reflect-metadata";
import { describe, expect, it } from "vitest";
import type { DesignElement } from "forward-core";
import { ElementsService } from "./elements.service.js";

// These tests pin the concurrency fix (M-1): every read-modify-write path takes
// the element row lock (`SELECT … FOR UPDATE`) BEFORE it reads the state it is
// about to merge into. A real lost-update test needs a live Postgres (only the
// DB honours FOR UPDATE); here we verify the property the DB relies on — the
// lock is issued inside the same transaction and strictly before the read — so a
// refactor that reorders or drops it fails loudly.

interface Recorder {
  /** Ordered log of DB operations issued on the transaction client. */
  calls: string[];
  /** The tagged-template pieces captured from the FOR UPDATE lock query. */
  lock: { strings?: readonly string[]; values: unknown[] };
}

/**
 * A transaction client that records the order of operations. `existing` is the
 * stored element `requireElement`/`save` read back (null = not yet created).
 */
function makeTx(existing: DesignElement | null) {
  const rec: Recorder = { calls: [], lock: { values: [] } };
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      rec.calls.push("lock");
      rec.lock.strings = strings;
      rec.lock.values = values;
      return Promise.resolve(0);
    },
    designElement: {
      findUnique: async () => {
        rec.calls.push("findUnique");
        return existing ? { data: existing } : null;
      },
      update: async () => {
        rec.calls.push("update");
        return {};
      },
      upsert: async () => {
        rec.calls.push("upsert");
        return {};
      },
      findMany: async () => {
        rec.calls.push("findMany");
        return [];
      },
    },
    project: { update: async () => ({}) },
    versionEntry: { create: async () => ({}) },
  };
  return { tx, rec };
}

/** ElementsService wired to a recording tx; realtime/timeline are inert stubs. */
function makeService(existing: DesignElement | null) {
  const { tx, rec } = makeTx(existing);
  const prisma = {
    // Faithful to the real withUser: run fn inside a "transaction" (our tx).
    withUser: async <T>(_actor: string, fn: (t: unknown) => Promise<T>) => fn(tx),
  } as never;
  const realtime = { publish: async () => undefined } as never;
  const timeline = { record: async () => undefined } as never;
  return { svc: new ElementsService(prisma, realtime, timeline), rec };
}

const element = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: "el_1",
  type: "rectangle",
  name: "Box",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  parentId: null,
  z: 0,
  rotation: 0,
  updatedAt: "2026-07-10T00:00:00.000Z",
  ...over,
});

const PROJECT = "project_xyz";

describe("ElementsService row locking (M-1)", () => {
  it("patch locks the element row before reading the state it merges into", async () => {
    const { svc, rec } = makeService(element());
    await svc.patch(PROJECT, "el_1", { x: 5 }, "user_1");
    // The whole point: the lock is held before the read, so a second writer
    // queues on it instead of reading the same prior state and clobbering.
    expect(rec.calls.indexOf("lock")).toBeGreaterThanOrEqual(0);
    expect(rec.calls.indexOf("lock")).toBeLessThan(rec.calls.indexOf("findUnique"));
  });

  it("locks exactly the target row (projectId + id) with FOR UPDATE", async () => {
    const { svc, rec } = makeService(element());
    await svc.patch(PROJECT, "el_1", { x: 5 }, "user_1");
    expect(rec.lock.values).toEqual([PROJECT, "el_1"]);
    const sql = (rec.lock.strings ?? []).join(" ? ");
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/"DesignElement"/);
  });

  it("bind locks before reading the current binding", async () => {
    const { svc, rec } = makeService(element());
    await svc.bind(
      PROJECT,
      "el_1",
      { title: "GET /things", description: "" },
      { version: "1", changeLog: "init", action: "created" },
      "user_1",
    );
    expect(rec.calls.indexOf("lock")).toBeLessThan(rec.calls.indexOf("findUnique"));
  });

  it("unbind locks before reading the current binding", async () => {
    const { svc, rec } = makeService(
      element({ apiBinding: { title: "GET /things", description: "" } }),
    );
    await svc.unbind(PROJECT, "el_1", { version: "2", changeLog: "drop" }, "user_1");
    expect(rec.calls.indexOf("lock")).toBeLessThan(rec.calls.indexOf("findUnique"));
  });

  it("save locks before reading the prior element (to preserve its binding)", async () => {
    const { svc, rec } = makeService(element());
    await svc.save(PROJECT, element({ x: 99 }), "user_1");
    expect(rec.calls.indexOf("lock")).toBeLessThan(rec.calls.indexOf("findUnique"));
  });
});
