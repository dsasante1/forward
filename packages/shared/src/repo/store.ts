/// <reference types="node" />
import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { diffBindings } from "../api-diff.js";
import { isIsoDay } from "../gantt.js";
import {
  MAX_IMPORT_ELEMENTS,
  designHash,
  importedElementId,
  pageFrameId,
  type ImportDesignReport,
} from "../design-import.js";
import {
  AgentNode,
  ApiBinding,
  Checkpoint,
  CheckpointChange,
  CheckpointInput,
  CheckpointSnapshot,
  DesignElement,
  DismissedDraft,
  type ElementOrigin,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  McpServerNode,
  Task,
  VersionEntry,
  descendantIds,
} from "../schema.js";
import { nextTaskKey } from "../tasks.js";
import {
  COLLECTIONS,
  FORMAT_VERSION,
  FORWARD_DIR,
  MANIFEST_FILE,
  collectionDir,
  fileNameForId,
  type CollectionKey,
} from "./layout.js";

/** An error carrying the HTTP status the router should answer with. */
export class RepoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

/** The `.forward/forward.json` manifest. */
export interface RepoManifest {
  format: number;
  /** Project id, the namespace every surface addresses (`ApiConfig.projectId`). */
  id: string;
  name: string;
}

export interface RepoStoreOptions {
  /** Who writes. Defaults to `$FORWARD_AUTHOR`, then git `user.name`, then the OS user. */
  author?: string;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

type Schema<T> = z.ZodType<T, unknown>;

/**
 * The file-backed store behind repo mode. It mirrors the central server's
 * semantics, so a project behaves the same whether it lives in Postgres or in
 * git. Writers stamp `updatedAt`; `saveElement` never touches `apiBinding`;
 * bind/unbind append an immutable history entry with a structured diff; deletes
 * cascade exactly as the server does.
 *
 * Synchronous on purpose. Projects are small, the files are local, and a
 * synchronous read-modify-write cannot interleave with another request in the
 * same process.
 */
export class RepoStore {
  readonly author: string;
  private readonly now: () => Date;

  constructor(
    readonly root: string,
    opts: RepoStoreOptions = {},
  ) {
    this.author = opts.author ?? "local";
    this.now = opts.now ?? (() => new Date());
  }

  // --- manifest ------------------------------------------------------------

