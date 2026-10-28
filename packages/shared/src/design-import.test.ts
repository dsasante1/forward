import { describe, expect, it } from "vitest";
import {
  CaptureSnapshot,
  designHash,
  importedElementId,
  mapSnapshot,
  parseColor,
  placeSnapshots,
  type CaptureNode,
  type ImportedElement,
} from "./design-import.js";
import { DesignElement } from "./schema.js";

const box = (
  tag: string,
  rect: [number, number, number, number],
  extra: Partial<CaptureNode> = {},
): CaptureNode => ({
  tag,
  rect: { x: rect[0], y: rect[1], w: rect[2], h: rect[3] },
  ...extra,
});

const snap = (children: CaptureNode[], extra: Partial<CaptureSnapshot> = {}): CaptureSnapshot =>
  CaptureSnapshot.parse({
    version: 1,
    route: "/login",
    viewport: { width: 1440, height: 900 },
    root: box("body", [0, 0, 1440, 900], { children }),
    ...extra,
  });

const byName = (els: ImportedElement[], name: string) => els.find((e) => e.name === name);

describe("mapSnapshot", () => {
  it("maps an empty page to just its frame", () => {
    const { elements, frameId } = mapSnapshot(snap([]), { x: 100, y: 50 });
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      id: frameId,
      type: "frame",
      x: 100,
      y: 50,
      width: 1440,
      height: 900,
      parentId: null,
    });
    expect(elements[0]?.origin).toEqual({
      kind: "code",
      route: "/login",
      viewport: "1440x900",
      key: "page",
    });
  });

  it("drops wrappers that paint nothing and attaches their children to the nearest kept box", () => {
    const { elements, frameId } = mapSnapshot(
      snap([
        box("div", [0, 0, 1440, 900], {
          children: [
            box("div", [100, 100, 400, 300], {
              style: { background: "rgb(255, 255, 255)", borderTopLeftRadius: "8px", borderTopRightRadius: "8px", borderBottomRightRadius: "8px", borderBottomLeftRadius: "8px" },
              attrs: { testid: "login-card" },
              children: [
                box("div", [120, 120, 360, 40], {
                  children: [
                    box("button", [120, 200, 120, 40], {
                      style: { background: "rgb(37, 99, 235)", color: "rgb(255, 255, 255)", fontSize: "14px", fontWeight: "600" },
                      text: "Sign in",
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ]),
      { x: 0, y: 0 },
    );
    // Only the page frame, the card and the button survive; both wrappers are gone.
    expect(elements.map((e) => e.type)).toEqual(["frame", "frame", "rectangle"]);
    const card = byName(elements, "login card");
    expect(card).toMatchObject({ type: "frame", parentId: frameId, x: 100, y: 100, width: 400, height: 300 });
    expect(card?.style).toMatchObject({ fill: "#ffffff", radius: 8, strokeWidth: 0 });
    const button = byName(elements, "Sign in");
    expect(button).toMatchObject({ type: "rectangle", parentId: card?.id, text: "Sign in" });
    expect(button?.style).toMatchObject({ fill: "#2563eb", color: "#ffffff", fontSize: 14, fontWeight: 600 });
  });

  it("emits text that sits in a non-painting element as a text element", () => {
    const { elements, frameId } = mapSnapshot(
      snap([
        box("h1", [40, 40, 600, 48], {
          text: "Welcome back",
          textRect: { x: 40, y: 44, w: 280, h: 40 },
          style: { color: "rgba(17, 24, 39, 0.5)", fontSize: "32px", fontWeight: "bold", fontFamily: '"Inter", sans-serif' },
        }),
      ]),
      { x: 0, y: 0 },
    );
    const t = elements.find((e) => e.type === "text");
    expect(t).toMatchObject({ text: "Welcome back", parentId: frameId, x: 40, y: 44, width: 280, height: 40 });
    expect(t?.style).toEqual({ fontSize: 32, fontWeight: 700, fontFamily: "Inter", color: "#11182780" });
  });

  it("maps circles to ellipses and uneven borders and corners to per-side overrides", () => {
    const { elements } = mapSnapshot(
      snap([
        box("span", [10, 10, 32, 32], {
          attrs: { label: "avatar" },
          style: { background: "#ccc", borderTopLeftRadius: "50%", borderTopRightRadius: "50%", borderBottomRightRadius: "50%", borderBottomLeftRadius: "50%" },
        }),
        box("div", [100, 10, 200, 40], {
          attrs: { label: "tab" },
          style: {
            borderBottomWidth: "2px",
            borderBottomStyle: "dashed",
            borderBottomColor: "rgb(0, 0, 0)",
            borderTopLeftRadius: "6px",
            borderTopRightRadius: "6px",
            borderBottomRightRadius: "0px",
            borderBottomLeftRadius: "0px",
          },
        }),
      ]),
      { x: 0, y: 0 },
    );
    expect(byName(elements, "avatar")?.type).toBe("ellipse");
    expect(byName(elements, "avatar")?.style?.radius).toBeUndefined();
    expect(byName(elements, "tab")?.style).toMatchObject({
      stroke: "#000000",
      strokeStyle: "dashed",
      strokeWidth: 0,
      strokeWidths: { top: 0, right: 0, bottom: 2, left: 0 },
      radii: { tl: 6, tr: 6, br: 0, bl: 0 },
    });
  });

  it("skips hidden, transparent and zero-size nodes but keeps visible descendants of a hidden box", () => {
    const { elements } = mapSnapshot(
      snap([
        box("div", [0, 0, 100, 100], { style: { display: "none", background: "red" }, children: [box("p", [0, 0, 10, 10], { text: "gone" })] }),
        box("div", [0, 0, 100, 100], { style: { opacity: "0", background: "red" } }),
        box("div", [0, 0, 0, 0], { style: { background: "red" } }),
        box("div", [0, 0, 100, 100], {
          style: { visibility: "hidden", background: "red" },
          children: [box("p", [5, 5, 50, 20], { text: "shown", style: { visibility: "visible" } })],
        }),
      ]),
      { x: 0, y: 0 },
    );
    expect(elements.map((e) => e.type)).toEqual(["frame", "text"]);
    expect(elements[1]?.text).toBe("shown");
  });

  it("gives repeated keys unique, deterministic ids", () => {
    const twice = () =>
      mapSnapshot(
        snap([
          box("div", [0, 0, 10, 10], { attrs: { testid: "row" }, style: { background: "red" } }),
          box("div", [0, 20, 10, 10], { attrs: { testid: "row" }, style: { background: "red" } }),
        ]),
        { x: 0, y: 0 },
      ).elements.map((e) => e.id);
    const ids = twice();
    expect(new Set(ids).size).toBe(ids.length);
    expect(twice()).toEqual(ids);
    expect(ids[1]).toBe(importedElementId("/login", "1440x900", "tid:row"));
  });

  it("orders siblings by positioned z-index, then document order", () => {
    const { elements } = mapSnapshot(
      snap([
        box("div", [0, 0, 10, 10], { attrs: { label: "modal" }, style: { background: "red", position: "fixed", zIndex: "50" } }),
        box("div", [0, 0, 10, 10], { attrs: { label: "first" }, style: { background: "red" } }),
        box("div", [0, 0, 10, 10], { attrs: { label: "second" }, style: { background: "red", zIndex: "99" } }),
      ]),
      { x: 0, y: 0 },
    );
    // `second` has z-index but is static, so it doesn't stack above.
    expect(byName(elements, "first")?.z).toBe(1);
    expect(byName(elements, "second")?.z).toBe(2);
    expect(byName(elements, "modal")?.z).toBe(3);
  });

  it("recovers the real box of a rotated element", () => {
    const { elements } = mapSnapshot(
      snap([
        box("div", [0, 0, 100, 100], { size: { w: 80, h: 20 }, rotation: 45, attrs: { label: "r" }, style: { background: "red" } }),
      ]),
      { x: 0, y: 0 },
    );
    expect(byName(elements, "r")).toMatchObject({ x: 10, y: 40, width: 80, height: 20, rotation: 45 });
  });

  it("turns repeated components into a master and instances", () => {
    const card = (y: number, title: string) =>
      box("article", [0, y, 300, 100], {
        component: "ProductCard",
        componentRoot: true,
        source: "src/ProductCard.tsx:12",
        style: { background: "#fff" },
        children: [box("h3", [10, y + 10, 200, 20], { text: title, component: "ProductCard" })],
      });
    const { elements } = mapSnapshot(snap([card(0, "One"), card(120, "Two"), card(240, "Three")]), { x: 0, y: 0 });
    const master = elements.find((e) => e.type === "component");
    const instances = elements.filter((e) => e.type === "instance");
    expect(master?.name).toBe("ProductCard");
    expect(master?.origin).toMatchObject({ component: "ProductCard", source: "src/ProductCard.tsx:12" });
    expect(instances).toHaveLength(2);
    expect(instances.every((i) => i.componentId === master?.id)).toBe(true);
    // Instances keep their own content.
    expect(elements.filter((e) => e.type === "text").map((e) => e.text)).toEqual(["One", "Two", "Three"]);
    // Off by request.
    const plain = mapSnapshot(snap([card(0, "One"), card(120, "Two")]), { x: 0, y: 0, detectComponents: false });
    expect(plain.elements.some((e) => e.type === "component" || e.type === "instance")).toBe(false);
  });

  it("produces elements the schema accepts", () => {
    const { elements } = mapSnapshot(
      snap([box("img", [0, 0, 64, 64], { attrs: { alt: "Logo" } }), box("input", [0, 80, 200, 32], { text: "Email", attrs: { placeholder: "Email" } })]),
      { x: 0, y: 0 },
    );
    for (const el of elements) {
      expect(() =>
        DesignElement.parse({ ...el, origin: { ...el.origin, hash: "h", importedAt: "2026-01-01T00:00:00.000Z" }, updatedAt: "2026-01-01T00:00:00.000Z" }),
      ).not.toThrow();
    }
    expect(byName(elements, "image: Logo")?.style?.fill).toBe("#e5e7eb");
    expect(byName(elements, "Email")).toMatchObject({ type: "rectangle", text: "Email" });
  });
});

describe("element names", () => {
  it("are one line, whatever the page's attributes hold", () => {
    const { elements } = mapSnapshot(
      snap([box("img", [0, 0, 10, 10], { attrs: { alt: "Bob\u2028;evil()\u2029\nx" } })]),
      { x: 0, y: 0 },
    );
    expect(elements[1]?.name).toBe("image: Bob ;evil() x");
  });
});

describe("designHash", () => {
  const base = { type: "rectangle" as const, name: "a", x: 0, y: 0, width: 10, height: 10, parentId: null, z: 1, rotation: 0 };
  it("hashes position relative to the page frame", () => {
    expect(designHash({ ...base, x: 310, y: 50 }, { x: 300, y: 40 })).toBe(designHash({ ...base, x: 10, y: 10 }));
  });
  it("rounds away float noise in the offset", () => {
    expect(designHash({ ...base, x: 100.5 + 29.999999999999996 }, { x: 100.5, y: 0 })).toBe(designHash({ ...base, x: 30 }));
  });
  it("ignores key order and undefined fields but sees every design change", () => {
    expect(designHash({ ...base, style: { fill: "#fff", radius: 2 } })).toBe(
      designHash({ ...base, text: undefined, style: { radius: 2, fill: "#fff" } }),
    );
    for (const change of [{ x: 1 }, { name: "b" }, { z: 2 }, { style: { fill: "#000" } }, { text: "t" }, { parentId: "p" }]) {
      expect(designHash({ ...base, ...change })).not.toBe(designHash(base));
    }
  });
});

describe("parseColor", () => {
  it("reads the forms browsers serialise to", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("oklch(0.6 0.1 200)")).toBeNull();
  });
});

describe("page offsets", () => {
  it("keep a page's fractional position exactly and whole-pixel offsets inside it", () => {
    const { elements } = mapSnapshot(
      snap([box("div", [30.4, 10.6, 10, 10], { attrs: { label: "b" }, style: { background: "red" } })]),
      { x: 100.5, y: 7.25 },
    );
    expect(elements[0]).toMatchObject({ x: 100.5, y: 7.25 });
    expect(byName(elements, "b")).toMatchObject({ x: 130.5, y: 18.25 });
  });
});

describe("placeSnapshots", () => {
  it("keeps an imported page where it is and puts new pages to the right of everything", () => {
    const s1 = snap([]);
    const s2 = snap([], { route: "/settings" });
    const frameId = importedElementId("/login", "1440x900", "page");
    const existing = [
      { id: frameId, type: "frame", name: "", x: 500, y: 300, width: 1440, height: 900, parentId: null, z: 0, rotation: 0, updatedAt: "2026-01-01T00:00:00.000Z" },
    ] as DesignElement[];
    expect(placeSnapshots([s1, s2], existing)).toEqual([
      { x: 500, y: 300 },
      { x: 500 + 1440 + 200, y: 0 },
    ]);
  });
});
