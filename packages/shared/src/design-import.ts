import { z } from "zod";
import {
  LONG_TEXT_MAX,
  SHORT_TEXT_MAX,
  type DesignElement,
  type ElementOrigin,
  type ElementType,
  type Style,
} from "./schema.js";

/**
 * Generate design elements from a running frontend.
 *
 * Ideally the frontend is built from the design, but a team often has screens
 * that were never drawn. A browser already knows exactly where everything is —
 * CSS layout (flexbox, grid, media queries, fonts) can't be worked out from the
 * source alone — so a small collector script runs in the page and records what
 * it renders as a {@link CaptureSnapshot}. This module turns that snapshot into
 * plain {@link DesignElement}s: one frame per route, a rectangle/ellipse for
 * every box that paints something, text for every run of text. Wrappers that
 * draw nothing are dropped, so the layer tree stays something a designer can
 * read.
 *
 * Everything here is pure and browser-safe. Writing the result is the store's
 * job (`RepoStore.importDesign`), which is where the "never overwrite what a
 * person changed" rule lives.
 */

// --------------------------------------------------------------------------
// Snapshot format (what the collector script produces)
// --------------------------------------------------------------------------

/** Snapshot format version written by the collector. */
export const SNAPSHOT_VERSION = 1;

const CaptureRect = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

/** The computed-style subset the mapper reads; every value is a CSS string. */
export const CaptureStyle = z
  .object({
    display: z.string(),
    visibility: z.string(),
    opacity: z.string(),
    position: z.string(),
    zIndex: z.string(),
    background: z.string(),
    backgroundImage: z.string(),
    boxShadow: z.string(),
    color: z.string(),
    fontSize: z.string(),
    fontWeight: z.string(),
    fontFamily: z.string(),
    borderTopWidth: z.string(),
    borderRightWidth: z.string(),
    borderBottomWidth: z.string(),
    borderLeftWidth: z.string(),
    borderTopStyle: z.string(),
    borderRightStyle: z.string(),
    borderBottomStyle: z.string(),
    borderLeftStyle: z.string(),
    borderTopColor: z.string(),
    borderRightColor: z.string(),
    borderBottomColor: z.string(),
    borderLeftColor: z.string(),
    borderTopLeftRadius: z.string(),
    borderTopRightRadius: z.string(),
    borderBottomRightRadius: z.string(),
    borderBottomLeftRadius: z.string(),
  })
  .partial();
export type CaptureStyle = z.infer<typeof CaptureStyle>;

/** Attributes that make good names and stable keys. */
const CaptureAttrs = z
  .object({
    testid: z.string().max(SHORT_TEXT_MAX),
    id: z.string().max(SHORT_TEXT_MAX),
    label: z.string().max(SHORT_TEXT_MAX),
    alt: z.string().max(SHORT_TEXT_MAX),
    role: z.string().max(SHORT_TEXT_MAX),
    placeholder: z.string().max(SHORT_TEXT_MAX),
  })
  .partial();

export interface CaptureNode {
  /** Lower-case tag name. */
  tag: string;
  /** Border box in document coordinates (already includes scroll). */
  rect: z.infer<typeof CaptureRect>;
  /** Untransformed size, present when the element is rotated. */
  size?: { w: number; h: number };
  /** Clockwise rotation in degrees from the element's transform. */
  rotation?: number;
  style?: CaptureStyle;
  /** The element's own text (direct text nodes, whitespace collapsed). */
  text?: string;
  /** Bounding box of that text, in document coordinates. */
  textRect?: z.infer<typeof CaptureRect>;
  attrs?: z.infer<typeof CaptureAttrs>;
  /** Nearest frontend component that rendered this node (React dev builds). */
  component?: string;
  /** Source location of that component, e.g. "src/Login.tsx:42". */
  source?: string;
  /** True when this node is the outermost DOM node of its component. */
  componentRoot?: boolean;
  children?: CaptureNode[];
}

