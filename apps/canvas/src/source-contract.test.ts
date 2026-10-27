import { describe, it, expect, beforeEach } from "vitest";
import { DesignElement, VersionEntry, diffBindings } from "forward-core";
import type { ApiBinding, SaveableElement } from "forward-core";
import type { CanvasSource, ElementSnapshot, InfraSnapshot } from "./source.js";

/**
 * A faithful in-memory `CanvasSource` that mirrors the CENTRAL SERVER's binding
 * rules (and the repo store, packages/shared/src/repo/store.ts): `saveElement` persists geometry/style but
 * NEVER a client-supplied binding (bind/unbind own it); `documentElement`
 * attaches the binding + appends a versioned diff; `undocumentElement` removes it
 * + records a "deleted" entry.
 *
 * It exists because the docs feature broke exactly when a mock diverged from the
 * real backend: a naive test double "returns whatever you pass", so the canvas's
 * (wrong) assumption that saveElement persists a binding looked fine in tests and
 * failed against the real server. Reproduce the real semantics here, and drive
 * canvas flows against THIS instead. The `describeBindingContract` suite below is
 * the executable contract — run it against the real `ServerSource` in CI to catch
 * the server drifting from it again.
 */
export class FakeServerSource implements CanvasSource {
  private readonly elements = new Map<string, DesignElement>();
  private readonly timelines = new Map<string, VersionEntry[]>();
  private readonly listeners = new Set<(s: ElementSnapshot[]) => void>();

  /** Preload an element (e.g. one documented earlier via the extension/MCP). */
  seed(element: DesignElement): void {
    this.elements.set(element.id, element);
    this.emit();
  }

  subscribe(onChange: (snaps: ElementSnapshot[]) => void): () => void {
    this.listeners.add(onChange);
    onChange(this.snapshot());
    return () => this.listeners.delete(onChange);
  }

  subscribeInfra(_onChange: (infra: InfraSnapshot) => void): () => void {
    return () => {};
  }

  async saveElement(element: SaveableElement): Promise<DesignElement> {
    // Mirror the server: ignore any binding on the payload and re-attach the
    // STORED one, so geometry saves never create or clobber documentation.
    const prior = this.elements.get(element.id);
    const next = DesignElement.parse({
      ...element,
      apiBinding: prior?.apiBinding,
      updatedAt: new Date().toISOString(),
    });
    this.elements.set(next.id, next);
    this.emit();
    return next;
  }

  async deleteElement(id: string): Promise<void> {
    this.elements.delete(id);
    this.timelines.delete(id);
    this.emit();
  }

  async documentElement(
    id: string,
    binding: ApiBinding,
    version: { version: string; changeLog: string; action: "created" | "modified" },
  ): Promise<void> {
    const current = this.elements.get(id);
    if (!current) throw new Error(`no element ${id}`);
    this.elements.set(id, {
      ...current,
      apiBinding: binding,
      updatedAt: new Date().toISOString(),
    });
    this.appendEntry(id, {
      version: version.version,
      changeLog: version.changeLog,
      action: version.action,
      diff: diffBindings(current.apiBinding, binding),
    });
    this.emit();
  }

  async undocumentElement(
    id: string,
    version: { version: string; changeLog: string; title?: string },
  ): Promise<void> {
    const current = this.elements.get(id);
    if (!current) throw new Error(`no element ${id}`);
    const { apiBinding, ...rest } = current;
    this.elements.set(id, { ...rest, updatedAt: new Date().toISOString() });
    this.appendEntry(id, {
      version: version.version,
      changeLog: version.changeLog,
      action: "deleted",
      diff: diffBindings(apiBinding, undefined),
    });
    this.emit();
  }

  private appendEntry(id: string, partial: Omit<VersionEntry, "author" | "timestamp">): void {
    const entry = VersionEntry.parse({ ...partial, author: "fake", timestamp: Date.now() });
    const list = this.timelines.get(id) ?? [];
    list.push(entry);
    this.timelines.set(id, list);
  }

  private snapshot(): ElementSnapshot[] {
    return [...this.elements.values()].map((element) => ({
      element,
      timeline: this.timelines.get(element.id) ?? [],
    }));
  }

  private emit(): void {
    const snaps = this.snapshot();
    for (const l of this.listeners) l(snaps);
  }
}

/**
 * The binding lifecycle every real `CanvasSource` MUST satisfy. Exported so the
 * same assertions can run against `ServerSource` (against a live server) in CI —
 * that's what would catch the backend changing this contract out from under the
 * canvas again.
 */
export function describeBindingContract(
  label: string,
  make: () => CanvasSource & { seed(el: DesignElement): void },
): void {
  describe(`CanvasSource binding contract — ${label}`, () => {
    let src: CanvasSource & { seed(el: DesignElement): void };
    let latest: ElementSnapshot[] = [];

    const el = (id: string): DesignElement =>
      DesignElement.parse({
        id,
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        updatedAt: new Date(0).toISOString(),
      });
    const bindingOf = (id: string): ApiBinding | undefined =>
      latest.find((s) => s.element.id === id)?.element.apiBinding;
    const timelineOf = (id: string): VersionEntry[] =>
      latest.find((s) => s.element.id === id)?.timeline ?? [];

    beforeEach(() => {
      src = make();
      src.seed(el("el1"));
      src.subscribe((s) => {
        latest = s;
      });
    });

    it("saveElement never persists a binding (the regression guard)", async () => {
      // Even if a caller casts past the SaveableElement type, the binding is dropped.
      await src.saveElement({
        ...el("el1"),
        apiBinding: { title: "sneaky", description: "should not land" },
      } as unknown as SaveableElement);
      expect(bindingOf("el1")).toBeUndefined();
      expect(timelineOf("el1")).toHaveLength(0); // and no version entry is created
    });

    it("documentElement persists the binding AND appends a versioned diff", async () => {
      await src.documentElement?.(
        "el1",
        { title: "Checkout", description: "POST /checkout" },
        { version: "v1", changeLog: "Documented API", action: "created" },
      );
      expect(bindingOf("el1")).toMatchObject({ title: "Checkout" });
      const tl = timelineOf("el1");
      expect(tl).toHaveLength(1);
      expect(tl[0]?.diff).toBeDefined(); // the History card's diff comes from here
    });

    it("a later geometry save keeps the committed binding intact", async () => {
      await src.documentElement?.(
        "el1",
        { title: "Checkout", description: "POST /checkout" },
        { version: "v1", changeLog: "Documented API", action: "created" },
      );
      await src.saveElement({ ...el("el1"), x: 99 } as SaveableElement);
      expect(bindingOf("el1")).toMatchObject({ title: "Checkout" });
    });

    it("undocumentElement removes the binding and records the deletion", async () => {
      await src.documentElement?.(
        "el1",
        { title: "Checkout", description: "d" },
        { version: "v1", changeLog: "Documented API", action: "created" },
      );
      await src.undocumentElement?.("el1", { version: "v2", changeLog: "Removed" });
      expect(bindingOf("el1")).toBeUndefined();
      expect(timelineOf("el1").at(-1)?.action).toBe("deleted");
    });
  });
}

describeBindingContract("FakeServerSource", () => new FakeServerSource());
