import { CanvasNode, VersionEntry, paths } from "@adc/shared";

/**
 * Live data source for the canvas. Two implementations:
 *  - LiveSource: subscribes to the user's Firebase RTDB.
 *  - FixtureSource: reads a static JSON tree (offline dev / demo / tests).
 *
 * Both speak the same interface so the canvas never knows which it's using.
 */
export interface NodeSnapshot {
  nodeId: string;
  node: CanvasNode;
  timeline: VersionEntry[];
}

export interface CanvasSource {
  /** Subscribe to all nodes in the project; callback fires on every change. */
  subscribe(onChange: (nodes: NodeSnapshot[]) => void): () => void;
}

/** Offline source backed by a static tree — see public/fixture.json. */
export class FixtureSource implements CanvasSource {
  constructor(
    private readonly projectId: string,
    private readonly fixtureUrl = "/fixture.json",
  ) {}

  subscribe(onChange: (nodes: NodeSnapshot[]) => void): () => void {
    void fetch(this.fixtureUrl)
      .then((r) => r.json())
      .then((tree) => onChange(this.flatten(tree)));
    return () => {};
  }

  private flatten(tree: any): NodeSnapshot[] {
    const nodes = tree.canvas_nodes?.[this.projectId] ?? {};
    const timelines = tree.version_timeline?.[this.projectId] ?? {};
    return Object.entries(nodes).map(([nodeId, raw]) => ({
      nodeId,
      node: CanvasNode.parse(raw),
      timeline: (timelines[nodeId] ?? []).map((v: unknown) =>
        VersionEntry.parse(v),
      ),
    }));
  }
}

/**
 * Live RTDB source. Lazy-imports the firebase SDK so the fixture path has zero
 * SDK cost. `config` is the user's own runtime config (BYOD).
 */
export class LiveSource implements CanvasSource {
  constructor(
    private readonly config: Record<string, string>,
    private readonly projectId: string,
  ) {}

  subscribe(onChange: (nodes: NodeSnapshot[]) => void): () => void {
    let unsub = () => {};
    void (async () => {
      const { initializeApp } = await import("firebase/app");
      const { getDatabase, ref, onValue } = await import("firebase/database");
      const app = initializeApp(this.config);
      const db = getDatabase(app);

      const nodesRef = ref(db, paths.projectNodes(this.projectId));
      unsub = onValue(nodesRef, async (snap) => {
        const nodes = snap.val() ?? {};
        const result: NodeSnapshot[] = [];
        for (const [nodeId, raw] of Object.entries(nodes)) {
          const tlSnap = await new Promise<any>((res) =>
            onValue(
              ref(db, paths.timeline(this.projectId, nodeId)),
              (s) => res(s.val()),
              { onlyOnce: true },
            ),
          );
          result.push({
            nodeId,
            node: CanvasNode.parse(raw),
            timeline: (tlSnap ?? []).map((v: unknown) => VersionEntry.parse(v)),
          });
        }
        onChange(result);
      });
    })();
    return () => unsub();
  }
}