export const CaptureNode: z.ZodType<CaptureNode> = z.lazy(() =>
  z.object({
    tag: z.string().min(1).max(64),
    rect: CaptureRect,
    size: z.object({ w: z.number(), h: z.number() }).optional(),
    rotation: z.number().optional(),
    style: CaptureStyle.optional(),
    text: z.string().max(LONG_TEXT_MAX).optional(),
    textRect: CaptureRect.optional(),
    attrs: CaptureAttrs.optional(),
    component: z.string().max(SHORT_TEXT_MAX).optional(),
    source: z.string().max(SHORT_TEXT_MAX).optional(),
    componentRoot: z.boolean().optional(),
    children: z.array(CaptureNode).optional(),
  }),
);

/** One captured page: a route at one viewport size. */
export const CaptureSnapshot = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  url: z.string().max(SHORT_TEXT_MAX).optional(),
  /** Route path the page was captured at, e.g. "/login". */
  route: z.string().min(1).max(SHORT_TEXT_MAX),
  viewport: z.object({ width: z.number().positive(), height: z.number().positive() }),
  /** Background colour the page paints (body, falling back to html). */
  pageBackground: z.string().max(SHORT_TEXT_MAX).optional(),
  capturedAt: z.string().max(SHORT_TEXT_MAX).optional(),
  /** The collector stopped at its node limit; the page is only partly captured. */
  truncated: z.boolean().optional(),
  /** HTTP status of the page load (live capture only). */
  status: z.number().int().optional(),
  /** The `<body>` element. */
  root: CaptureNode,
});
export type CaptureSnapshot = z.infer<typeof CaptureSnapshot>;

// --------------------------------------------------------------------------
// Hashing and ids
// --------------------------------------------------------------------------

/** cyrb53: a fast, well-mixed 53-bit string hash. Not for security. */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** JSON with sorted keys and `undefined` dropped, so equal values hash equal. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** The fields a person edits on the canvas; the design hash covers exactly these. */
type DesignFields = Pick<
  DesignElement,
  "type" | "name" | "x" | "y" | "width" | "height" | "parentId" | "z" | "rotation"
> &
  Partial<Pick<DesignElement, "text" | "style" | "componentId">>;

/**
 * Hash of an element's design: geometry, hierarchy, stacking, text and style.
 * Identity, timestamps, API docs and provenance are deliberately left out, so
 * documenting an imported element (or re-stamping it) is not "an edit", while
 * moving, restyling or renaming it is.
 *
 * Position is hashed relative to `origin` — for an imported element, the
 * top-left of its page frame — so dragging a whole page (frame plus contents)
 * somewhere else on the canvas is not an edit of every element on it.
 */
export function designHash(el: DesignFields, origin: { x: number; y: number } = { x: 0, y: 0 }): string {
  return cyrb53(
    stableJson({
      type: el.type,
      name: el.name,
      // Rounded: a canvas drag at any zoom leaves float noise (99.99999999999999)
      // in positions that are, to a person, unchanged.
      x: Math.round((el.x - origin.x) * 100) / 100,
      y: Math.round((el.y - origin.y) * 100) / 100,
      width: el.width,
      height: el.height,
      parentId: el.parentId ?? null,
      z: el.z ?? 0,
      rotation: el.rotation ?? 0,
      text: el.text,
      style: el.style,
      componentId: el.componentId,
    }),
  );
}

/**
 * Deterministic element id for a captured node: the same route, viewport and
 * key always give the same id, so re-importing updates elements in place
 * instead of piling up duplicates.
 */
export function importedElementId(route: string, viewport: string, key: string): string {
  return `el_${cyrb53(`${route}\u0000${viewport}\u0000${key}`)}`;
}

/** Id of the page frame an imported element belongs to (see {@link mapSnapshot}). */
export function pageFrameId(origin: Pick<ElementOrigin, "route" | "viewport">): string {
  return importedElementId(origin.route, origin.viewport ?? "", "page");
}

