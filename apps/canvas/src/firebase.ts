import {
  DesignElement,
  InfraEdge,
  InfraNode,
  VersionEntry,
  normalizeList,
  paths,
} from "@adc/shared";

/**
 * Data source for the canvas editor. Implementations:
 *  - FixtureSource: reads/writes a static JSON tree in memory (offline dev/demo).
 *  - LiveSource:    subscribes to / writes the user's Firebase RTDB (BYOD).
 *  - RestSource:    polls the RTDB REST API — used against the local mock-rtdb
 *                   server for end-to-end testing without a cloud project.
 *                   (see ./rest-source.ts)
 *
 * All speak the same interface so the editor never knows which it's using.
 */
export interface ElementSnapshot {
  element: DesignElement;
  timeline: VersionEntry[];
}

/** The project's infrastructure graph (pillar 3) — standalone nodes + edges. */
export interface InfraSnapshot {
  nodes: InfraNode[];
  edges: InfraEdge[];
}

export interface CanvasSource {
  /** Subscribe to all elements in the project; fires on every change. */
  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void;
  /** Subscribe to the infrastructure graph; fires on every change. */
  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void;
  /** Create or update an element (the editor persists geometry/style here). */
  saveElement(element: DesignElement): Promise<void>;
  /** Remove an element. */
  deleteElement(elementId: string): Promise<void>;
}

/**
 * Offline source backed by a static tree (public/fixture.json), held in memory.
 * Edits mutate the in-memory copy and re-emit, so the editor is fully usable
 * with zero Firebase setup — handy for dev, demos and tests.
 */
export class FixtureSource implements CanvasSource {
  private elements = new Map<string, DesignElement>();
  private timelines = new Map<string, VersionEntry[]>();
  private infra: InfraSnapshot = { nodes: [], edges: [] };
  private listeners = new Set<(els: ElementSnapshot[]) => void>();
  private infraListeners = new Set<(infra: InfraSnapshot) => void>();
  private loaded = false;

  constructor(
    private readonly projectId: string,
    private readonly fixtureUrl = "/fixture.json",
  ) {}

  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void {
    this.listeners.add(onChange);
    if (!this.loaded) {
      this.loaded = true;
      void this.load().then(() => this.emit());
    } else {
      onChange(this.snapshot());
    }
    return () => this.listeners.delete(onChange);
  }

  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void {
    this.infraListeners.add(onChange);
    if (this.loaded) onChange(this.infra);
    // If not yet loaded, load()'s emit() will fan out to infra listeners too.
    return () => this.infraListeners.delete(onChange);
  }

  async saveElement(element: DesignElement): Promise<void> {
    this.elements.set(element.id, DesignElement.parse(element));
    this.emit();
  }

  async deleteElement(elementId: string): Promise<void> {
    this.elements.delete(elementId);
    this.timelines.delete(elementId);
    this.emit();
  }

  private async load(): Promise<void> {
    const res = await fetch(this.fixtureUrl);
    const tree = (await res.json()) as Record<string, unknown>;
    const els =
      (tree.design_elements as Record<string, Record<string, unknown>>)?.[
        this.projectId
      ] ?? {};
    const tls =
      (tree.version_timeline as Record<string, Record<string, unknown[]>>)?.[
        this.projectId
      ] ?? {};
    for (const raw of Object.values(els)) {
      const el = DesignElement.parse(raw);
      this.elements.set(el.id, el);
    }
    for (const [id, list] of Object.entries(tls)) {
      this.timelines.set(id, list.map((v) => VersionEntry.parse(v)));
    }

    const infraNodes =
      (tree.infra_nodes as Record<string, Record<string, unknown>>)?.[
        this.projectId
      ] ?? {};
    const infraEdges =
      (tree.infra_edges as Record<string, Record<string, unknown>>)?.[
        this.projectId
      ] ?? {};
    this.infra = {
      nodes: Object.values(infraNodes).map((n) => InfraNode.parse(n)),
      edges: Object.values(infraEdges).map((e) => InfraEdge.parse(e)),
    };
  }

