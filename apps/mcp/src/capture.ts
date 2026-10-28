import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Capturing a running frontend as design snapshots (see forward-core's
 * design-import.ts for what a snapshot is and how it becomes elements).
 *
 * The collector is plain browser JavaScript kept as a string: it runs inside
 * the page — pasted into DevTools, or evaluated by Playwright — so it must not
 * depend on anything, and a string survives bundling byte for byte (esbuild
 * would otherwise be free to inject helpers into a serialised function).
 */

/** Browser-side collector: `(COLLECTOR_SOURCE)(opts)` returns a CaptureSnapshot. */
export const COLLECTOR_SOURCE = String.raw`function forwardCollect(opts) {
  opts = opts || {};
  var MAX = opts.maxNodes || 5000;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, BR: 1 };
  var LEAF = { IMG: 1, SVG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, PICTURE: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, HR: 1 };
  var sx = window.scrollX, sy = window.scrollY, count = 0;
  var cut = function (s, n) { s = String(s); return s.length > n ? s.slice(0, n) : s; };

  // Modern colour syntaxes (oklch, color(), lab) are drawn to a pixel and read back as sRGB.
  var cv = document.createElement("canvas"); cv.width = cv.height = 1;
  var ctx = null; try { ctx = cv.getContext("2d", { willReadFrequently: true }); } catch (e) {}
  var cache = {};
  function color(c) {
    if (!c || /^(rgba?\(|#|transparent$)/i.test(c)) return c;
    if (Object.prototype.hasOwnProperty.call(cache, c)) return cache[c];
    var out = c;
    if (ctx) {
      try {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        out = "rgba(" + d[0] + ", " + d[1] + ", " + d[2] + ", " + (d[3] / 255) + ")";
      } catch (e) {}
    }
    return (cache[c] = out);
  }
  function rect(r) { return { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height }; }
  function styleOf(cs) {
    return {
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      position: cs.position, zIndex: cs.zIndex,
      background: color(cs.backgroundColor), backgroundImage: cut(cs.backgroundImage, 200),
      boxShadow: cut(cs.boxShadow, 200), color: color(cs.color),
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cut(cs.fontFamily, 200),
      borderTopWidth: cs.borderTopWidth, borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth, borderLeftWidth: cs.borderLeftWidth,
      borderTopStyle: cs.borderTopStyle, borderRightStyle: cs.borderRightStyle,
      borderBottomStyle: cs.borderBottomStyle, borderLeftStyle: cs.borderLeftStyle,
      borderTopColor: color(cs.borderTopColor), borderRightColor: color(cs.borderRightColor),
      borderBottomColor: color(cs.borderBottomColor), borderLeftColor: color(cs.borderLeftColor),
      borderTopLeftRadius: cs.borderTopLeftRadius, borderTopRightRadius: cs.borderTopRightRadius,
      borderBottomRightRadius: cs.borderBottomRightRadius, borderBottomLeftRadius: cs.borderBottomLeftRadius
    };
  }
  function rotationOf(cs) {
    var m = /^matrix\(([^)]+)\)$/.exec(cs.transform || "");
    if (!m) return 0;
    var p = m[1].split(",").map(parseFloat);
    var deg = Math.atan2(p[1], p[0]) * 180 / Math.PI;
    return Math.abs(deg) < 0.01 ? 0 : deg;
  }
  function ownText(el) {
    var parts = [];
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) parts.push(n.nodeValue);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function textRect(el) {
    var box = null, range = document.createRange();
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      range.selectNodeContents(n);
      var b = range.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      box = box
        ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top),
            right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) }
        : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }
    return box && { x: box.left + sx, y: box.top + sy, w: box.right - box.left, h: box.bottom - box.top };
  }
  // React dev builds: the component that rendered this node, and where its JSX lives.
  function reactInfo(el) {
    var fiber = null;
    for (var k in el) if (k.indexOf("__reactFiber$") === 0) { fiber = el[k]; break; }
    if (!fiber) return null;
    var f = fiber.return, root = true;
    while (f && typeof f.type !== "function" && !(f.type && typeof f.type === "object" && (f.type.render || f.type.type))) {
      if (typeof f.type === "string") root = false;
      f = f.return;
    }
    if (!f) return null;
    var t = f.type, fn = typeof t === "function" ? t : (t.render || t.type);
    var name = t.displayName || (fn && (fn.displayName || fn.name));
    if (!name) return null;
    var src = fiber._debugSource;
    return {
      component: cut(name, 200), componentRoot: root,
      source: src && src.fileName ? cut(src.fileName + ":" + src.lineNumber, 480) : undefined
    };
  }
  var MAX_DEPTH = 200, tooDeep = false;
  function walk(el, depth) {
    var tag = el.tagName.toUpperCase();
    if (depth > MAX_DEPTH) { tooDeep = true; return null; }
    if (SKIP[tag] || count >= MAX) return null;
    var cs = getComputedStyle(el);
    if (cs.display === "none") return null;
    count++;
    var r = el.getBoundingClientRect();
    var node = { tag: cut(tag.toLowerCase(), 64), rect: rect(r), style: styleOf(cs) };
    var rot = rotationOf(cs);
    if (rot) { node.rotation = rot; node.size = { w: el.offsetWidth || r.width, h: el.offsetHeight || r.height }; }
    var attrs = {}, a;
    if ((a = el.getAttribute("data-testid") || el.getAttribute("data-test-id") || el.getAttribute("data-cy"))) attrs.testid = cut(a, 200);
    if (el.id) attrs.id = cut(el.id, 200);
    if ((a = el.getAttribute("aria-label"))) attrs.label = cut(a, 200);
    if ((a = el.getAttribute("alt"))) attrs.alt = cut(a, 200);
    if ((a = el.getAttribute("role"))) attrs.role = cut(a, 200);
    if ((a = el.getAttribute("placeholder"))) attrs.placeholder = cut(a, 200);
    node.attrs = attrs;
    var text = "";
    // Typed values can be secrets or personal data and would be committed with
    // .forward/: show the placeholder, or a mask. Buttons keep their label.
    if (tag === "INPUT" && /^(submit|button|reset)$/i.test(el.type || "")) text = el.value || "";
    else if (tag === "INPUT" || tag === "TEXTAREA") text = el.placeholder || (el.value ? "••••••••" : "");
    else if (tag === "SELECT") text = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : "";
    else { text = ownText(el); var tr = text && textRect(el); if (tr) node.textRect = tr; }
    // Text typed into an editor is user input too.
    if (el.isContentEditable && text && tag !== "INPUT" && tag !== "TEXTAREA") text = "••••••••";
    if (text) node.text = cut(text.replace(/\s+/g, " ").trim(), 10000);
    var info = null; try { info = reactInfo(el); } catch (e) {}
    if (info) { node.component = info.component; node.componentRoot = info.componentRoot; if (info.source) node.source = info.source; }
    if (!LEAF[tag]) {
      var kids = [];
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) { var k2 = walk(c, depth + 1); if (k2) kids.push(k2); }
      if (kids.length) node.children = kids;
    }
    return node;
  }
  var doc = document.documentElement;
  var root = walk(document.body, 0) || { tag: "body", rect: { x: 0, y: 0, w: 0, h: 0 } };
  // The page frame spans the whole scrollable document, not just the body box.
  root.rect = { x: 0, y: 0, w: Math.max(doc.scrollWidth, innerWidth), h: Math.max(doc.scrollHeight, innerHeight) };
  var bodyBg = color(getComputedStyle(document.body).backgroundColor);
  var htmlBg = color(getComputedStyle(doc).backgroundColor);
  var clear = function (c) { return !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c); };
  return {
    version: 1,
    url: cut(location.href, 480),
    route: cut(opts.route || location.pathname || "/", 480),
    viewport: { width: innerWidth, height: innerHeight },
    pageBackground: clear(bodyBg) ? (clear(htmlBg) ? "#ffffff" : htmlBg) : bodyBg,
    capturedAt: new Date().toISOString(),
    truncated: count >= MAX || tooDeep,
    root: root
  };
}`;