// --------------------------------------------------------------------------
// CSS value parsing
// --------------------------------------------------------------------------

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse the colour forms a browser serialises computed colours to. */
export function parseColor(input: string | undefined): Rgba | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent" || s === "none" || s === "") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    const full =
      hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    const channel = (v: string | undefined) =>
      v === undefined ? 0 : v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v);
    const alpha = parts[3];
    const a =
      alpha === undefined ? 1 : alpha.endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha);
    const [r, g, b] = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a };
  }
  return null;
}

/** `#rrggbb`, or `#rrggbbaa` when translucent; unknown syntax passes through. */
function toHex(input: string | undefined): string | undefined {
  const c = parseColor(input);
  if (!c) return input && input.length <= SHORT_TEXT_MAX ? input : undefined;
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a * 255) : ""}`;
}

/** A colour that actually paints something (known syntax with alpha > 0, or unknown syntax). */
function paints(color: string | undefined): boolean {
  if (!color) return false;
  const c = parseColor(color);
  return c ? c.a > 0 : true;
}

function px(value: string | undefined): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** First length of a (possibly elliptical) radius, resolved against `basis` for %. */
function radiusPx(value: string | undefined, basis: number): number {
  const first = (value ?? "").trim().split(/\s+/)[0] ?? "";
  if (first.endsWith("%")) return (parseFloat(first) / 100) * basis;
  return px(first);
}

function isPercentHalf(value: string | undefined): boolean {
  const first = (value ?? "").trim().split(/\s+/)[0] ?? "";
  return first.endsWith("%") && parseFloat(first) >= 50;
}

const round = (v: number) => Math.round(v);

// --------------------------------------------------------------------------
// Mapping
// --------------------------------------------------------------------------

/** An element ready for `RepoStore.importDesign` (the backend stamps hash + time). */
export type ImportedElement = Omit<DesignElement, "apiBinding" | "origin" | "updatedAt"> & {
  origin: Omit<ElementOrigin, "hash" | "importedAt">;
};

export interface MapOptions {
  /** Canvas position of the page frame's top-left corner. */
  x: number;
  y: number;
  /** Turn repeated frontend components into a component + instances (default true). */
  detectComponents?: boolean;
}

export interface MapResult {
  /** The page frame first, then its contents in paint order. */
  elements: ImportedElement[];
  /** The page frame's id. */
  frameId: string;
  /** `"<width>x<height>"`, the viewport part of every origin. */
  viewport: string;
}

/** Elements that paint content of their own even with no background or border. */
const REPLACED = new Set([
  "img", "svg", "video", "canvas", "iframe", "picture", "input", "textarea", "select", "hr",
]);

/** Elements whose captured box is not worth a layer. */
const SKIP = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "br"]);

function borderSides(s: CaptureStyle) {
  const side = (w?: string, st?: string, c?: string) => {
    const width = px(w);
    const visible = width > 0 && st !== "none" && st !== "hidden" && paints(c);
    return { width: visible ? width : 0, style: st, color: c };
  };
  return {
    top: side(s.borderTopWidth, s.borderTopStyle, s.borderTopColor),
    right: side(s.borderRightWidth, s.borderRightStyle, s.borderRightColor),
    bottom: side(s.borderBottomWidth, s.borderBottomStyle, s.borderBottomColor),
    left: side(s.borderLeftWidth, s.borderLeftStyle, s.borderLeftColor),
  };
}

/** Whether the node paints a box of its own (fill, border, shadow, image or replaced content). */
function paintsBox(node: CaptureNode): boolean {
  const s = node.style ?? {};
  if (s.visibility === "hidden" || s.visibility === "collapse") return false;
  if (REPLACED.has(node.tag)) return true;
  if (paints(s.background)) return true;
  if (s.backgroundImage && s.backgroundImage !== "none") return true;
  if (s.boxShadow && s.boxShadow !== "none") return true;
  const b = borderSides(s);
  return [b.top, b.right, b.bottom, b.left].some((side) => side.width > 0);
}

function fontStyle(s: CaptureStyle): Style {
  const out: Style = {};
  const size = px(s.fontSize);
  if (size > 0) out.fontSize = size;
  const weight =
    s.fontWeight === "bold" ? 700 : s.fontWeight === "normal" ? 400 : parseInt(s.fontWeight ?? "", 10);
  if (Number.isFinite(weight)) out.fontWeight = weight;
  const family = s.fontFamily?.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  if (family) out.fontFamily = family.slice(0, SHORT_TEXT_MAX);
  const color = toHex(s.color);
  if (color) out.color = color;
  return out;
}

/** Box styling (fill, border, corners) plus the type it implies (ellipse vs rectangle). */
function boxStyle(
  node: CaptureNode,
  width: number,
  height: number,
): { style: Style; ellipse: boolean } {
  const s = node.style ?? {};
  const style: Style = {};
  if (paints(s.background)) style.fill = toHex(s.background);
  else if (REPLACED.has(node.tag) && node.tag !== "hr") style.fill = "#e5e7eb";

  const b = borderSides(s);
  const sides = [b.top, b.right, b.bottom, b.left];
  const visible = sides.filter((side) => side.width > 0);
  if (visible.length > 0) {
    style.stroke = toHex(visible[0]!.color);
    const dashed = visible[0]!.style;
    if (dashed === "dashed" || dashed === "dotted") style.strokeStyle = dashed;
    const uniform = visible.length === 4 && sides.every((side) => side.width === b.top.width);
    if (uniform) style.strokeWidth = b.top.width;
    else {
      style.strokeWidth = 0;
      style.strokeWidths = {
        top: b.top.width,
        right: b.right.width,
        bottom: b.bottom.width,
        left: b.left.width,
      };
    }
  } else if (style.fill) {
    // The canvas draws a default outline when stroke is unset; a borderless box has none.
    style.strokeWidth = 0;
  }

  const minSide = Math.min(width, height);
  const raw = [
    s.borderTopLeftRadius,
    s.borderTopRightRadius,
    s.borderBottomRightRadius,
    s.borderBottomLeftRadius,
  ];
  const ellipse =
    minSide > 0 &&
    (raw.every(isPercentHalf) ||
      (Math.abs(width - height) <= 1 && raw.every((r) => radiusPx(r, minSide) >= minSide / 2 - 0.5)));
  if (!ellipse) {
    const [tl, tr, br, bl] = raw.map((r) => round(Math.min(radiusPx(r, minSide), minSide / 2)));
    if (tl === tr && tr === br && br === bl) {
      if (tl! > 0) style.radius = tl;
    } else {
      style.radii = { tl: tl!, tr: tr!, br: br!, bl: bl! };
    }
  }
  return { style, ellipse };
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** One line of display text: control characters and line/paragraph separators become spaces. */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
}

function shortText(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function nameFor(node: CaptureNode): string {
  const a = node.attrs ?? {};
  if (node.tag === "img") return oneLine(`image: ${a.alt || a.label || "image"}`).slice(0, SHORT_TEXT_MAX);
  if (node.tag === "svg") return a.label ? oneLine(`icon: ${a.label}`).slice(0, SHORT_TEXT_MAX) : "icon";
  const label =
    (a.testid && humanize(a.testid)) ||
    a.label ||
    a.placeholder ||
    (node.componentRoot && node.component) ||
    (node.text && shortText(node.text)) ||
    (a.id && humanize(a.id)) ||
    a.role ||
    node.tag;
  return oneLine(label).slice(0, SHORT_TEXT_MAX);
}

/**
 * The most stable identity a node offers, best first: a test id, an HTML id,
 * the JSX line that rendered it (React dev builds; repo-relative), or — for a
 * leaf — its accessible label. `undefined` falls back to the node's position
 * under its nearest keyed ancestor. Repeats are numbered `~2`, `~3` in page
 * order; RepoStore.importDesign re-matches drafts whose key shifted anyway.
 */
function stableKey(node: CaptureNode): string | undefined {
  const a = node.attrs ?? {};
  if (a.testid) return `tid:${a.testid}`;
  if (a.id) return `#${a.id}`;
  if (node.source) return `src:${node.source}`;
  if (a.label && !node.children?.length) return `${node.tag}@label:${a.label}`;
  return undefined;
}

