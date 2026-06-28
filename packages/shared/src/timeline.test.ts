import { describe, it, expect } from "vitest";
import type {
  Checkpoint,
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraNode,
  ProjectTimelineEvent,
  VersionEntry,
} from "./schema.js";
import {
  actionOf,
  buildHistoryDetail,
  buildHistoryTimeline,
  computeLanes,
  digest,
  flattenTimelines,
  type HistoryRow,
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

  it("drops auto-logged design events; the design layer is shown via checkpoints", () => {
    // The two `design` events are filtered out — design history is the checkpoints.
    const tl = buildHistoryTimeline(events, [], { view: "unified", sort: "new" });
    expect(tl.counts).toMatchObject({ unified: 3, design: 0, api: 1, infra: 1, uml: 1 });
    expect(tl.rows).toHaveLength(3);
    expect(tl.rows.some((r) => r.domain === "design")).toBe(false);
  });

  it("the design view shows checkpoints, not the per-edit design events", () => {
    const tl = buildHistoryTimeline(events, [cp({ id: "c1" })], {
      view: "design",
      sort: "new",
    });
    // a default checkpoint (no changes) is dominant-design, so it lands here…
    expect(tl.rows).toEqual([expect.objectContaining({ kind: "checkpoint", domain: "design" })]);
    // …and none of the filtered-out design events leak in.
    expect(tl.rows.every((r) => r.kind === "checkpoint")).toBe(true);
    expect(tl.counts.design).toBe(1); // the checkpoint, not the 2 design events
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

describe("buildHistoryDetail", () => {
  function row(part: Partial<HistoryRow> & { domain: HistoryRow["domain"] }): HistoryRow {
    return {
      id: "e1",
      kind: "event",
      action: "modified",
      title: "t",
      detail: "",
      author: "maya",
      timestamp: 1000,
      ...part,
    };
  }
  function el(part: Partial<DesignElement> & { id: string }): DesignElement {
    return {
      type: "rectangle",
      name: "",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      parentId: null,
      rotation: 0,
      updatedAt: new Date(0).toISOString(),
      ...part,
    };
  }
  function checkpoint(part: Partial<Checkpoint> & { id: string }): Checkpoint {
    return {
      title: "Checkpoint",
      description: "",
      tag: "checkpoint",
      changes: [],
      snapshot: { elements: [], infraNodes: [], infraEdges: [], infraFlows: [] },
      createdAt: new Date(0).toISOString(),
      ...part,
    };
  }

  it("a checkpoint row with no source checkpoints has an empty checkpoint detail", () => {
    const d = buildHistoryDetail(row({ domain: "design", kind: "checkpoint" }), {});
    expect(d).toMatchObject({ kind: "checkpoint", changes: [] });
    if (d.kind !== "checkpoint") throw new Error("expected checkpoint");
    expect(d.preview).toBeUndefined();
  });

  it("a checkpoint row previews its own frozen snapshot + change chips", () => {
    const cp = checkpoint({
      id: "cp1",
      title: "v1 launch",
      changes: [{ layer: "DESIGN", n: 8 }],
      snapshot: {
        elements: [el({ id: "a" }), el({ id: "b" })],
        infraNodes: [],
        infraEdges: [],
        infraFlows: [],
      },
      createdAt: new Date(5000).toISOString(),
    });
    const d = buildHistoryDetail(row({ domain: "design", kind: "checkpoint", checkpointId: "cp1" }), {
      checkpoints: [cp],
    });
    expect(d).toMatchObject({ kind: "checkpoint", changes: [{ layer: "DESIGN", n: 8 }] });
    if (d.kind !== "checkpoint") throw new Error("expected checkpoint");
    expect(d.preview?.elements).toHaveLength(2);
    expect(d.preview?.rootId).toBeUndefined(); // whole-project view
    expect(d.preview?.basis).toMatchObject({ kind: "checkpoint", label: "v1 launch", at: 5000 });
  });

  it("design: previews the nearest checkpoint at-or-before the event (as-of, not live)", () => {
    // Live shows the rectangle at x=200; a checkpoint before the event froze x=50.
    const elements = new Map<string, DesignElement>([["rect-1", el({ id: "rect-1", x: 200 })]]);
    const cp = checkpoint({
      id: "cp1",
      title: "before",
      snapshot: {
        elements: [el({ id: "rect-1", x: 50, width: 120, height: 48 })],
        infraNodes: [],
        infraEdges: [],
        infraFlows: [],
      },
      createdAt: new Date(500).toISOString(),
    });
    const d = buildHistoryDetail(row({ domain: "design", targetId: "rect-1", timestamp: 1000 }), {
      elements,
      checkpoints: [cp],
    });
    if (d.kind !== "design") throw new Error("expected design");
    expect(d.preview?.basis).toMatchObject({ kind: "checkpoint", label: "before" });
    expect(d.preview?.elements[0]?.x).toBe(50); // the as-of geometry, not the live 200
    expect(d.props).toContainEqual({ label: "Position", value: "50, 0" });
  });

  it("design: falls back to the live element when no earlier checkpoint exists", () => {
    const elements = new Map<string, DesignElement>([["rect-1", el({ id: "rect-1", x: 200 })]]);
    // The only checkpoint is AFTER the event, so it can't describe the as-of state.
    const cp = checkpoint({
      id: "cp1",
      snapshot: { elements: [el({ id: "rect-1", x: 50 })], infraNodes: [], infraEdges: [], infraFlows: [] },
      createdAt: new Date(5000).toISOString(),
    });
    const d = buildHistoryDetail(row({ domain: "design", targetId: "rect-1", timestamp: 1000 }), {
      elements,
      checkpoints: [cp],
    });
    if (d.kind !== "design") throw new Error("expected design");
    expect(d.preview?.basis).toMatchObject({ kind: "live" });
    expect(d.preview?.elements[0]?.x).toBe(200);
  });

  it("design: a preview composition includes descendants in paint order", () => {
    const elements = new Map<string, DesignElement>([
      ["frame-1", el({ id: "frame-1", type: "frame", name: "Signup" })],
      ["rect-1", el({ id: "rect-1", parentId: "frame-1" })],
      ["text-1", el({ id: "text-1", type: "text", parentId: "rect-1" })],
      ["other", el({ id: "other" })], // unrelated, must NOT appear
    ]);
    const d = buildHistoryDetail(row({ domain: "design", targetId: "frame-1" }), { elements });
    if (d.kind !== "design") throw new Error("expected design");
    const ids = d.preview?.elements.map((e) => e.id);
    expect(ids?.[0]).toBe("frame-1"); // root first
    expect(ids).toEqual(expect.arrayContaining(["frame-1", "rect-1", "text-1"]));
    expect(ids).not.toContain("other");
  });

  it("design: resolves geometry, parent name and fill", () => {
    const elements = new Map<string, DesignElement>([
      ["frame-1", el({ id: "frame-1", type: "frame", name: "Signup" })],
      [
        "rect-1",
        el({ id: "rect-1", x: 10.4, y: 20.6, width: 120, height: 48, parentId: "frame-1", style: { fill: "#abc" } }),
      ],
    ]);
    const d = buildHistoryDetail(row({ domain: "design", targetId: "rect-1" }), { elements });
    expect(d).toMatchObject({ kind: "design", found: true, elementType: "rectangle", fill: "#abc" });
    if (d.kind !== "design") throw new Error("expected design");
    expect(d.props).toEqual(
      expect.arrayContaining([
        { label: "Position", value: "10, 21" },
        { label: "Size", value: "120 × 48" },
        { label: "Parent", value: "Signup" },
      ]),
    );
  });

  it("design: marks a vanished element (deletion) as not found", () => {
    const d = buildHistoryDetail(row({ domain: "design", targetId: "gone" }), { elements: new Map() });
    expect(d).toMatchObject({ kind: "design", found: false });
  });

  it("api: surfaces the time-matched entry's endpoint, version and diff", () => {
    const entries: VersionEntry[] = [
      entry({ timestamp: 100, version: "v1", endpoint: { title: "Checkout", method: "POST", path: "/checkout" } }),
      entry({
        timestamp: 1000,
        version: "v2",
        previousVersion: "v1",
        endpoint: { title: "Checkout", method: "POST", path: "/checkout" },
        diff: { added: 2, removed: 1, breaking: "drops `token`", sections: [{ label: "request", rows: [] }] },
      }),
    ];
    const d = buildHistoryDetail(row({ domain: "api", targetId: "rect-1", timestamp: 1000 }), {
      timelines: new Map([["rect-1", entries]]),
    });
    expect(d).toMatchObject({
      kind: "api",
      method: "POST",
      path: "/checkout",
      version: "v2",
      previousVersion: "v1",
      added: 2,
      removed: 1,
      breaking: "drops `token`",
    });
    if (d.kind !== "api") throw new Error("expected api");
    expect(d.sections).toHaveLength(1);
  });

  it("api: empty when the element has no history", () => {
    const d = buildHistoryDetail(row({ domain: "api", targetId: "rect-1" }), {});
    expect(d).toMatchObject({ kind: "api", added: 0, removed: 0 });
    if (d.kind !== "api") throw new Error("expected api");
    expect(d.sections).toHaveLength(0);
  });

  it("infra: a node resolves kind/label plus a neighbourhood diagram", () => {
    const infraNodes = new Map<string, InfraNode>([
      ["svc", { id: "svc", kind: "backend", label: "checkout-svc", description: "", x: 0, y: 0, width: 160, height: 72, parentId: null, updatedAt: new Date(0).toISOString() }],
      ["db", { id: "db", kind: "database", label: "payments-db", description: "", x: 0, y: 0, width: 160, height: 72, parentId: null, updatedAt: new Date(0).toISOString() }],
    ]);
    const infraEdges: InfraEdge[] = [{ id: "e1", from: "svc", to: "db", label: "writes", updatedAt: new Date(0).toISOString() }];
    const d = buildHistoryDetail(row({ domain: "infra", targetId: "svc" }), { infraNodes, infraEdges });
    expect(d).toMatchObject({ kind: "infra", subject: "node", nodeKind: "backend", label: "checkout-svc" });
    if (d.kind !== "infra") throw new Error("expected infra");
    expect(d.mermaid).toContain("flowchart");
    expect(d.mermaid).toContain("payments-db"); // the one-hop neighbour is pulled in
  });

  it("infra: an edge resolves endpoint labels", () => {
    const infraNodes = new Map<string, InfraNode>([
      ["svc", { id: "svc", kind: "backend", label: "checkout-svc", description: "", x: 0, y: 0, width: 160, height: 72, parentId: null, updatedAt: new Date(0).toISOString() }],
      ["db", { id: "db", kind: "database", label: "payments-db", description: "", x: 0, y: 0, width: 160, height: 72, parentId: null, updatedAt: new Date(0).toISOString() }],
    ]);
    const infraEdges: InfraEdge[] = [{ id: "e1", from: "svc", to: "db", label: "writes", updatedAt: new Date(0).toISOString() }];
    const d = buildHistoryDetail(row({ domain: "infra", targetId: "e1" }), { infraNodes, infraEdges });
    expect(d).toMatchObject({ kind: "infra", subject: "edge", fromLabel: "checkout-svc", toLabel: "payments-db", edgeLabel: "writes" });
  });

  it("uml: a flow resolves numbered steps and a sequence diagram", () => {
    const infraNodes = new Map<string, InfraNode>([
      ["svc", { id: "svc", kind: "backend", label: "checkout-svc", description: "", x: 0, y: 0, width: 160, height: 72, parentId: null, updatedAt: new Date(0).toISOString() }],
      ["db", { id: "db", kind: "database", label: "payments-db", description: "", x: 0, y: 0, width: 160, height: 72, parentId: null, updatedAt: new Date(0).toISOString() }],
    ]);
    const flow: InfraFlow = {
      id: "flow-1",
      name: "payment",
      description: "",
      steps: [{ from: "svc", to: "db", label: "charge card", kind: "sync" }],
      updatedAt: new Date(0).toISOString(),
    };
    const d = buildHistoryDetail(row({ domain: "uml", targetId: "flow-1" }), {
      infraNodes,
      infraFlows: new Map([["flow-1", flow]]),
    });
    expect(d).toMatchObject({ kind: "uml", found: true, flowName: "payment" });
    if (d.kind !== "uml") throw new Error("expected uml");
    expect(d.steps).toEqual([{ n: 1, fromLabel: "checkout-svc", toLabel: "payments-db", label: "charge card", kind: "sync" }]);
    expect(d.mermaid).toContain("sequenceDiagram");
  });

  it("uml: an empty flow has no diagram", () => {
    const flow: InfraFlow = { id: "flow-1", name: "payment", description: "", steps: [], updatedAt: new Date(0).toISOString() };
    const d = buildHistoryDetail(row({ domain: "uml", targetId: "flow-1" }), { infraFlows: new Map([["flow-1", flow]]) });
    expect(d).toMatchObject({ kind: "uml", found: true });
    if (d.kind !== "uml") throw new Error("expected uml");
    expect(d.mermaid).toBeUndefined();
    expect(d.steps).toHaveLength(0);
  });
});