  manifest(): RepoManifest {
    const file = join(this.root, FORWARD_DIR, MANIFEST_FILE);
    if (!existsSync(file)) {
      throw new RepoError(
        404,
        `No Forward project at ${this.root}. Run \`forward init\` to create .forward/${MANIFEST_FILE}.`,
      );
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RepoManifest>;
    if (!raw.id) throw new RepoError(500, `.forward/${MANIFEST_FILE} has no "id".`);
    return { format: raw.format ?? FORMAT_VERSION, id: raw.id, name: raw.name ?? raw.id };
  }

  // --- design elements -----------------------------------------------------

  listElements(): DesignElement[] {
    return this.readAll("elements", DesignElement);
  }

  getElement(id: string): DesignElement | undefined {
    return this.readOne("elements", id, DesignElement);
  }

  /**
   * Upsert geometry/style. A client-sent binding is ignored and the stored one
   * kept. `origin` is owned by {@link importDesign}: a save keeps the stored
   * origin when it sends one back and drops it when it doesn't (that is how a
   * draft is adopted), but can never set or change one — otherwise a client
   * could forge a hash and make an edited element overwritable by import.
   */
  saveElement(input: unknown): DesignElement {
    const parsed = this.parse(DesignElement, input, "design element");
    const { apiBinding: _ignored, origin: sentOrigin, ...clean } = parsed;
    const current = this.getElement(clean.id);
    const stored = current?.apiBinding;
    const origin = sentOrigin && current?.origin ? current.origin : undefined;
    const next = DesignElement.parse({
      ...clean,
      ...(stored ? { apiBinding: stored } : {}),
      ...(origin ? { origin } : {}),
      updatedAt: this.iso(),
    });
    this.write("elements", next.id, next);
    return next;
  }

  /** Partial update that preserves untouched fields, including the binding and origin. */
  patchElement(id: string, patch: unknown): DesignElement {
    const current = this.requireElement(id);
    const {
      apiBinding: _ignored,
      origin: _origin,
      ...rest
    } = (patch ?? {}) as Partial<DesignElement>;
    const next = this.parse(
      DesignElement,
      { ...current, ...rest, id, updatedAt: this.iso() },
      "design element",
    );
    this.write("elements", id, next);
    return next;
  }

  /**
   * Delete an element, by default with its `parentId` subtree. History is kept.
   * A deleted code draft is remembered in `dismissed/`, so the next import
   * doesn't bring it back (see {@link importDesign}).
   */
  deleteElement(id: string, cascade = true): string[] {
    const all = this.listElements();
    const byId = new Map(all.map((e) => [e.id, e]));
    const ids = cascade ? [id, ...descendantIds(id, all)] : [id];
    const at = this.iso();
    for (const target of ids) {
      const el = byId.get(target);
      if (this.remove("elements", target) && el?.origin) {
        this.write("dismissed", target, dismissedRecord(el, el.origin, byId, at, this.author));
      }
    }
    return ids;
  }

  /** Deleted code drafts the next import will not recreate. */
  listDismissed(): DismissedDraft[] {
    return this.readAll("dismissed", DismissedDraft);
  }

  /**
   * Write elements generated from frontend code (see design-import.ts), in one
   * call. Every element is validated before any file is written.
   *
   * First, each captured element is matched to the stored element it is:
   * - a stable key (test id, HTML id, JSX source line, label) matches by id;
   * - otherwise — and for anything still unmatched — by what it looks like
   *   (type, name or text, size), but only when that match is unambiguous both
   *   ways, so a draft whose positional key shifted keeps its id and API docs;
   * - a positional id that matched nothing still names the element in place.
   * A captured element that matches a deleted draft (`dismissed/`) is not
   * recreated, unless `restoreDismissed` is set.
   *
   * Then, per element: new → created; stored without `origin` (drawn by hand,
   * or adopted) → skipped; edited since its import → conflict; untouched →
   * updated, or unchanged when the code didn't change. Stored drafts of the
   * captured pages that matched nothing are reported as stale; `prune` removes
   * them — never one that is documented, edited, or holds a kept child, and
   * never with a cascade — and forgets dismissed drafts the code no longer
   * renders. The hash and `importedAt` are computed here; whatever a client
   * sends is ignored. API docs on an updated element are kept.
   */
  importDesign(input: unknown): ImportDesignReport {
    const body = (input ?? {}) as {
      elements?: unknown;
      prune?: unknown;
      dryRun?: unknown;
      restoreDismissed?: unknown;
    };
    if (!Array.isArray(body.elements)) {
      throw new RepoError(400, "Invalid design import: `elements` must be an array");
    }
    if (body.elements.length > MAX_IMPORT_ELEMENTS) {
      throw new RepoError(
        400,
        `Design import has ${body.elements.length} elements; the limit is ${MAX_IMPORT_ELEMENTS}. Capture fewer routes at a time.`,
      );
    }
    const dryRun = body.dryRun === true;
    const restore = body.restoreDismissed === true;
    const now = this.iso();

    const incoming: Imported[] = [];
    const seen = new Set<string>();
    body.elements.forEach((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const { apiBinding: _b, updatedAt: _u, origin, ...rest } = r;
      if (!origin || typeof origin !== "object") {
        throw new RepoError(400, `Invalid imported element at elements.${i}: missing origin`);
      }
      const parsed = this.parse(
        DesignElement,
        { ...rest, origin: { ...origin, hash: "-", importedAt: now }, updatedAt: now },
        `imported element at elements.${i}`,
      );
      if (seen.has(parsed.id)) {
        throw new RepoError(400, `Invalid design import: duplicate element id ${parsed.id}`);
      }
      seen.add(parsed.id);
      const stamped = parsed.origin;
      if (!stamped) throw new RepoError(400, `Invalid imported element at elements.${i}: missing origin`);
      incoming.push({ ...parsed, origin: stamped });
    });

    const existing = new Map(this.listElements().map((e) => [e.id, e]));
    const dismissed = new Map(this.listDismissed().map((d) => [d.id, d]));
    const scopes = new Set(incoming.map((e) => scopeOf(e.origin)));
    const report: ImportDesignReport = {
      dryRun,
      created: [],
      updated: [],
      unchanged: [],
      skipped: [],
      conflicts: [],
      rematched: [],
      dismissed: [],
      restored: [],
      stale: [],
      removed: [],
      kept: [],
      forgotten: [],
      dismissedPages: [],
      idMap: {},
    };

    // --- 1. identity: which stored element each captured element is --------
    // The rule throughout: an element's id (and the API docs on it) moves only
    // when nothing else is plausible. Whatever stays ambiguous is created new,
    // leaving the old draft stale and visible, rather than guessed at.
    const resolved = new Map<string, string>(); // captured id → stored id
    const claimed = new Set<string>();
    const notRecreated = new Set<string>(); // captured ids held back by a dismissal
    const usedDismissed = new Set<string>();
    const forget = new Set<string>(); // dismissal records to delete
    const claim = (el: Imported, id: string) => {
      resolved.set(el.id, id);
      claimed.add(id);
    };
    const dismiss = (el: Imported, recordId: string) => {
      notRecreated.add(el.id);
      usedDismissed.add(recordId);
    };
    const capturedParent = new Map(incoming.map((e) => [e.id, e.parentId]));
    const finalRef = (ref: string | null | undefined): string | null | undefined => {
      let p = ref;
      while (p && notRecreated.has(p)) p = capturedParent.get(p) ?? null;
      return p ? (resolved.get(p) ?? p) : p;
    };
    /**
     * The stored id of a captured element's parent — but only once that parent
     * is matched (or is new). Until then a positional parent id may name a
     * *different* stored element, so it says nothing: `undefined`.
     */
    const parentOf = (el: Imported): string | null | undefined => {
      let p = el.parentId;
      while (p && notRecreated.has(p)) p = capturedParent.get(p) ?? null;
      if (!p) return null;
      return resolved.get(p);
    };
    // What a container holds: the text of everything inside it, in page order.
    // Lets occurrences of one component (same name, same size) be told apart.
    const childrenOf = (els: Iterable<DesignElement>) => {
      const m = new Map<string, DesignElement[]>();
      for (const e of els) if (e.parentId) m.set(e.parentId, [...(m.get(e.parentId) ?? []), e]);
      return m;
    };
    const capturedKids = childrenOf(incoming);
    const storedKids = childrenOf(existing.values());
    const capturedShape = new Map<string, Shape>(
      incoming.map((e) => [e.id, { ...e, ...(capturedKids.has(e.id) ? { sig: signatureOf(e.id, capturedKids) } : {}) }]),
    );
    const shapeOf = (el: Imported) => capturedShape.get(el.id) as Shape;
    const capturedView = new Map<string, DesignElement>([...existing, ...incoming.map((e) => [e.id, e] as const)]);
    const placeIn = (e: DesignElement, view: Map<string, DesignElement>) => {
      const frame = e.origin ? view.get(pageFrameId(e.origin)) : undefined;
      return { x: e.x - (frame?.x ?? 0), y: e.y - (frame?.y ?? 0) };
    };
    const byPlace = (a: { x: number; y: number }, b: { x: number; y: number }) => a.y - b.y || a.x - b.x;

    // A dismissal contradicted by a live element (a checkpoint restore, or a
    // `git checkout` of the file) no longer applies.
    for (const d of [...dismissed.values()]) {
      if (existing.has(d.id)) {
        forget.add(d.id);
        dismissed.delete(d.id);
      }
    }
    const draftByKey = new Map<string, string>();
    for (const e of existing.values()) if (e.origin) draftByKey.set(keyOf(e.origin), e.id);
    const dismissedByKey = new Map<string, string>();
    for (const d of dismissed.values()) dismissedByKey.set(keyOf(d), d.id);

    // A page whose frame someone deleted stays deleted, all of it.
    const goneScopes = new Set<string>();
    if (!restore) {
      for (const el of incoming) {
        if (el.origin.key === "page" && !existing.has(el.id) && dismissed.has(el.id)) goneScopes.add(scopeOf(el.origin));
      }
      for (const el of incoming) if (goneScopes.has(scopeOf(el.origin))) notRecreated.add(el.id);
      for (const d of dismissed.values()) if (goneScopes.has(scopeOf(d))) usedDismissed.add(d.id);
      report.dismissedPages.push(...[...goneScopes].map((sc) => sc.replace("\u0000", " · ")));
    }

    // a. Trusted keys — the page frame, and a test id or HTML id that occurs
    //    once on the page — resolve by id. Repeats (`~n`), positions and JSX
    //    source lines shift as the code changes, so they are only hints.
    const baseOf = (o: ElementOrigin) => `${scopeOf(o)}\u0000${o.key.replace(/~\d+(?=$|::)/g, "")}`;
    const baseCount = new Map<string, number>();
    for (const el of incoming) baseCount.set(baseOf(el.origin), (baseCount.get(baseOf(el.origin)) ?? 0) + 1);
    const trusted = (el: Imported) =>
      el.origin.key === "page" ||
      (/^(tid:|#)/.test(el.origin.key) && !/\[\d+\]/.test(el.origin.key) && baseCount.get(baseOf(el.origin)) === 1);
    for (const el of incoming) {
      if (notRecreated.has(el.id) || !trusted(el)) continue;
      const id = existing.has(el.id) ? el.id : draftByKey.get(keyOf(el.origin));
      if (id && !claimed.has(id)) claim(el, id);
      else if (!id && !restore) {
        const d = dismissed.has(el.id) ? el.id : dismissedByKey.get(keyOf(el.origin));
        if (d) dismiss(el, d);
      }
    }

    // b. Everything else by what it looks like.
    type Candidate = {
      id: string;
      dismissed: boolean;
      scope: string;
      parentId: string | null | undefined;
      at: { x: number; y: number };
      shape: Shape;
      documented: boolean;
      /** No origin (adopted or hand-drawn): matching it means "leave it alone". */
      owned?: boolean;
    };
    const storedShape = (e: DesignElement): Shape => ({
      ...e,
      ...(storedKids.has(e.id) ? { sig: signatureOf(e.id, storedKids) } : {}),
    });
    // Elements without origin inside a captured page — adopted drafts, or a
    // designer's own — are candidates too: matching one means "leave it alone".
    const pageScope = new Map<string, string>();
    for (const el of incoming) if (el.origin.key === "page") pageScope.set(el.id, scopeOf(el.origin));
    const scopeWithin = (e: DesignElement): string | undefined => {
      const seen = new Set<string>();
      for (let cur: DesignElement | undefined = e; cur && !seen.has(cur.id); cur = existing.get(cur.parentId ?? "")) {
        seen.add(cur.id);
        const sc = pageScope.get(cur.id);
        if (sc) return sc;
      }
      return undefined;
    };
    const owned: Candidate[] = [];
    for (const e of existing.values()) {
      if (e.origin || claimed.has(e.id)) continue;
      const sc = scopeWithin(e);
      if (sc) owned.push({ id: e.id, dismissed: false, owned: true, scope: sc, parentId: e.parentId, at: placeIn(e, existing), shape: storedShape(e), documented: Boolean(e.apiBinding) });
    }
    const pool: Candidate[] = [
      ...owned,
      ...[...existing.values()]
        .filter((e) => e.origin && scopes.has(scopeOf(e.origin)) && !claimed.has(e.id))
        .map((e) => ({
          id: e.id,
          dismissed: false,
          scope: scopeOf(e.origin as ElementOrigin),
          parentId: e.parentId,
          at: placeIn(e, existing),
          shape: storedShape(e),
          documented: Boolean(e.apiBinding),
        })),
      ...(restore ? [] : [...dismissed.values()])
        .filter((d) => scopes.has(scopeOf(d)) && !usedDismissed.has(d.id))
        .map((d) => ({
          id: d.id,
          dismissed: true,
          scope: scopeOf(d),
          parentId: d.parentId,
          at: { x: d.x, y: d.y },
          shape: { ...d, ...(d.signature !== undefined ? { sig: d.signature } : {}) } as Shape,
          documented: false,
        })),
    ];
    // Index by type + name and type + text, the two ways sameShape can agree.
    const index = new Map<string, Candidate[]>();
    const indexKeys = (scope: string, sh: Shape) => [
      ...(sh.name ? [`${scope}|${kindOf(sh.type)}|n:${sh.name}`] : []),
      ...(sh.text ? [`${scope}|${kindOf(sh.type)}|t:${sh.text}`] : []),
    ];
    for (const c of pool) {
      for (const k of indexKeys(c.scope, c.shape)) index.set(k, [...(index.get(k) ?? []), c]);
    }
    const near = (a: { x: number; y: number }, b: { x: number; y: number }, sh: Shape) =>
      Math.abs(a.x - b.x) <= Math.max(16, sh.width / 2) && Math.abs(a.y - b.y) <= Math.max(16, sh.height / 2);
    const free = (c: Candidate) => !(c.dismissed ? usedDismissed.has(c.id) : claimed.has(c.id));
    const open = (el: Imported) => !resolved.has(el.id) && !notRecreated.has(el.id);
    // Drafts get the first claim; elements without origin (adopted, or a
    // designer's own) are only considered once no draft could be the match.
    let ownedTurn = false;
    const looksLike = (el: Imported, c: Candidate) =>
      c.scope === scopeOf(el.origin) && sameShape(shapeOf(el), c.shape) && (ownedTurn || !c.owned);
    const lookalikes = (el: Imported) => {
      const out = new Set<Candidate>();
      for (const k of indexKeys(scopeOf(el.origin), el)) for (const c of index.get(k) ?? []) if (free(c) && looksLike(el, c)) out.add(c);
      return [...out];
    };
    const byId = new Map(pool.map((c) => [c.id, c]));
    const take = (el: Imported, c: Candidate) => {
      if (c.dismissed) dismiss(el, c.id);
      else {
        claim(el, c.id);
        // Only news when the key actually shifted since the draft was written.
        const stored = existing.get(c.id)?.origin;
        if (stored && stored.key !== el.origin.key) report.rematched.push(c.id);
      }
    };

    for (let progress = true; progress; ) {
      progress = false;
      const remaining = incoming.filter(open);
      // Rivals: other open captured elements that look like a candidate.
      const suitors = new Map<Candidate, Imported[]>();
      const listOf = new Map<Imported, Candidate[]>();
      for (const el of remaining) {
        const list = lookalikes(el);
        listOf.set(el, list);
        for (const c of list) suitors.set(c, [...(suitors.get(c) ?? []), el]);
      }
      // Unique both ways.
      for (const el of remaining) {
        if (!open(el)) continue;
        const list = (listOf.get(el) ?? []).filter(free);
        const only = list.length === 1 ? list[0] : undefined;
        if (only && (suitors.get(only) ?? []).filter(open).length === 1) {
          take(el, only);
          progress = true;
        }
      }
      // A container its matched children agree on: if every matched child of
      // an open container sits in the same stored container, that is the one.
      for (const el of remaining) {
        if (!open(el)) continue;
        const kids = (capturedKids.get(el.id) ?? []).filter((k) => resolved.has(k.id));
        if (!kids.length) continue;
        const homes = new Set(kids.map((k) => existing.get(resolved.get(k.id) ?? "")?.parentId ?? null));
        const [home] = [...homes];
        const c = homes.size === 1 && home ? byId.get(home) : undefined;
        if (c && free(c) && !c.dismissed && kindOf(c.shape.type) === kindOf(el.type) && c.scope === scopeOf(el.origin)) {
          take(el, c);
          progress = true;
        }
      }
      // Look-alikes under the same (matched) parent pair up in page order —
      // only when both sides number the same, so nobody's docs slide to a neighbour.
      for (const el of remaining) {
        if (!open(el)) continue;
        const parent = parentOf(el);
        if (parent === undefined) continue;
        const sibs = (listOf.get(el) ?? []).filter((c) => free(c) && c.parentId === parent);
        if (!sibs.length) continue;
        const group = remaining.filter(
          (o) => open(o) && parentOf(o) === parent && sibs.some((c) => looksLike(o, c)),
        );
        const all = [...new Set(group.flatMap((o) => (listOf.get(o) ?? []).filter((c) => free(c) && c.parentId === parent)))];
        if (group.length !== all.length) continue;
        group.sort((a, b) => byPlace(placeIn(a, capturedView), placeIn(b, capturedView)));
        all.sort((a, b) => byPlace(a.at, b.at));
        if (!group.every((o, i) => looksLike(o, all[i] as Candidate))) continue;
        group.forEach((o, i) => take(o, all[i] as Candidate));
        progress = true;
      }
    }

    // c. Content changed in place: the one open element and the one free
    //    draft of the same type and size, under the same parent, where it was.
    for (const el of incoming.filter(open)) {
      const parent = parentOf(el);
      if (parent === undefined) continue;
      const here = placeIn(el, capturedView);
      const drafts = pool.filter(
        (c) =>
          free(c) &&
          !c.dismissed &&
          c.scope === scopeOf(el.origin) &&
          c.parentId === parent &&
          !c.owned &&
          kindOf(c.shape.type) === kindOf(el.type) &&
          sizeClose(el, c.shape) &&
          near(here, c.at, c.shape) &&
          // With API docs at stake, "changed in place" isn't enough on its own.
          (!c.documented || sameContent(shapeOf(el), c.shape)),
      );
      if (drafts.length !== 1) continue;
      const only = drafts[0] as Candidate;
      const rivals = incoming.filter(
        (o) => o !== el && open(o) && kindOf(o.type) === kindOf(el.type) && parentOf(o) === parent && sizeClose(o, only.shape),
      );
      if (!rivals.length) take(el, only);
    }

    // c2. Adopted or hand-drawn elements: a unique look-alike is left alone.
    ownedTurn = true;
    for (const el of incoming.filter(open)) {
      const list = lookalikes(el).filter((c) => c.owned);
      const only = list.length === 1 ? list[0] : undefined;
      if (!only) continue;
      const rivals = incoming.filter((o) => o !== el && open(o) && looksLike(o, only));
      if (!rivals.length) take(el, only);
    }

    // d. Nothing looked like it: its positional id still names the element in
    //    place (resized or restyled in code) — if that element is still free,
    //    of the same type under the same parent, and, when it carries API docs,
    //    still resembles it. An element without origin is only ever skipped.
    for (const el of incoming.filter(open)) {
      const hint = [el.id, draftByKey.get(keyOf(el.origin))].find(
        (id): id is string => id !== undefined && existing.has(id) && !claimed.has(id),
      );
      const target = hint ? existing.get(hint) : undefined;
      if (!hint || !target) continue;
      if (!target.origin) {
        claim(el, hint);
        continue;
      }
      const parent = parentOf(el);
      if (parent === undefined || kindOf(target.type) !== kindOf(el.type) || (target.parentId ?? null) !== parent) continue;
      if (target.apiBinding) {
        // With API docs at stake, the content must still agree (size alone is
        // what every row of a list shares), and nothing else captured may look
        // like it more.
        const theirs = storedShape(target);
        const rival = incoming.some((o) => o !== el && open(o) && sameShape(shapeOf(o), theirs));
        if (!sameContent(shapeOf(el), theirs) || rival) continue;
      }
      claim(el, hint);
    }

    // e. New: its own id, unless that now belongs to another element.
    for (const el of incoming.filter(open)) {
      let id = el.id;
      for (let n = 2; existing.has(id) || claimed.has(id); n++) {
        id = importedElementId(el.origin.route, el.origin.viewport ?? "", `${el.origin.key}\u0001${n}`);
      }
      claim(el, id);
    }
    report.dismissed.push(...usedDismissed);
    for (const el of incoming) {
      const final = notRecreated.has(el.id) ? null : (resolved.get(el.id) ?? el.id);
      if (final !== el.id) report.idMap[el.id] = final;
    }

    // Rewrite ids and references; a child of a dismissed element moves up to
    // the nearest ancestor that stays.
    const live: Imported[] = [];
    for (const el of incoming) {
      if (notRecreated.has(el.id)) continue;
      const { componentId, ...rest } = el;
      const master = componentId && !notRecreated.has(componentId) ? finalRef(componentId) : undefined;
      live.push({
        ...rest,
        id: resolved.get(el.id) ?? el.id,
        parentId: finalRef(el.parentId) ?? null,
        ...(master ? { componentId: master } : {}),
      });
    }
    // An instance whose master was dismissed becomes a plain box.
    const parents = new Set(live.map((e) => e.parentId));
    for (const el of live) {
      if (el.type === "instance" && !el.componentId) el.type = parents.has(el.id) ? "frame" : "rectangle";
    }

    // --- 2. hash: positions relative to each page's frame (see designHash) ---
    // The captured elements against the captured frame, stored ones against the
    // stored frame — so a page someone dragged elsewhere is still untouched.
    const offset = (o: ElementOrigin, from: Map<string, DesignElement>) => {
      const frame = from.get(pageFrameId(o));
      return frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 };
    };
    const hashOf = (e: DesignElement, from: Map<string, DesignElement>) =>
      e.origin ? designHash(e, offset(e.origin, from)) : designHash(e);
    const incomingView = new Map<string, DesignElement>([...existing, ...live.map((e) => [e.id, e] as const)]);
    for (const el of live) el.origin = { ...el.origin, hash: hashOf(el, incomingView) };

    // --- 3. classify ----------------------------------------------------------
    const writes: DesignElement[] = [];
    for (const el of live) {
      const cur = existing.get(el.id);
      if (!cur) {
        report.created.push(el.id);
        writes.push(el);
      } else if (!cur.origin) {
        report.skipped.push(el.id);
      } else if (hashOf(cur, existing) !== cur.origin.hash) {
        report.conflicts.push({ id: el.id, name: cur.name });
      } else if (cur.origin.hash === el.origin.hash && sameProvenance(cur.origin, el.origin)) {
        report.unchanged.push(el.id);
      } else {
        report.updated.push(el.id);
        writes.push(cur.apiBinding ? { ...el, apiBinding: cur.apiBinding } : el);
      }
    }
    if (restore) {
      // Brought back on purpose: no dismissal for these pages applies any more.
      // Report the created drafts that a dismissal had been holding back.
      const records = [...dismissed.values()].filter((d) => scopes.has(scopeOf(d)));
      for (const d of records) forget.add(d.id);
      const created = new Set(report.created);
      for (const el of live) {
        if (!created.has(el.id)) continue;
        const held =
          dismissed.has(el.id) ||
          dismissedByKey.has(keyOf(el.origin)) ||
          records.some((d) => scopeOf(d) === scopeOf(el.origin) && sameShape(el, { ...d, ...(d.signature !== undefined ? { sig: d.signature } : {}) }));
        if (held) report.restored.push(el.id);
      }
    }

    // --- 4. stale drafts, and prune ------------------------------------------
    for (const e of existing.values()) {
      if (e.origin && scopes.has(scopeOf(e.origin)) && !claimed.has(e.id)) report.stale.push(e.id);
    }
    if (body.prune === true) {
      const after = new Map(existing);
      for (const w of writes) after.set(w.id, w);
      const prunable = new Set<string>();
      for (const id of report.stale) {
        const e = existing.get(id);
        if (!e?.origin) continue;
        if (e.apiBinding) report.kept.push({ id, reason: "documented" });
        else if (hashOf(e, existing) !== e.origin.hash) report.kept.push({ id, reason: "edited" });
        else prunable.add(id);
      }
      // An element still parenting something that stays must stay too — and so
      // must its parent, up the tree.
      const queue = [...after.values()].filter((c) => !prunable.has(c.id)).map((c) => c.parentId);
      while (queue.length) {
        const id = queue.pop();
        if (!id || !prunable.has(id)) continue;
        prunable.delete(id);
        report.kept.push({ id, reason: "has-kept-children" });
        queue.push(after.get(id)?.parentId ?? null);
      }
      report.removed.push(...prunable);
      // Dismissed drafts the code no longer renders need no remembering.
      for (const d of dismissed.values()) {
        if (scopes.has(scopeOf(d)) && !usedDismissed.has(d.id) && !forget.has(d.id)) {
          forget.add(d.id);
          report.forgotten.push(d.id);
        }
      }
    }

    if (!dryRun) {
      for (const el of writes) this.write("elements", el.id, el);
      for (const id of report.removed) this.remove("elements", id);
      for (const id of forget) this.remove("dismissed", id);
    }
    return report;
  }

  /** Attach or replace the API docs and append a version entry with a diff. */
  bind(
    id: string,
    body: { binding?: unknown; version?: string; changeLog?: string; action?: string },
  ): void {
    const current = this.requireElement(id);
    const binding = this.parse(ApiBinding, body.binding, "API binding");
    const action = body.action === "created" ? "created" : "modified";
    this.write("elements", id, DesignElement.parse({
      ...current,
      apiBinding: binding,
      updatedAt: this.iso(),
    }));
    this.appendVersion(id, {
      version: body.version ?? "",
      author: this.author,
      action,
      changeLog: body.changeLog ?? "",
      endpoint: { title: binding.title },
      diff: diffBindings(current.apiBinding, binding),
    });
  }

  /** Remove the API docs and append a "deleted" version entry. */
  unbind(id: string, body: { version?: string; changeLog?: string; title?: string }): void {
    const current = this.requireElement(id);
    const { apiBinding: _drop, ...rest } = current;
    this.write("elements", id, DesignElement.parse({ ...rest, updatedAt: this.iso() }));
    this.appendVersion(id, {
      version: body.version ?? "",
      author: this.author,
      action: "deleted",
      changeLog: body.changeLog ?? "Removed API documentation",
      ...(body.title ? { endpoint: { title: body.title } } : {}),
      diff: diffBindings(current.apiBinding, undefined),
    });
  }

  /** Every element's API-doc history, oldest first, keyed by element id. */
  timelines(): Record<string, VersionEntry[]> {
    const dir = collectionDir(this.root, "history");
    const out: Record<string, VersionEntry[]> = {};
    for (const sub of listDirs(dir)) {
      const entries: VersionEntry[] = [];
      for (const file of listJson(join(dir, sub))) {
        const parsed = VersionEntry.safeParse(readJson(join(dir, sub, file)));
        if (parsed.success) entries.push(parsed.data);
      }
      if (!entries.length) continue;
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const elementId = (readJson(join(dir, sub, ".element")) as string | undefined) ?? sub;
      out[typeof elementId === "string" ? elementId : sub] = entries;
    }
    return out;
  }

  // --- infra graph + flows -------------------------------------------------

  infra() {
    return {
      nodes: this.readAll("infraNodes", InfraNode),
      edges: this.readAll("infraEdges", InfraEdge),
      flows: this.readAll("infraFlows", InfraFlow),
      entities: this.readAll("entities", Entity),
      relations: this.readAll("relations", EntityRelation),
    };
  }

  saveInfraNode(input: unknown): InfraNode {
    return this.upsert("infraNodes", InfraNode, input, "infra node");
  }

  saveInfraEdge(input: unknown): InfraEdge {
    return this.upsert("infraEdges", InfraEdge, input, "infra edge");
  }

  saveInfraFlow(input: unknown): InfraFlow {
    return this.upsert("infraFlows", InfraFlow, input, "flow");
  }

  /** Delete a node and every edge touching it, so none dangle. */
  deleteInfraNode(id: string): void {
    this.remove("infraNodes", id);
    for (const edge of this.readAll("infraEdges", InfraEdge)) {
      if (edge.from === id || edge.to === id) this.remove("infraEdges", edge.id);
    }
  }

  deleteInfraEdge(id: string): void {
    this.remove("infraEdges", id);
  }

  deleteInfraFlow(id: string): void {
    this.remove("infraFlows", id);
  }

  // --- entities (ER) -------------------------------------------------------

  saveEntity(input: unknown): Entity {
    return this.upsert("entities", Entity, input, "entity");
  }

  saveRelation(input: unknown): EntityRelation {
    return this.upsert("relations", EntityRelation, input, "relation");
  }

  /** Delete an entity and every relation touching it. */
  deleteEntity(id: string): void {
    this.remove("entities", id);
    for (const rel of this.readAll("relations", EntityRelation)) {
      if (rel.from === id || rel.to === id) this.remove("relations", rel.id);
    }
  }

  deleteRelation(id: string): void {
    this.remove("relations", id);
  }

  // --- agents + MCP servers ------------------------------------------------

  agents() {
    return {
      agents: this.readAll("agents", AgentNode),
      servers: this.readAll("servers", McpServerNode),
    };
  }

  saveAgent(input: unknown): AgentNode {
    return this.upsert("agents", AgentNode, input, "agent");
  }

  saveServer(input: unknown): McpServerNode {
    return this.upsert("servers", McpServerNode, input, "MCP server");
  }

  deleteAgent(id: string): void {
    this.remove("agents", id);
  }

  /** Delete a server and drop it from every agent's `mcpServerIds`. */
  deleteServer(id: string): void {
    this.remove("servers", id);
    for (const agent of this.readAll("agents", AgentNode)) {
      if (!agent.mcpServerIds.includes(id)) continue;
      this.write("agents", agent.id, AgentNode.parse({
        ...agent,
        mcpServerIds: agent.mcpServerIds.filter((s) => s !== id),
        updatedAt: this.iso(),
      }));
    }
  }

  // --- tasks ---------------------------------------------------------------

  listTasks(): Task[] {
    return this.readAll("tasks", Task);
  }

  /**
   * Upsert a task. `createdAt` survives, `updatedAt` is stamped, a missing key is assigned.
   * A new or changed `dueDate` must be an ISO date (or empty, to clear it); a free-form
   * label written before that rule is kept as long as the write leaves it unchanged, so
   * old tasks stay readable and editable (`forward validate` warns about them).
   *
   * The backend owns identity: a new task's `reporter` and every new activity entry's
   * `actor` are this store's author, whatever the client sent; what is already stored
   * keeps its attribution, including records written before this rule.
   */
  saveTask(input: unknown): Task {
    const parsed = this.parse(Task, input, "task");
    const prior = this.readOne("tasks", parsed.id, Task);
    const due = parsed.dueDate?.trim();
    if (due && due !== prior?.dueDate?.trim() && !isIsoDay(due)) {
      throw new RepoError(400, `Invalid task at dueDate: Due date must be an ISO date (YYYY-MM-DD), got "${due}".`);
    }
    const now = this.iso();
    const actors = new Map(prior?.activity.map((a) => [a.id, a.actor]));
    const next: Task = {
      ...parsed,
      reporter: prior ? prior.reporter : this.author,
      activity: parsed.activity.map((a) => ({ ...a, actor: actors.get(a.id) ?? this.author })),
      createdAt: prior?.createdAt || parsed.createdAt || now,
      updatedAt: now,
    };
    if (!next.key) next.key = nextTaskKey(this.listTasks().map((t) => t.key));
    const valid = Task.parse(next);
    this.write("tasks", valid.id, valid);
    return valid;
  }

  deleteTask(id: string): void {
    this.remove("tasks", id);
  }

  // --- checkpoints ---------------------------------------------------------

  listCheckpoints(): Checkpoint[] {
    return this.readAll("checkpoints", Checkpoint).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  /** Freeze the current design + infra into a new checkpoint. */
  createCheckpoint(input: unknown): Checkpoint {
    const clean = this.parse(CheckpointInput, input, "checkpoint");
    const snapshot = CheckpointSnapshot.parse({
      elements: this.listElements(),
      infraNodes: this.readAll("infraNodes", InfraNode),
      infraEdges: this.readAll("infraEdges", InfraEdge),
      infraFlows: this.readAll("infraFlows", InfraFlow),
    });
    const cp = Checkpoint.parse({
      id: `cp_${randomUUID()}`,
      ...clean,
      author: this.author,
      changes: changesOf(snapshot),
      snapshot,
      createdAt: this.iso(),
    });
    this.write("checkpoints", cp.id, cp);
    return cp;
  }

  deleteCheckpoint(id: string): void {
    this.remove("checkpoints", id);
  }

  /** Rewind design + infra to a checkpoint. API-doc history is left intact. */
  restoreCheckpoint(id: string): Checkpoint {
    const cp = this.readOne("checkpoints", id, Checkpoint);
    if (!cp) throw new RepoError(404, `No checkpoint "${id}"`);
    const layers: Array<[CollectionKey, Array<{ id: string }>]> = [
      ["elements", cp.snapshot.elements],
      ["infraNodes", cp.snapshot.infraNodes],
      ["infraEdges", cp.snapshot.infraEdges],
      ["infraFlows", cp.snapshot.infraFlows],
    ];
    for (const [key, items] of layers) {
      rmSync(collectionDir(this.root, key), { recursive: true, force: true });
      for (const item of items) this.write(key, item.id, item);
    }
    // A restored element is no longer a deleted draft.
    for (const item of cp.snapshot.elements) this.remove("dismissed", item.id);
    return cp;
  }

  // --- internals -----------------------------------------------------------

  private iso(): string {
    return this.now().toISOString();
  }

  private requireElement(id: string): DesignElement {
    const el = this.getElement(id);
    if (!el) throw new RepoError(404, `No design element "${id}"`);
    return el;
  }

  /** Validate a body against a schema, turning a Zod failure into a 400. */
  private parse<T>(schema: Schema<T>, value: unknown, what: string): T {
    const res = schema.safeParse(value);
    if (res.success) return res.data;
    const issue = res.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    throw new RepoError(400, `Invalid ${what}${where}: ${issue?.message ?? "bad shape"}`);
  }

  /** Validate, stamp `updatedAt`, write. Shared by every simple graph layer. */
  private upsert<T extends { id: string }>(
    key: CollectionKey,
    schema: Schema<T>,
    input: unknown,
    what: string,
  ): T {
    const stamped = { ...(input as object), updatedAt: this.iso() };
    const next = this.parse(schema, stamped, what);
    this.write(key, next.id, next);
    return next;
  }

  private appendVersion(elementId: string, input: Omit<VersionEntry, "timestamp">): void {
    const dir = join(collectionDir(this.root, "history"), fileNameForId(elementId));
    mkdirSync(dir, { recursive: true });
    // Keep each element's timestamps strictly increasing: entries written in the
    // same millisecond would tie, and the random file suffix would decide their order.
    const last = listJson(dir).reduce((max, file) => Math.max(max, Number.parseInt(file, 10) || 0), 0);
    const timestamp = Math.max(this.now().getTime(), last + 1);
    const entry = VersionEntry.parse({ ...input, timestamp });
    if (fileNameForId(elementId) !== elementId) {
      // Encoded directory names can't be decoded reliably, so record the real id.
      writeAtomic(join(dir, ".element"), `${JSON.stringify(elementId)}\n`);
    }
    const name = `${entry.timestamp}-${randomBytes(3).toString("hex")}.json`;
    writeAtomic(join(dir, name), toJson(entry));
  }

  private readAll<T>(key: CollectionKey, schema: Schema<T>): T[] {
    const dir = collectionDir(this.root, key);
    const out: T[] = [];
    for (const file of listJson(dir)) {
      const parsed = schema.safeParse(readJson(join(dir, file)));
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  private readOne<T>(key: CollectionKey, id: string, schema: Schema<T>): T | undefined {
    const raw = readJson(this.pathOf(key, id));
    if (raw === undefined) return undefined;
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  private write(key: CollectionKey, id: string, value: unknown): void {
    const file = this.pathOf(key, id);
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, toJson(value));
  }

  private remove(key: CollectionKey, id: string): boolean {
    const file = this.pathOf(key, id);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  }

  private pathOf(key: CollectionKey, id: string): string {
    return join(this.root, FORWARD_DIR, COLLECTIONS[key], `${fileNameForId(id)}.json`);
  }
}

/** An element as `importDesign` writes it: always carrying its provenance. */
type Imported = DesignElement & { origin: ElementOrigin };

type Scoped = { route: string; viewport?: string | undefined };
/** A captured page: one route at one viewport. */
const scopeOf = (o: Scoped) => `${o.route}\u0000${o.viewport ?? ""}`;
/** A captured node's identity within its page. */
const keyOf = (o: Scoped & { key: string }) => `${scopeOf(o)}\u0000${o.key}`;

/** What an element looks like, for matching a re-keyed capture to its draft. */
type Shape = { type: string; name: string; text?: string | undefined; width: number; height: number; sig?: string | undefined };

/**
 * Component and instance are one kind for matching: which occurrence becomes
 * the master depends on page order, so inserting one flips the others.
 */
function kindOf(type: string): string {
  return type === "instance" ? "component" : type;
}

/** The text inside a container, in page order — its content signature. */
function signatureOf(id: string, children: Map<string, DesignElement[]>): string {
  const texts: Array<{ y: number; x: number; t: string }> = [];
  const seen = new Set<string>();
  const walk = (pid: string) => {
    for (const c of children.get(pid) ?? []) {
      if (seen.has(c.id) || texts.length >= 40) continue;
      seen.add(c.id);
      if (c.text) texts.push({ y: c.y, x: c.x, t: c.text });
      walk(c.id);
    }
  };
  walk(id);
  return texts
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((t) => t.t)
    .join("\u0000");
}

/** Same content: the text when either has some, else the name and what it holds. */
function sameContent(a: Shape, b: Shape): boolean {
  return a.text || b.text ? a.text === b.text : a.name === b.name && a.sig === b.sig;
}

/** About the same size: within 10% (or 4px for small boxes) each way. */
function sizeClose(a: Shape, b: Shape): boolean {
  const close = (p: number, q: number) => Math.abs(p - q) <= Math.max(4, 0.1 * Math.max(p, q));
  return close(a.width, b.width) && close(a.height, b.height);
}

/**
 * Same type, same content, about the same size (position is ignored: content
 * shifts). Content is the text when both have some — list rows often share a
 * name (one test id for every row) and differ only in text — otherwise the name.
 */
function sameShape(a: Shape, b: Shape): boolean {
  if (kindOf(a.type) !== kindOf(b.type) || !sizeClose(a, b)) return false;
  if (a.text && b.text) return a.text === b.text;
  if (a.name === "" || a.name !== b.name || !a.text !== !b.text) return false;
  // Containers: the same name (every occurrence of a component shares it) is
  // not enough — what they hold must agree too.
  return a.sig === undefined && b.sig === undefined ? true : a.sig === b.sig;
}

/** The record a deleted draft leaves behind; position is kept relative to its page frame. */
function dismissedRecord(
  el: DesignElement,
  origin: ElementOrigin,
  elements: Map<string, DesignElement>,
  at: string,
  by: string,
): DismissedDraft {
  const children = new Map<string, DesignElement[]>();
  for (const e of elements.values()) if (e.parentId) children.set(e.parentId, [...(children.get(e.parentId) ?? []), e]);
  const frame = elements.get(pageFrameId(origin));
  return DismissedDraft.parse({
    id: el.id,
    route: origin.route,
    ...(origin.viewport !== undefined ? { viewport: origin.viewport } : {}),
    key: origin.key,
    type: el.type,
    name: el.name,
    ...(el.text !== undefined ? { text: el.text } : {}),
    parentId: el.parentId,
    ...(children.has(el.id) ? { signature: signatureOf(el.id, children) } : {}),
    x: el.x - (frame?.x ?? 0),
    y: el.y - (frame?.y ?? 0),
    width: el.width,
    height: el.height,
    dismissedAt: at,
    by,
  });
}

/** Same source facts (ignoring hash and time), so an unchanged re-import writes nothing. */
function sameProvenance(a: ElementOrigin, b: ElementOrigin): boolean {
  return (
    a.route === b.route &&
    a.viewport === b.viewport &&
    a.key === b.key &&
    a.source === b.source &&
    a.component === b.component
  );
}

/** Per-layer change-count chips for a checkpoint card, matching the server. */
function changesOf(snapshot: CheckpointSnapshot): CheckpointChange[] {
  const out: CheckpointChange[] = [];
  if (snapshot.elements.length) out.push({ layer: "DESIGN", n: snapshot.elements.length });
  const infra = snapshot.infraNodes.length + snapshot.infraEdges.length;
  if (infra) out.push({ layer: "INFRA", n: infra });
  if (snapshot.infraFlows.length) out.push({ layer: "FLOW", n: snapshot.infraFlows.length });
  return out;
}

/** Stable, diff-friendly JSON: two-space indent, trailing newline. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Write via a temp file + rename so a concurrent reader never sees half a file. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}
