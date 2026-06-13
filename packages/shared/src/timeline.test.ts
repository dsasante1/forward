import { describe, it, expect } from "vitest";
import type { VersionEntry } from "./schema.js";
import {
  actionOf,
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