/** Effective stacking value: z-index applies only to positioned elements. */
function stackOf(node: CaptureNode, inherited: number): number {
  const s = node.style ?? {};
  if (!s.position || s.position === "static") return inherited;
  const z = parseInt(s.zIndex ?? "", 10);
  return Number.isFinite(z) ? z : inherited;
}

/**
 * Map one captured page to design elements. The page becomes a frame at
 * (`x`, `y`); every node that paints a box becomes a rectangle or ellipse — or
 * a frame, when other elements nest inside it, since only frames hold children
 * on the canvas — and every run of text becomes a text element (or the label
 * of the box it sits alone in). Nodes that paint nothing are dropped and their
 * children attach to the nearest kept ancestor.
 */
export function mapSnapshot(snapshot: CaptureSnapshot, opts: MapOptions): MapResult {
  const { route } = snapshot;
  const viewport = `${round(snapshot.viewport.width)}x${round(snapshot.viewport.height)}`;
  const idOf = (key: string) => importedElementId(route, viewport, key);
  const used = new Set<string>();
  const uniqueKey = (key: string) => {
    let k = key.slice(0, SHORT_TEXT_MAX - 8);
    for (let n = 2; used.has(k); n++) k = `${key.slice(0, SHORT_TEXT_MAX - 8)}~${n}`;
    used.add(k);
    return k;
  };

  const frameKey = uniqueKey("page");
  const frameId = idOf(frameKey);
  const pageHeight = Math.max(snapshot.viewport.height, snapshot.root.rect.y + snapshot.root.rect.h);
  const pageFill = toHex(snapshot.pageBackground) ?? "#ffffff";
  const frame: ImportedElement = {
    id: frameId,
    type: "frame",
    name: `${route} · ${viewport}`.slice(0, SHORT_TEXT_MAX),
    x: opts.x,
    y: opts.y,
    width: round(snapshot.viewport.width),
    height: round(pageHeight),
    parentId: null,
    z: 0,
    rotation: 0,
    style: { fill: paints(pageFill) ? pageFill : "#ffffff", strokeWidth: 0 },
    origin: { kind: "code", route, viewport, key: frameKey },
  };

  // Each kept element with the facts the second pass (z-order, components) needs.
  interface Kept {
    el: ImportedElement;
    order: number;
    stack: number;
    node: CaptureNode;
    signature: string;
  }
  const kept: Kept[] = [];
  let order = 0;

  // Offsets within the page are whole pixels; the page's own position is kept
  // exactly as given (a dragged frame can sit at 100.5), so every element's
  // offset from its frame stays exact.
  const place = (r: { x: number; y: number; w: number; h: number }) => ({
    x: opts.x + round(r.x),
    y: opts.y + round(r.y),
    width: round(Math.max(0, r.w)),
    height: round(Math.max(0, r.h)),
  });

  const originOf = (node: CaptureNode, key: string): ImportedElement["origin"] => ({
    kind: "code",
    route,
    viewport,
    key,
    ...(node.source ? { source: node.source } : {}),
    ...(node.component ? { component: node.component } : {}),
  });

  const textElement = (
    node: CaptureNode,
    key: string,
    parentId: string,
    stack: number,
  ): Kept => {
    const geometry = place(node.textRect ?? node.rect);
    const el: ImportedElement = {
      id: idOf(key),
      type: "text",
      name: oneLine(shortText(node.text ?? "text")).slice(0, SHORT_TEXT_MAX),
      ...geometry,
      parentId,
      z: 0,
      rotation: 0,
      text: (node.text ?? "").slice(0, LONG_TEXT_MAX),
      style: fontStyle(node.style ?? {}),
      origin: originOf(node, key),
    };
    return { el, order: order++, stack, node, signature: "text" };
  };

  /** Walk `node`; returns the signature of what it emitted (for component matching). */
  const walk = (
    node: CaptureNode,
    domKey: string,
    parentId: string,
    inheritedStack: number,
  ): string => {
    if (SKIP.has(node.tag)) return "";
    const s = node.style ?? {};
    if (s.display === "none") return "";
    if (s.opacity !== undefined && parseFloat(s.opacity) === 0) return "";

    const a = node.attrs ?? {};
    const key = uniqueKey(stableKey(node) ?? domKey);
    const stack = stackOf(node, inheritedStack);
    const hasSize = node.rect.w > 0 && node.rect.h > 0;
    const box = hasSize && paintsBox(node);
    const selfId = idOf(key);
    const childParent = box ? selfId : parentId;

    // Reserve this node's paint slot before its children (parents paint first).
    const slot = box ? order++ : -1;

    const childSigs: string[] = [];
    const before = kept.length;
    const children = node.children ?? [];
    const tagCount = new Map<string, number>();
    for (const child of children) {
      const n = (tagCount.get(child.tag) ?? 0) + 1;
      tagCount.set(child.tag, n);
      const sig = walk(child, `${key}/${child.tag}[${n}]`, childParent, stack);
      if (sig) childSigs.push(sig);
    }
    const hasChildren = kept.length > before;
    const text = node.text?.trim();

    if (!box) {
      if (text && s.visibility !== "hidden" && s.visibility !== "collapse") {
        const t = textElement(node, uniqueKey(`${key}::text`), parentId, stack);
        kept.push(t);
        childSigs.unshift("text");
      }
      return childSigs.join(",");
    }

    let geometry = place(node.rect);
    let rotation = 0;
    if (node.rotation && node.size) {
      // The captured rect is the rotated bounding box; recover the real box about its centre.
      const cx = node.rect.x + node.rect.w / 2;
      const cy = node.rect.y + node.rect.h / 2;
      geometry = place({
        x: cx - node.size.w / 2,
        y: cy - node.size.h / 2,
        w: node.size.w,
        h: node.size.h,
      });
      rotation = Math.round(node.rotation * 100) / 100;
    }

    const { style, ellipse } = boxStyle(node, geometry.width, geometry.height);
    const nested = hasChildren || (text !== undefined && text !== "" && childSigs.length > 0);
    const type: ElementType = nested ? "frame" : ellipse ? "ellipse" : "rectangle";
    const el: ImportedElement = {
      id: selfId,
      type,
      name: nameFor(node),
      ...geometry,
      parentId,
      z: 0,
      rotation,
      style,
      origin: originOf(node, key),
    };

    if (text && !nested) {
      // A box holding only text (a button, a badge) keeps it as its own label.
      el.text = text.slice(0, LONG_TEXT_MAX);
      Object.assign(style, fontStyle(s));
    } else if (text) {
      kept.push(textElement(node, uniqueKey(`${key}::text`), selfId, stack));
      childSigs.unshift("text");
    }

    const signature = `${type}(${childSigs.join(",")})`;
    kept.push({ el, order: slot, stack, node, signature });
    return signature;
  };

  const rootTag = new Map<string, number>();
  for (const child of snapshot.root.children ?? []) {
    const n = (rootTag.get(child.tag) ?? 0) + 1;
    rootTag.set(child.tag, n);
    walk(child, `body/${child.tag}[${n}]`, frameId, 0);
  }
  // Text placed directly in <body>.
  if (snapshot.root.text?.trim()) {
    kept.push(textElement(snapshot.root, uniqueKey("body::text"), frameId, 0));
  }

  // z: among siblings, positioned z-index first, then document (paint) order.
  const byParent = new Map<string, Kept[]>();
  for (const k of kept) {
    const list = byParent.get(k.el.parentId ?? "") ?? [];
    list.push(k);
    byParent.set(k.el.parentId ?? "", list);
  }
  for (const list of byParent.values()) {
    list.sort((p, q) => p.stack - q.stack || p.order - q.order);
    for (const [i, k] of list.entries()) k.el.z = i + 1;
  }

  if (opts.detectComponents !== false) markComponents(kept);

  kept.sort((p, q) => p.order - q.order);
  return { elements: [frame, ...kept.map((k) => k.el)], frameId, viewport };
}