/**
 * A DevTools console snippet: captures the current page and both copies the
 * snapshot to the clipboard and downloads it as `forward-snapshot.json`, for
 * `forward capture --from forward-snapshot.json`. Needs no install at all.
 */
export function captureSnippet(route?: string): string {
  const opts = JSON.stringify(route ? { route } : {});
  return `(() => {
  const snapshot = (${COLLECTOR_SOURCE})(${opts});
  const json = JSON.stringify(snapshot);
  try { copy(json); } catch {}
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = "forward-snapshot.json";
  a.click();
  console.log("Forward: captured " + snapshot.route + " (" + Math.round(json.length / 1024) + " KB) → forward-snapshot.json" + (snapshot.truncated ? " — truncated at 5000 nodes" : ""));
})();
`;
}

/** Parse "1440x900" into a viewport. */
export function parseViewport(value: string | undefined): { width: number; height: number } {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec((value ?? "1440x900").trim());
  if (!m) throw new Error(`Viewport must look like 1440x900, got "${value}".`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

interface PlaywrightPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
  waitForLoadState(state: string, opts: { timeout: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
}
interface PlaywrightModule {
  chromium: {
    launch(opts?: { headless?: boolean }): Promise<{
      newContext(opts: Record<string, unknown>): Promise<{ newPage(): Promise<PlaywrightPage> }>;
      close(): Promise<void>;
    }>;
  };
}

export const PLAYWRIGHT_MISSING =
  "Live capture needs Playwright, which Forward does not install. Add it to the project " +
  "(`npm i -D playwright && npx playwright install chromium`) — or capture without it: " +
  "`forward capture --script` prints a snippet to paste into the browser's DevTools, then " +
  "`forward capture --from forward-snapshot.json`.";

/**
 * Load Playwright on demand. It is resolved from the user's project first (the
 * cwd), then next to Forward itself, so a globally installed or npx'd
 * `forward` still finds the project's copy. Never a dependency of forward-mcp.
 */
export async function loadPlaywright(
  cwd = process.cwd(),
  importer: (specifier: string) => Promise<unknown> = (s) => import(s),
): Promise<PlaywrightModule> {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const resolved = createRequire(join(cwd, "package.json")).resolve(name);
      const mod = asPlaywright(await importer(pathToFileURL(resolved).href));
      if (mod) return mod;
    } catch {
      // not in the project — try the next candidate
    }
    try {
      const mod = asPlaywright(await importer(name));
      if (mod) return mod;
    } catch {
      // not next to Forward either
    }
  }
  throw new Error(PLAYWRIGHT_MISSING);
}

/**
 * `require.resolve` finds Playwright's CommonJS entry, and importing a CJS file
 * puts its exports on `default`; the ESM entry has them as named exports.
 * Accept either shape.
 */
function asPlaywright(mod: unknown): PlaywrightModule | null {
  const has = (m: unknown): m is PlaywrightModule =>
    typeof (m as PlaywrightModule | null)?.chromium?.launch === "function";
  if (has(mod)) return mod;
  const fallback = (mod as { default?: unknown } | null)?.default;
  return has(fallback) ? fallback : null;
}

export interface LiveCaptureOptions {
  /** Base URL of the running app, e.g. http://localhost:5173. */
  url: string;
  /** Routes to capture, resolved against `url`. */
  routes: string[];
  viewport: { width: number; height: number };
  /** Playwright storage-state file, for pages behind a login. */
  storageState?: string;
  /** Extra settle time after load, in ms. */
  waitMs?: number;
  /** Navigation timeout per route, in ms (default 30s). */
  timeoutMs?: number;
}

/** Capture each route of a running app with headless Chromium. */
export async function captureLive(opts: LiveCaptureOptions): Promise<unknown[]> {
  const base = new URL(opts.url);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error(`Capture URL must be http(s), got ${base.protocol}`);
  }
  // A route is a path on the app; an absolute one (file://, another host,
  // chrome://) could pull a local file or another site into .forward/.
  for (const route of opts.routes) {
    if (new URL(route, base).origin !== base.origin) {
      throw new Error(`Route "${route}" is not on ${base.origin}; give paths like /login.`);
    }
  }
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: opts.viewport,
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    const page = await context.newPage();
    const out: unknown[] = [];
    for (const route of opts.routes) {
      const response = await page.goto(new URL(route, base).toString(), {
        waitUntil: "load",
        timeout: opts.timeoutMs ?? 30_000,
      });
      // Let client-side rendering and data fetching settle; a page that never
      // goes idle (polling, websockets) is captured as it stands.
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
      const snapshot = (await page.evaluate(
        `(${COLLECTOR_SOURCE})(${JSON.stringify({ route })})`,
      )) as Record<string, unknown>;
      const status = (response as { status?: () => number } | null)?.status?.();
      out.push({ ...snapshot, ...(typeof status === "number" ? { status } : {}) });
    }
    return out;
  } finally {
    await browser.close();
  }
}
