import { describe, it, expect } from "vitest";
import type {
  Checkpoint,
  ProjectTimelineEvent,
  VersionEntry,
} from "./schema.js";
import {
  actionOf,
  buildHistoryTimeline,
  computeLanes,
  digest,
  flattenTimelines,
  laneCount,
  type TimelineEvent,
} from "./timeline.js";

function entry(part: Partial<VersionEntry> & { timestamp: number }): VersionEntry {
  return {
    version: "v",
    author: "dev",
    action: "modified",
    changeLog: "",
    ...part,
  } as VersionEntry;
}

function ev(part: Partial<TimelineEvent> & { elementId: string; timestamp: number; action: TimelineEvent["action"] }): TimelineEvent {
  return { version: "v", author: "dev", changeLog: "", title: part.elementId, ...part };
}

describe("actionOf", () => {
  it("uses the explicit action when present", () => {
    expect(actionOf(entry({ timestamp: 1, action: "deleted" }))).toBe("deleted");
  });
  it("falls back to the change-log wording for old entries", () => {
    const old = (changeLog: string) =>
      actionOf({ version: "v", timestamp: 1, author: "d", changeLog } as VersionEntry);
    expect(old("Add API documentation")).toBe("created");
    expect(old("Removed API documentation")).toBe("deleted");
    expect(old("Tweaked the regex")).toBe("modified");
  });
});

describe("flattenTimelines", () => {
  it("merges per-element histories into one stream sorted by time", () => {
    const events = flattenTimelines({
      a: [entry({ timestamp: 30, action: "created" }), entry({ timestamp: 50, action: "modified" })],
      b: [entry({ timestamp: 40, action: "created" })],
    });
    expect(events.map((e) => [e.elementId, e.timestamp])).toEqual([
      ["a", 30],
      ["b", 40],
      ["a", 50],
    ]);
  });

  it("labels from the entry snapshot, then the current binding, then the id", () => {
    const events = flattenTimelines(
      {
        a: [entry({ timestamp: 1, action: "deleted", endpoint: { title: "Login", method: "POST", path: "/login" } })],
        b: [entry({ timestamp: 2, action: "modified" })],
        c: [entry({ timestamp: 3, action: "modified" })],
      },
      { b: { title: "Profile", path: "/me" } },
    );
    const byId = Object.fromEntries(events.map((e) => [e.elementId, e]));
    expect(byId.a).toMatchObject({ title: "Login", method: "POST", path: "/login" });
    expect(byId.b).toMatchObject({ title: "Profile", path: "/me" });
    expect(byId.c?.title).toBe("c"); // no snapshot, no current label -> id
  });

  it("derives previousVersion from the prior entry, even when given out of order", () => {
    const events = flattenTimelines({
      a: [
        entry({ timestamp: 50, version: "v1.2.0", action: "modified" }),
        entry({ timestamp: 10, version: "v1.0.0", action: "created" }), // earlier, listed later
        entry({ timestamp: 30, version: "v1.1.0", action: "modified" }),
      ],
    });
    const byTs = Object.fromEntries(events.map((e) => [e.timestamp, e.previousVersion]));
    expect(byTs[10]).toBeUndefined(); // first entry has no predecessor
    expect(byTs[30]).toBe("v1.0.0");
    expect(byTs[50]).toBe("v1.1.0");
  });

  it("keeps an explicit previousVersion over the derived one", () => {
    const [event] = flattenTimelines({
      a: [
        entry({ timestamp: 10, version: "v1.0.0", action: "created" }),
        entry({ timestamp: 20, version: "v2.0.0", previousVersion: "v1.9.9", action: "modified" }),
      ],
    }).filter((e) => e.timestamp === 20);
    expect(event?.previousVersion).toBe("v1.9.9");
  });

  it("passes a structured diff through, and omits it when absent", () => {
    const diff = {
      added: 2,
      removed: 1,
      breaking: "now 422",
      sections: [{ label: "responses", rows: [{ op: "added" as const, cols: ["422"] }] }],
    };
    const events = flattenTimelines({
      a: [entry({ timestamp: 1, action: "modified", diff })],
      b: [entry({ timestamp: 2, action: "modified" })],
    });
    const byId = Object.fromEntries(events.map((e) => [e.elementId, e]));
    expect(byId.a?.diff).toEqual(diff);
    expect(byId.b).not.toHaveProperty("diff");
  });
});