/**
 * Repeated frontend components → one master `component` (the first occurrence)
 * plus `instance`s of it. Only component roots that the capture attributed to
 * a named component, with the same emitted structure, are grouped; a lone
 * occurrence stays a plain element. Instances keep their own children, text
 * and geometry — the canvas resolves only missing fields from the master.
 */
function markComponents(
  kept: Array<{ el: ImportedElement; order: number; node: CaptureNode; signature: string }>,
): void {
  const groups = new Map<string, typeof kept>();
  for (const k of kept) {
    if (!k.node.componentRoot || !k.node.component || k.el.type === "text") continue;
    const sig = `${k.node.component}\u0000${k.signature}`;
    const list = groups.get(sig) ?? [];
    list.push(k);
    groups.set(sig, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.order - q.order);
    const [master, ...rest] = list;
    if (!master) continue;
    master.el.type = "component";
    master.el.name = master.node.component!.slice(0, SHORT_TEXT_MAX);
    for (const k of rest) {
      k.el.type = "instance";
      k.el.componentId = master.el.id;
    }
  }
}

/** Horizontal gap between page frames placed side by side. */
export const FRAME_GAP = 200;

/**
 * Where to put each captured page. A page imported before keeps its frame's
 * current position (so re-importing never moves a page someone arranged);
 * new pages go in a row to the right of everything already on the canvas.
 */
