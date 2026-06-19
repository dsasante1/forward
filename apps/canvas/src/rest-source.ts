import {
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraNode,
  VersionEntry,
  normalizeList,
  paths,
} from "forward-core";
import type {
  CanvasSource,
  ElementSnapshot,
  InfraSnapshot,
} from "./firebase.js";

/**
 * A CanvasSource that talks to the Firebase RTDB *REST* API directly, polling
 * for changes. Used against the local `mock-rtdb` server for end-to-end testing
 * without the Firebase SDK or a cloud project — the extension writes over the
 * same REST API, so this closes the loop.
 *
 * The real RTDB pushes changes over a socket; the mock doesn't, so we poll. The
 * editor's data flow is the same either way, which is the point of testing here.
 */
export class RestSource implements CanvasSource {
  private timer: ReturnType<typeof setInterval> | undefined;
  private infraTimer: ReturnType<typeof setInterval> | undefined;
  private lastJson = "";
  private lastInfraJson = "";

  constructor(
    private readonly databaseUrl: string,
    private readonly projectId: string,
    private readonly pollMs = 1000,
  ) {}

  private url(path: string): string {
    return `${this.databaseUrl.replace(/\/$/, "")}/${path}.json`;
  }

  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void {
    const tick = async () => {
      try {
        const snapshots = await this.fetchAll();
        // Only emit when something actually changed, to avoid clobbering an
        // in-progress edit on every poll.
        const json = JSON.stringify(snapshots);
        if (json !== this.lastJson) {
          this.lastJson = json;
          onChange(snapshots);
        }
      } catch (err) {
        console.warn("[rest-source] poll failed:", err);
      }
    };
    void tick();
    this.timer = setInterval(tick, this.pollMs);
    return () => {
      if (this.timer) clearInterval(this.timer);
    };
  }

  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void {
    const tick = async () => {
      try {
        const infra = await this.fetchInfra();
        const json = JSON.stringify(infra);
        if (json !== this.lastInfraJson) {
          this.lastInfraJson = json;
          onChange(infra);
        }
      } catch (err) {
        console.warn("[rest-source] infra poll failed:", err);
      }
    };
    void tick();
    this.infraTimer = setInterval(tick, this.pollMs);
    return () => {
      if (this.infraTimer) clearInterval(this.infraTimer);
    };
  }

  private async fetchInfra(): Promise<InfraSnapshot> {
    const [nodesRes, edgesRes, flowsRes] = await Promise.all([
      fetch(this.url(paths.infraNodes(this.projectId))),
      fetch(this.url(paths.infraEdges(this.projectId))),
      fetch(this.url(paths.infraFlows(this.projectId))),
    ]);
    const nodes = normalizeList(await nodesRes.json()).flatMap((v) => {
      const p = InfraNode.safeParse(v);
      return p.success ? [p.data] : [];
    });
    const edges = normalizeList(await edgesRes.json()).flatMap((v) => {
      const p = InfraEdge.safeParse(v);
      return p.success ? [p.data] : [];
    });
    const flows = normalizeList(await flowsRes.json()).flatMap((v) => {
      const p = InfraFlow.safeParse(v);
      return p.success ? [p.data] : [];
    });
    return { nodes, edges, flows };
  }

  private async fetchAll(): Promise<ElementSnapshot[]> {
    const [elsRes, tlRes] = await Promise.all([
      fetch(this.url(paths.projectElements(this.projectId))),
      fetch(this.url(`version_timeline/${this.projectId}`)),
    ]);
    const elsRaw = ((await elsRes.json()) ?? {}) as Record<string, unknown>;
    const tlRaw = ((await tlRes.json()) ?? {}) as Record<string, unknown>;

    const result: ElementSnapshot[] = [];
    for (const value of Object.values(elsRaw)) {
      const element = DesignElement.parse(value);
      // Timeline may arrive as an array or a push-keyed object — normalize.
      const list = normalizeList(tlRaw[element.id]);
      result.push({
        element,
        timeline: list.map((v) => VersionEntry.parse(v)),
      });
    }
    return result;
  }

  async saveElement(element: DesignElement): Promise<void> {
    const body = DesignElement.parse(element);
    const res = await fetch(this.url(paths.element(this.projectId, element.id)), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
  }

  async deleteElement(elementId: string): Promise<void> {
    const res = await fetch(
      this.url(paths.element(this.projectId, elementId)),
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
  }

  async saveInfraNode(node: InfraNode): Promise<void> {
    const body = InfraNode.parse(node);
    const res = await fetch(
      this.url(paths.infraNode(this.projectId, body.id)),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`save node failed: ${res.status}`);
  }

  async deleteInfraNode(nodeId: string): Promise<void> {
    // Remove the node, then any edges that referenced it, so none dangle.
    const { edges } = await this.fetchInfra();
    const res = await fetch(
      this.url(paths.infraNode(this.projectId, nodeId)),
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`delete node failed: ${res.status}`);
    await Promise.all(
      edges
        .filter((e) => e.from === nodeId || e.to === nodeId)
        .map((e) =>
          fetch(this.url(paths.infraEdge(this.projectId, e.id)), {
            method: "DELETE",
          }),
        ),
    );
  }

  async saveInfraEdge(edge: InfraEdge): Promise<void> {
    const body = InfraEdge.parse(edge);
    const res = await fetch(
      this.url(paths.infraEdge(this.projectId, body.id)),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`save edge failed: ${res.status}`);
  }

  async saveInfraFlow(flow: InfraFlow): Promise<void> {
    const body = InfraFlow.parse(flow);
    const res = await fetch(
      this.url(paths.infraFlow(this.projectId, body.id)),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`save flow failed: ${res.status}`);
  }

  async deleteInfraFlow(flowId: string): Promise<void> {
    const res = await fetch(
      this.url(paths.infraFlow(this.projectId, flowId)),
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`delete flow failed: ${res.status}`);
  }
}