describe("computeLanes", () => {
  it("opens a lane on create and frees it on delete for reuse", () => {
    const rows = computeLanes([
      ev({ elementId: "a", timestamp: 1, action: "created" }),
      ev({ elementId: "b", timestamp: 2, action: "created" }),
      ev({ elementId: "a", timestamp: 3, action: "deleted" }), // frees lane 0
      ev({ elementId: "c", timestamp: 4, action: "created" }), // reuses lane 0
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
    // While b is open, a's and c's rows show b's lane passing through.
    expect(rows[2]?.through).toEqual([1]);
    expect(rows[3]?.through).toEqual([1]);
    expect(laneCount(rows)).toBe(2);
  });
});

describe("digest", () => {
  const stream: TimelineEvent[] = [
    ev({ elementId: "old", timestamp: 10, action: "created", title: "Old" }),
    ev({ elementId: "gone", timestamp: 20, action: "created", title: "Gone" }),
    // baseline = 25
    ev({ elementId: "new", timestamp: 30, action: "created", title: "New" }),
    ev({ elementId: "old", timestamp: 40, action: "modified", title: "Old" }),
    ev({ elementId: "gone", timestamp: 50, action: "deleted", title: "Gone" }),
  ];

  it("buckets endpoints by their net change since the baseline", () => {
    const d = digest(stream, 25);
    expect(d.toIntegrate.map((i) => i.elementId)).toEqual(["new"]);
    expect(d.toModify.map((i) => i.elementId)).toEqual(["old"]);
    expect(d.toRemove.map((i) => i.elementId)).toEqual(["gone"]);
  });

  it("treats create+delete within the window as a no-op", () => {
    const d = digest(
      [
        ev({ elementId: "x", timestamp: 30, action: "created", title: "X" }),
        ev({ elementId: "x", timestamp: 40, action: "deleted", title: "X" }),
      ],
      25,
    );
    expect(d.toIntegrate).toHaveLength(0);
    expect(d.toRemove).toHaveLength(0);
    expect(d.toModify).toHaveLength(0);
  });

  it("ignores endpoints with no events after the baseline", () => {
    const d = digest([ev({ elementId: "old", timestamp: 10, action: "created" })], 25);
    expect(d.toIntegrate.concat(d.toModify, d.toRemove)).toHaveLength(0);
  });
});

describe("buildHistoryTimeline", () => {
  function pe(part: Partial<ProjectTimelineEvent> & { seq: number }): ProjectTimelineEvent {
    return {
      domain: "design",
      action: "modified",
      targetId: "el-1",
      title: "t",
      detail: "",
      author: "maya",
      timestamp: part.seq * 1000,
      ...part,
    };
  }
  function cp(part: Partial<Checkpoint> & { id: string }): Checkpoint {
    return {
      title: "Checkpoint",
      description: "",
      tag: "checkpoint",
      changes: [],
      snapshot: { elements: [], infraNodes: [], infraEdges: [], infraFlows: [] },
      createdAt: new Date(5000).toISOString(),
      ...part,
    };
  }

  const events: ProjectTimelineEvent[] = [
    pe({ seq: 1, domain: "design" }),
    pe({ seq: 2, domain: "api" }),
    pe({ seq: 3, domain: "infra" }),
    pe({ seq: 4, domain: "uml" }),
    pe({ seq: 5, domain: "design" }),
  ];

  it("counts per domain with unified as the grand total", () => {
    const tl = buildHistoryTimeline(events, [], { view: "unified", sort: "new" });
    expect(tl.counts).toMatchObject({ unified: 5, design: 2, api: 1, infra: 1, uml: 1 });
    expect(tl.rows).toHaveLength(5);
  });

  it("filters to a single domain but keeps counts global", () => {
    const tl = buildHistoryTimeline(events, [], { view: "design", sort: "new" });
    expect(tl.rows.every((r) => r.domain === "design")).toBe(true);
    expect(tl.rows).toHaveLength(2);
    expect(tl.counts.unified).toBe(5); // counts ignore the active filter
  });

  it("sorts newest-first or oldest-first", () => {
    const newest = buildHistoryTimeline(events, [], { view: "unified", sort: "new" });
    expect(newest.rows[0]?.timestamp).toBeGreaterThan(newest.rows.at(-1)!.timestamp);
    const oldest = buildHistoryTimeline(events, [], { view: "unified", sort: "old" });
    expect(oldest.rows[0]?.timestamp).toBeLessThan(oldest.rows.at(-1)!.timestamp);
  });

  it("folds checkpoints in (tagged by dominant layer) with a restore handle", () => {
    const tl = buildHistoryTimeline([], [cp({ id: "c1", changes: [{ layer: "INFRA", n: 3 }] })], {
      view: "unified",
      sort: "new",
    });
    expect(tl.rows).toHaveLength(1);
    expect(tl.rows[0]).toMatchObject({ kind: "checkpoint", domain: "infra", checkpointId: "c1" });
    // and it surfaces under the infra view, not design
    const infra = buildHistoryTimeline([], [cp({ id: "c1", changes: [{ layer: "INFRA", n: 3 }] })], {
      view: "infra",
      sort: "new",
    });
    expect(infra.rows).toHaveLength(1);
  });
});