export function placeSnapshots(
  snapshots: CaptureSnapshot[],
  existing: DesignElement[],
): Array<{ x: number; y: number }> {
  const byId = new Map(existing.map((e) => [e.id, e]));
  let nextX = existing.length
    ? Math.max(...existing.map((e) => e.x + e.width)) + FRAME_GAP
    : 0;
  return snapshots.map((snap) => {
    const viewport = `${round(snap.viewport.width)}x${round(snap.viewport.height)}`;
    const frame = byId.get(importedElementId(snap.route, viewport, "page"));
    if (frame) return { x: frame.x, y: frame.y };
    const at = { x: nextX, y: 0 };
    nextX += round(snap.viewport.width) + FRAME_GAP;
    return at;
  });
}

// --------------------------------------------------------------------------
// Import report (returned by RepoStore.importDesign)
// --------------------------------------------------------------------------

export interface ImportDesignRequest {
  elements: ImportedElement[];
  /**
   * Remove untouched imported elements of the imported route/viewports that
   * the new capture no longer contains. Never removes a documented, edited or
   * adopted element.
   */
  prune?: boolean;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  /** Recreate drafts that were deleted (dismissed) since they were imported. */
  restoreDismissed?: boolean;
}

export interface ImportDesignReport {
  dryRun: boolean;
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Exists without `origin` (drawn by hand, or adopted): left alone. */
  skipped: string[];
  /** Imported before, then edited: left alone so the edit survives. */
  conflicts: Array<{ id: string; name: string }>;
  /** Drafts whose key shifted, recognised by what they look like and kept under their id. */
  rematched: string[];
  /** Dismissed (deleted) drafts the capture still renders: not recreated. */
  dismissed: string[];
  /** Dismissed drafts brought back (only with `restoreDismissed`). */
  restored: string[];
  /** Drafts of the captured pages the code no longer renders (removed by `prune`). */
  stale: string[];
  /** Pruned (only with `prune`). */
  removed: string[];
  /** Stale but kept (with `prune`): documented, edited or holding kept children. */
  kept: Array<{ id: string; reason: "documented" | "edited" | "has-kept-children" }>;
  /** Dismissed drafts the code no longer renders, forgotten (only with `prune`). */
  forgotten: string[];
  /** Pages ("route · viewport") whose frame was deleted: nothing of them is recreated. */
  dismissedPages: string[];
  /** Captured ids that ended up under another id (a re-match), or `null` (not recreated). */
  idMap: Record<string, string | null>;
}

/** Upper bound on elements per import; capture narrower routes beyond it. */
export const MAX_IMPORT_ELEMENTS = 5000;
