import { describe, it, expect } from "vitest";
import {
  ApiBinding,
  DesignElement,
  LONG_TEXT_MAX,
  SHORT_TEXT_MAX,
  compareStacking,
  descendantIds,
  paintOrder,
  withoutBinding,
} from "./schema.js";

describe("DesignElement contract", () => {
  it("accepts a plain shape with no API binding and applies defaults", () => {
    const el = DesignElement.parse({
      id: "el_btn_1",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.parentId).toBeNull();
    expect(el.name).toBe("");
    expect(el.apiBinding).toBeUndefined();
    expect(el.rotation).toBe(0);
    expect(el.z).toBe(0); // pre-`z` records parse with a stable default
  });

  it("keeps a non-zero rotation when supplied", () => {
    const el = DesignElement.parse({
      id: "el_btn_rot",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      rotation: 45,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.rotation).toBe(45);
  });

  it("accepts per-corner border radii alongside a uniform radius", () => {
    const el = DesignElement.parse({
      id: "el_card",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      style: { radius: 8, radii: { tl: 16, br: 0 } },
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.style?.radius).toBe(8);
    expect(el.style?.radii).toEqual({ tl: 16, br: 0 });
  });

  it("accepts per-side border widths and a stroke style", () => {
    const el = DesignElement.parse({
      id: "el_box",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      style: { strokeWidth: 1, strokeWidths: { top: 4, bottom: 0 }, strokeStyle: "dashed" },
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.style?.strokeWidths).toEqual({ top: 4, bottom: 0 });
    expect(el.style?.strokeStyle).toBe("dashed");
  });

  it("rejects an unknown stroke style", () => {
    expect(() =>
      DesignElement.parse({
        id: "el_bad_style",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        style: { strokeStyle: "wavy" },
        updatedAt: "2026-05-28T11:45:00Z",
      }),
    ).toThrow();
  });

  it("rejects a negative corner radius", () => {
    expect(() =>
      DesignElement.parse({
        id: "el_bad",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        style: { radii: { tl: -4 } },
        updatedAt: "2026-05-28T11:45:00Z",
      }),
    ).toThrow();
  });

  it("accepts an element carrying an optional apiBinding", () => {
    const el = DesignElement.parse({
      id: "el_login_card",
      type: "frame",
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      apiBinding: {
        title: "Log in",
        description: "Body: email, password.",
      },
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.apiBinding?.title).toBe("Log in");
    expect(el.apiBinding?.description).toBe("Body: email, password.");
  });

  it("defaults the binding description to an empty string", () => {
    const el = DesignElement.parse({
      id: "el_resolver",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      apiBinding: { title: "createOrder mutation" },
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.apiBinding?.title).toBe("createOrder mutation");
    expect(el.apiBinding?.description).toBe("");
  });

  it("records hierarchy via parentId and component links", () => {
    const instance = DesignElement.parse({
      id: "el_inst_1",
      type: "instance",
      parentId: "el_frame_1",
      componentId: "el_comp_button",
      x: 5,
      y: 5,
      width: 100,
      height: 32,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(instance.parentId).toBe("el_frame_1");
    expect(instance.componentId).toBe("el_comp_button");
  });

  it("accepts an ellipse shape", () => {
    const el = DesignElement.parse({
      id: "el_avatar",
      type: "ellipse",
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      updatedAt: "2026-05-28T11:45:00Z",
    });
    expect(el.type).toBe("ellipse");
  });

  it("rejects an unknown element type", () => {
    expect(() =>
      DesignElement.parse({
        id: "x",
        type: "circle",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        updatedAt: "2026-05-28T11:45:00Z",
      }),
    ).toThrow();
  });
});

describe("stacking order (compareStacking + paintOrder)", () => {
  const el = (part: Partial<DesignElement> & { id: string }): DesignElement =>
    DesignElement.parse({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      updatedAt: "2026-05-28T11:45:00Z",
      ...part,
    });

  it("orders same-parent siblings by z (low first = painted underneath)", () => {
    const out = paintOrder([
      el({ id: "top", z: 5 }),
      el({ id: "bottom", z: 1 }),
      el({ id: "mid", z: 3 }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["bottom", "mid", "top"]);
  });

  it("keeps each subtree contiguous, parent before its children (DFS pre-order)", () => {
    const out = paintOrder([
      el({ id: "childB", parentId: "frame", z: 2 }),
      el({ id: "frame", type: "frame", z: 1 }),
      el({ id: "childA", parentId: "frame", z: 1 }),
      el({ id: "sibling", z: 0 }),
    ]);
    // `sibling` (z=0) paints first; then the frame and, immediately after, its
    // children in z order — never interleaved with anything outside the subtree.
    expect(out.map((e) => e.id)).toEqual(["sibling", "frame", "childA", "childB"]);
  });

  it("breaks a z tie with text-last so a label is never hidden by an equal-z fill", () => {
    // Both top-level, same z (e.g. legacy z=0 data): the text must paint last.
    expect(compareStacking(el({ id: "fill" }), el({ id: "label", type: "text" }))).toBeLessThan(0);
    const out = paintOrder([
      el({ id: "label", type: "text", z: 0 }),
      el({ id: "fill", z: 0 }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["fill", "label"]);
  });

  it("treats an element whose parent is absent as a root (never dropped)", () => {
    const out = paintOrder([el({ id: "orphan", parentId: "ghost", z: 0 })]);
    expect(out.map((e) => e.id)).toEqual(["orphan"]);
  });

  it("withoutBinding strips apiBinding so an element can go through saveElement", () => {
    const bound = el({
      id: "documented",
      apiBinding: { title: "Checkout", description: "POST /checkout" },
    });
    expect(bound.apiBinding).toBeDefined(); // precondition
    const saveable = withoutBinding(bound);
    expect("apiBinding" in saveable).toBe(false); // the property is gone, not undefined
    // Everything else is preserved verbatim.
    expect(saveable).toEqual(
      expect.objectContaining({ id: "documented", type: "rectangle", z: 0 }),
    );
  });

  it("surfaces every element even under a parentId cycle", () => {
    const out = paintOrder([
      el({ id: "a", parentId: "b" }),
      el({ id: "b", parentId: "a" }),
    ]);
    expect(new Set(out.map((e) => e.id))).toEqual(new Set(["a", "b"]));
  });

  it("descendantIds walks the whole parentId subtree, excluding the root", () => {
    const tree = [
      el({ id: "frame" }),
      el({ id: "a", parentId: "frame" }),
      el({ id: "b", parentId: "frame" }),
      el({ id: "a1", parentId: "a" }),
      el({ id: "orphan" }),
    ];
    expect(descendantIds("frame", tree).sort()).toEqual(["a", "a1", "b"]);
  });

  it("descendantIds returns [] for a leaf", () => {
    expect(descendantIds("x", [el({ id: "x" }), el({ id: "y" })])).toEqual([]);
  });
});

describe("string bounds", () => {
  const base = {
    id: "el1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    updatedAt: "2026-06-22T10:00:00.000Z",
  };

  it("accepts values at the bound and keeps existing-size data parsing", () => {
    const el = DesignElement.parse({
      ...base,
      name: "n".repeat(SHORT_TEXT_MAX),
    });
    expect(el.name).toHaveLength(SHORT_TEXT_MAX);
  });

  it("rejects a name over SHORT_TEXT_MAX", () => {
    const r = DesignElement.safeParse({
      ...base,
      name: "n".repeat(SHORT_TEXT_MAX + 1),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a Markdown description over LONG_TEXT_MAX", () => {
    const r = ApiBinding.safeParse({
      title: "Login",
      description: "d".repeat(LONG_TEXT_MAX + 1),
    });
    expect(r.success).toBe(false);
  });

  it("allows long-form Markdown well past a name's bound", () => {
    const r = ApiBinding.safeParse({
      title: "Login",
      description: "d".repeat(SHORT_TEXT_MAX * 10),
    });
    expect(r.success).toBe(true);
  });
});

describe("DesignElement origin", () => {
  const base = { id: "el_1", type: "rectangle", x: 0, y: 0, width: 1, height: 1, updatedAt: "2026-05-28T11:45:00Z" };
  it("is optional, so records written before it still parse", () => {
    expect(DesignElement.parse(base).origin).toBeUndefined();
  });
  it("parses provenance from a code import and rejects unknown kinds", () => {
    const origin = { kind: "code", route: "/login", viewport: "1440x900", key: "tid:submit", hash: "abc", importedAt: "2026-05-28T11:45:00Z" };
    expect(DesignElement.parse({ ...base, origin }).origin).toEqual(origin);
    expect(() => DesignElement.parse({ ...base, origin: { ...origin, kind: "figma" } })).toThrow();
  });
});
