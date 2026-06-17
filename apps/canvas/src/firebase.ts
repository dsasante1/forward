import {
  DesignElement,
  InfraEdge,
  InfraFlow,
  InfraNode,
  VersionEntry,
  normalizeList,
  paths,
} from "schema-nexus-core";

/**
 * Thrown when the signed-in user isn't a member of the project and the project
 * has already been claimed by someone else. Carries the user's uid so the UI can
 * show it — an existing member adds it to the roster to grant access.
 */
export class ProjectAccessError extends Error {
  constructor(
    readonly projectId: string,
    readonly uid: string,
  ) {
    super(
      `Not a member of project "${projectId}". Ask a current member to add your user id: ${uid}`,
    );
    this.name = "ProjectAccessError";
  }
}

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

/**
 * The project's infrastructure graph (pillar 3) — standalone nodes + edges —
 * plus the narrated `flows` layered over them (pillar 3b). A flow is a pure
 * function of its steps + these nodes, so it carries no geometry of its own.
 */
export interface InfraSnapshot {
  nodes: InfraNode[];
  edges: InfraEdge[];
  flows: InfraFlow[];
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
  /**
   * Enrol another uid into the project's member roster. Only meaningful for the
   * membership-gated live source — offline/mock sources omit it, so the editor
   * only shows the "add member" control when this is present.
   */
  addMember?(uid: string): Promise<void>;
}

/**
 * Offline source backed by a static tree (public/fixture.json), held in memory.
 * Edits mutate the in-memory copy and re-emit, so the editor is fully usable
 * with zero Firebase setup — handy for dev, demos and tests.
 */
export class FixtureSource implements CanvasSource {
  private elements = new Map<string, DesignElement>();
  private timelines = new Map<string, VersionEntry[]>();
  private infra: InfraSnapshot = { nodes: [], edges: [], flows: [] };
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
    const infraFlows =
      (tree.infra_flows as Record<string, Record<string, unknown>>)?.[
        this.projectId
      ] ?? {};
    this.infra = {
      nodes: Object.values(infraNodes).map((n) => InfraNode.parse(n)),
      edges: Object.values(infraEdges).map((e) => InfraEdge.parse(e)),
      flows: Object.values(infraFlows).map((f) => InfraFlow.parse(f)),
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
  /**
   * Called when the user can't access the project (not a member of a project
   * someone else already claimed). The UI uses this to surface the user's uid so
   * a member can enrol them. Without it, the access error is logged.
   */
  onError?: (err: Error) => void;
}

type Fb = {
  db: import("firebase/database").Database;
  ref: typeof import("firebase/database").ref;
  onValue: typeof import("firebase/database").onValue;
  set: typeof import("firebase/database").set;
  remove: typeof import("firebase/database").remove;
  get: typeof import("firebase/database").get;
};

export class LiveSource implements CanvasSource {
  private dbPromise?: Promise<Fb>;

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
        let uid: string | undefined;
        if (this.options.useAnonAuth) {
          const { getAuth, signInAnonymously } = await import("firebase/auth");
          const cred = await signInAnonymously(getAuth(app));
          uid = cred.user.uid;
        }
        const fb: Fb = { db: getDatabase(app), ref, onValue, set, remove, get };
        // With auth on, claim or verify project membership before any data read
        // or write — the rules gate every project subtree on the roster. Without
        // auth (test-mode/open rules) there's no uid to scope, so skip it.
        if (uid) {
          try {
            await this.ensureMembership(fb, uid);
          } catch (err) {
            this.options.onError?.(err as Error);
            throw err;
          }
        }
        return fb;
      })();
    }
    return this.dbPromise;
  }

  /**
   * Claim the project if it's unclaimed, or confirm the current uid is already
   * on the roster. Throws ProjectAccessError when the project belongs to others.
   */
  private async ensureMembership(fb: Fb, uid: string): Promise<void> {
    const { db, ref, get, set } = fb;
    const roster = (
      await get(ref(db, paths.projectMembers(this.projectId)))
    ).val() as Record<string, unknown> | null;
    if (!roster) {
      // Unclaimed: claim ownership (rules allow seeding only your own uid).
      await set(ref(db, paths.projectMember(this.projectId, uid)), {
        role: "owner",
        addedAt: new Date().toISOString(),
      });
      return;
    }
    if (roster[uid]) return; // already a member
    throw new ProjectAccessError(this.projectId, uid);
  }

  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void {
    let unsub = () => {};
    void (async () => {
      const fb = await this.fb().catch(() => null);
      if (!fb) return; // access error already reported via options.onError
      const { db, ref, onValue, get } = fb;
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
    let unsubFlows = () => {};
    let nodes: InfraNode[] = [];
    let edges: InfraEdge[] = [];
    let flows: InfraFlow[] = [];
    const emit = () => onChange({ nodes, edges, flows });
    void (async () => {
      const fb = await this.fb().catch(() => null);
      if (!fb) return; // access error already reported via options.onError
      const { db, ref, onValue } = fb;
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
      unsubFlows = onValue(ref(db, paths.infraFlows(this.projectId)), (snap) => {
        flows = normalizeList(snap.val()).flatMap((v) => {
          const p = InfraFlow.safeParse(v);
          return p.success ? [p.data] : [];
        });
        emit();
      });
    })();
    return () => {
      unsubNodes();
      unsubEdges();
      unsubFlows();
    };
  }

  async saveElement(element: DesignElement): Promise<void> {
    const fb = await this.fb().catch(() => null);
    if (!fb) return; // access error already reported via options.onError
    const { db, ref, set } = fb;
    await set(
      ref(db, paths.element(this.projectId, element.id)),
      DesignElement.parse(element),
    );
  }

  async deleteElement(elementId: string): Promise<void> {
    const fb = await this.fb().catch(() => null);
    if (!fb) return; // access error already reported via options.onError
    const { db, ref, remove } = fb;
    await remove(ref(db, paths.element(this.projectId, elementId)));
  }

  /**
   * Add another uid to the roster. The caller must already be a member (the
   * rules enforce this); the new uid joins as a plain `member`. Rejects so the
   * UI can report a bad uid or a permission failure.
   */
  async addMember(uid: string): Promise<void> {
    const { db, ref, set } = await this.fb();
    await set(ref(db, paths.projectMember(this.projectId, uid)), {
      role: "member",
      addedAt: new Date().toISOString(),
    });
  }
}
