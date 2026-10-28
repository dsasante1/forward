import { createRequire } from "node:module";
import { captureWithBrowser } from "./browser/cdp.js";
import { resolveBrowser, type InstalledBrowser } from "./browser/find.js";
import { captureWithCompanion } from "./companion/run.js";
import { capturePages, checkRoutes, type PageJob, type PlaywrightBrowser, type PlaywrightModule } from "./playwright-run.js";
import { VERSION } from "./version.js";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

export const PLAYWRIGHT_MISSING =
  "Playwright isn't installed in this project. Add it (`npm i -D playwright && npx playwright " +
  "install chromium`), or capture with a browser you already have: `--browser auto` uses the " +
  "first Chromium-based browser installed (Chrome, Edge, Brave, Chromium, Vivaldi, Opera). " +
  "Or capture without either: `forward capture --script` prints a snippet to paste into any " +
  "browser's DevTools, then `forward capture --from forward-snapshot.json`.";

/** Packages whose presence in a package.json means "this project uses Playwright". */
const PLAYWRIGHT_PACKAGES = ["playwright", "@playwright/test", "playwright-core"];

/**
 * Whether the project (the cwd's package.json, or a parent's — monorepos keep
 * tools at the root) declares Playwright itself. A copy that is merely present
 * in node_modules — hoisted there by forward-capture, Storybook's test runner
 * and the like — is somebody else's, with somebody else's browser expectations.
 */
export function declaresPlaywright(cwd: string): boolean {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
      if (PLAYWRIGHT_PACKAGES.some((name) => name in deps)) return true;
    } catch {
      // no package.json here
    }
    if (dirname(dir) === dir) return false;
  }
}

/**
 * Load the project's own Playwright, resolved from the cwd — and only that:
 * where Forward itself happens to be installed, or what else hoisted a copy
 * into node_modules, must not change which browser captures. (Without one,
 * the forward-capture companion brings its own.) Never a dependency of forward-mcp.
 */
export async function loadPlaywright(
  cwd = process.cwd(),
  importer: (specifier: string) => Promise<unknown> = (s) => import(s),
  resolver: (name: string) => string = (name) => createRequire(join(cwd, "package.json")).resolve(name),
  declared: (cwd: string) => boolean = declaresPlaywright,
): Promise<PlaywrightModule> {
  if (!declared(cwd)) throw new Error(PLAYWRIGHT_MISSING);
  // @playwright/test first: it's what `npm init playwright` declares, and pnpm
  // doesn't hoist the `playwright` it depends on to where we can resolve it.
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    try {
      const mod = asPlaywright(await importer(pathToFileURL(resolver(name)).href));
      if (mod) return mod;
    } catch {
      // not in the project — try the next candidate
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
  /** Storage-state file (Playwright's format: cookies + localStorage), for pages behind a login. */
  storageState?: string;
  /** Extra settle time after load, in ms. */
  waitMs?: number;
  /** Navigation timeout per route, in ms (default 30s). */
  timeoutMs?: number;
  /**
   * Which browser drives the capture: "auto" (default — the project's
   * Playwright if it has one, else the first installed Chromium-based
   * browser), "playwright", a browser id (chrome, edge, chromium, brave,
   * vivaldi, opera) or a path to a Chromium-based browser. `$FORWARD_BROWSER`
   * sets the default.
   */
  browser?: string;
}

export interface LiveCapture {
  snapshots: unknown[];
  /** Which browser captured, for the report. */
  capturedWith: string;
  /** Anything worth telling the user (a one-time download), for the report. */
  notes?: string[];
}

/** Capture each route of a running app with a headless browser. */
export async function captureLive(opts: LiveCaptureOptions): Promise<LiveCapture> {
  checkRoutes(opts.url, opts.routes);
  const named = (v: string | undefined) => {
    const t = (v ?? "").trim();
    return /^(auto|playwright)$/i.test(t) ? t.toLowerCase() : t;
  };
  const requested = named(opts.browser) || "auto";
  const choice = requested === "auto" ? named(process.env.FORWARD_BROWSER) || "auto" : requested;
  const job: PageJob = {
    url: opts.url,
    routes: opts.routes,
    viewport: opts.viewport,
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
    ...(opts.waitMs ? { waitMs: opts.waitMs } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  };
  // The project's Playwright — if it has one and it can actually start (a
  // project can have Playwright, or pull it in, without ever downloading its browser).
  const projectPlaywright = async (): Promise<{ launched?: PlaywrightBrowser; problem?: string }> => {
    const pw = await loadPlaywright().catch(() => undefined);
    if (!pw) return {};
    try {
      return { launched: await pw.chromium.launch({ headless: true }) };
    } catch (err) {
      return { problem: (err as Error).message.split("\n")[0] };
    }
  };
  // The companion package brings its own Playwright (and fetches its browser once).
  const companion = () => captureWithCompanion(job, COLLECTOR_SOURCE, VERSION);

  if (choice === "playwright") {
    const { launched } = await projectPlaywright();
    if (launched) return { snapshots: await capturePages(launched, job, COLLECTOR_SOURCE), capturedWith: "Playwright (Chromium)" };
    return companion();
  }
  let playwrightProblem: string | undefined;
  if (choice === "auto") {
    const { launched, problem } = await projectPlaywright();
    if (launched) return { snapshots: await capturePages(launched, job, COLLECTOR_SOURCE), capturedWith: "Playwright (Chromium)" };
    playwrightProblem = problem;
  }
  let browser: InstalledBrowser;
  try {
    browser = resolveBrowser(choice);
  } catch (err) {
    // Auto, and no browser here: the companion is the last resort.
    if (choice !== "auto") throw err;
    try {
      return await companion();
    } catch (companionErr) {
      throw new Error(
        `${(companionErr as Error).message} (No Chromium-based browser is installed` +
          `${playwrightProblem ? `, and the project's Playwright couldn't start: ${playwrightProblem}` : ""}.)`,
      );
    }
  }
  const { snapshots, product } = await captureWithBrowser({
    browser,
    url: opts.url,
    routes: opts.routes,
    viewport: opts.viewport,
    collector: COLLECTOR_SOURCE,
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
    ...(opts.waitMs ? { waitMs: opts.waitMs } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });
  return { snapshots, capturedWith: `${browser.name} (${product}) at ${browser.path}` };
}