  private snapshot(): ElementSnapshot[] {
    return [...this.elements.values()].map((element) => ({
      element,
      timeline: this.timelines.get(element.id) ?? [],
    }));
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
    for (const fn of this.infraListeners) fn(this.infra);
  }
}

/**
 * Live RTDB source. Lazy-imports the firebase SDK so the fixture path has zero
 * SDK cost. `config` is the user's own Firebase web config (BYOD).
 *
 * With `useAnonAuth`, it signs in anonymously before any read/write so
 * locked-down rules (`auth != null`) are satisfied. For test-mode (open) rules
 * leave it off.
 */
export interface LiveSourceOptions {
  useAnonAuth?: boolean;
}

export class LiveSource implements CanvasSource {
  private dbPromise?: Promise<{
    db: import("firebase/database").Database;
    ref: typeof import("firebase/database").ref;
    onValue: typeof import("firebase/database").onValue;
    set: typeof import("firebase/database").set;
    remove: typeof import("firebase/database").remove;
    get: typeof import("firebase/database").get;
  }>;

  constructor(
    private readonly config: Record<string, string>,
    private readonly projectId: string,
    private readonly options: LiveSourceOptions = {},
  ) {}

  private async fb() {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const { initializeApp } = await import("firebase/app");
        const { getDatabase, ref, onValue, set, remove, get } = await import(
          "firebase/database"
        );
        const app = initializeApp(this.config);
        if (this.options.useAnonAuth) {
          const { getAuth, signInAnonymously } = await import("firebase/auth");
          await signInAnonymously(getAuth(app));
        }
        return { db: getDatabase(app), ref, onValue, set, remove, get };
      })();
    }
    return this.dbPromise;
  }

  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void {
    let unsub = () => {};
    void (async () => {
      const { db, ref, onValue, get } = await this.fb();
      const elsRef = ref(db, paths.projectElements(this.projectId));
      unsub = onValue(elsRef, async (snap) => {
        const raw = (snap.val() ?? {}) as Record<string, unknown>;
        const result: ElementSnapshot[] = [];
        for (const value of Object.values(raw)) {
          const element = DesignElement.parse(value);
          const tlSnap = await get(
            ref(db, paths.timeline(this.projectId, element.id)),
          );
          // Timeline may be an array or a push-keyed object — normalize.
          const tl = normalizeList(tlSnap.val());
          result.push({
            element,
            timeline: tl.map((v) => VersionEntry.parse(v)),
          });
        }
        onChange(result);
      });
    })();
    return () => unsub();
  }

  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void {
    let unsubNodes = () => {};
    let unsubEdges = () => {};
    let nodes: InfraNode[] = [];
    let edges: InfraEdge[] = [];
    const emit = () => onChange({ nodes, edges });
    void (async () => {
      const { db, ref, onValue } = await this.fb();
      unsubNodes = onValue(ref(db, paths.infraNodes(this.projectId)), (snap) => {
        nodes = normalizeList(snap.val()).flatMap((v) => {
          const p = InfraNode.safeParse(v);
          return p.success ? [p.data] : [];
        });
        emit();
      });
      unsubEdges = onValue(ref(db, paths.infraEdges(this.projectId)), (snap) => {
        edges = normalizeList(snap.val()).flatMap((v) => {
          const p = InfraEdge.safeParse(v);
          return p.success ? [p.data] : [];
        });
        emit();
      });
    })();
    return () => {
      unsubNodes();
      unsubEdges();
    };
  }

  async saveElement(element: DesignElement): Promise<void> {
    const { db, ref, set } = await this.fb();
    await set(
      ref(db, paths.element(this.projectId, element.id)),
      DesignElement.parse(element),
    );
  }

  async deleteElement(elementId: string): Promise<void> {
    const { db, ref, remove } = await this.fb();
    await remove(ref(db, paths.element(this.projectId, elementId)));
  }
}
