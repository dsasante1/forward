import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaptureSnapshot, mapSnapshot, type CaptureNode } from "forward-core";
import { initRepo } from "forward-core/repo";
import { COLLECTOR_SOURCE, PLAYWRIGHT_MISSING, captureLive, captureSnippet, loadPlaywright, parseViewport } from "./capture.js";
import { insideRepo, parseSource, writeAnchors } from "./import-anchors.js";

// --- a minimal fake DOM, just enough for the collector ----------------------

interface Spec {
  tag: string;
  rect: [number, number, number, number];
  style?: Record<string, string>;
  attrs?: Record<string, string>;
  text?: string;
  textRect?: [number, number, number, number];
  value?: string;
  type?: string;
  editable?: boolean;
  fiber?: unknown;
  children?: Spec[];
}

const DEFAULT_STYLE: Record<string, string> = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  position: "static",
  zIndex: "auto",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  boxShadow: "none",
  color: "rgb(0, 0, 0)",
  fontSize: "16px",
  fontWeight: "400",
  fontFamily: "Inter, sans-serif",
  transform: "none",
};

function fakeDom(body: Spec, viewport = { width: 1440, height: 900 }) {
  const styles = new Map<object, Record<string, string>>();
  const rectOf = (r: [number, number, number, number]) => ({ left: r[0], top: r[1], width: r[2], height: r[3], right: r[0] + r[2], bottom: r[1] + r[3] });
  const build = (spec: Spec): Record<string, unknown> => {
    const el: Record<string, unknown> = {
      nodeType: 1,
      tagName: spec.tag.toUpperCase(),
      id: spec.attrs?.id ?? "",
      value: spec.value ?? "",
      type: spec.type ?? "",
      placeholder: spec.attrs?.placeholder ?? "",
      isContentEditable: spec.editable ?? false,
      getAttribute: (n: string) => spec.attrs?.[n] ?? null,
      getBoundingClientRect: () => rectOf(spec.rect),
      offsetWidth: spec.rect[2],
      offsetHeight: spec.rect[3],
    };
    if (spec.fiber) el.__reactFiber$test = spec.fiber;
    styles.set(el, { ...DEFAULT_STYLE, ...spec.style });
    const kids = (spec.children ?? []).map(build);
    const textNode = spec.text ? { nodeType: 3, nodeValue: spec.text, rect: rectOf(spec.textRect ?? spec.rect), nextSibling: null } : null;
    el.firstChild = textNode ?? kids[0] ?? null;
    if (textNode) textNode.nextSibling = (kids[0] ?? null) as never;
    kids.forEach((k, i) => (k.nextSibling = kids[i + 1] ?? null));
    el.firstElementChild = kids[0] ?? null;
    kids.forEach((k, i) => (k.nextElementSibling = kids[i + 1] ?? null));
    return el;
  };
  const bodyEl = build(body);
  const html = build({ tag: "html", rect: [0, 0, viewport.width, viewport.height], style: { backgroundColor: "rgb(250, 250, 250)" } });
  Object.assign(html, { scrollWidth: viewport.width, scrollHeight: 1200 });
  const document = {
    body: bodyEl,
    documentElement: html,
    createElement: () => ({ getContext: () => null }),
    createRange: () => {
      let node: { rect: unknown } | null = null;
      return { selectNodeContents: (n: { rect: unknown }) => (node = n), getBoundingClientRect: () => node?.rect };
    },
  };
  const env = {
    window: { scrollX: 0, scrollY: 0 },
    document,
    getComputedStyle: (el: object) => styles.get(el),
    location: { href: "http://localhost:5173/login", pathname: "/login" },
    innerWidth: viewport.width,
    innerHeight: viewport.height,
  };
  const run = new Function(...Object.keys(env), `return (${COLLECTOR_SOURCE})({});`);
  return run(...Object.values(env)) as unknown;
}

describe("collector script", () => {
  it("captures a page into a snapshot the mapper understands", () => {
    function Card() {}
    const raw = fakeDom({
      tag: "body",
      rect: [0, 0, 1440, 900],
      children: [
        { tag: "script", rect: [0, 0, 0, 0] },
        { tag: "div", rect: [0, 0, 0, 0], style: { display: "none" }, children: [{ tag: "p", rect: [0, 0, 10, 10], text: "hidden" }] },
        {
          tag: "section",
          rect: [100, 100, 300, 200],
          style: { backgroundColor: "rgb(255, 255, 255)", borderTopLeftRadius: "12px", borderTopRightRadius: "12px", borderBottomRightRadius: "12px", borderBottomLeftRadius: "12px" },
          attrs: { "data-testid": "card" },
          fiber: { type: "section", return: { type: Card, return: null }, _debugSource: { fileName: "/repo/src/Card.tsx", lineNumber: 4 } },
          children: [
            { tag: "h2", rect: [120, 120, 260, 30], text: "  Your   order ", textRect: [120, 122, 120, 26] },
            { tag: "input", rect: [120, 160, 260, 32], type: "password", value: "hunter2", style: { borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px", borderTopStyle: "solid", borderRightStyle: "solid", borderBottomStyle: "solid", borderLeftStyle: "solid", borderTopColor: "rgb(200, 200, 200)", borderRightColor: "rgb(200, 200, 200)", borderBottomColor: "rgb(200, 200, 200)", borderLeftColor: "rgb(200, 200, 200)" } },
            { tag: "input", rect: [120, 200, 260, 32], type: "email", value: "ada@example.com" },
            { tag: "input", rect: [120, 240, 260, 32], type: "text", value: "sk-live-123", attrs: { placeholder: "API key" } },
            { tag: "input", rect: [120, 280, 80, 32], type: "submit", value: "Go" },
            { tag: "div", rect: [120, 320, 260, 80], text: "Dear Ada, my card is 4242…", editable: true },
          ],
        },
      ],
    });
    const snap = CaptureSnapshot.parse(raw);
    expect(snap).toMatchObject({ route: "/login", viewport: { width: 1440, height: 900 }, pageBackground: "rgb(250, 250, 250)", truncated: false });
    expect(snap.root.rect.h).toBe(1200); // the whole document, not the body box
    const section = snap.root.children?.[0];
    expect(snap.root.children).toHaveLength(1); // script and display:none dropped
    expect(section).toMatchObject({ tag: "section", component: "Card", componentRoot: true, source: "/repo/src/Card.tsx:4", attrs: { testid: "card" } });
    expect(section?.children?.[0]).toMatchObject({ text: "Your order", textRect: { x: 120, y: 122, w: 120, h: 26 } });
    // A password value never leaves the page.
    expect(section?.children?.[1]?.text).toBe("••••••••");
    // Nor does any other typed value: the placeholder or a mask, never the value.
    expect(section?.children?.slice(2).map((c) => c.text)).toEqual(["••••••••", "API key", "Go", "••••••••"]);

    const { elements } = mapSnapshot(snap, { x: 0, y: 0 });
    expect(elements.map((e) => e.type)).toEqual(["frame", "frame", "text", "rectangle", "rectangle", "rectangle", "rectangle", "text"]);
    expect(elements[0]?.style?.fill).toBe("#fafafa");
  });

  it("stops descending past 200 levels", () => {
    let spec: Spec = { tag: "div", rect: [0, 0, 10, 10] };
    for (let i = 0; i < 400; i++) spec = { tag: "div", rect: [0, 0, 10, 10], children: [spec] };
    const snap = fakeDom({ tag: "body", rect: [0, 0, 10, 10], children: [spec] }) as { root: CaptureNode };
    let depth = 0;
    for (let n: CaptureNode | undefined = snap.root; n; n = n.children?.[0]) depth++;
    expect(depth).toBe(201);
    // …and says the page is incomplete, so prune won't trust it.
    expect((snap as { truncated?: boolean }).truncated).toBe(true);
  });

  it("is valid JavaScript on its own and inside the DevTools snippet", () => {
    expect(() => new Function(`return (${COLLECTOR_SOURCE});`)).not.toThrow();
    const snippet = captureSnippet("/settings");
    expect(() => new Function(snippet)).not.toThrow();
    expect(snippet).toContain('{"route":"/settings"}');
    expect(snippet).toContain("forward-snapshot.json");
  });
});

describe("live capture", () => {
  it("explains how to proceed when Playwright is not installed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forward-nopw-"));
    try {
      await expect(loadPlaywright(dir, () => Promise.reject(new Error("nope")))).rejects.toThrow(PLAYWRIGHT_MISSING);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("accepts Playwright's CommonJS entry, whose exports arrive on `default`", async () => {
    const chromium = { launch: async () => ({}) };
    const cjs = await loadPlaywright(tmpdir(), async () => ({ default: { chromium } }));
    expect(cjs.chromium).toBe(chromium);
    const esm = await loadPlaywright(tmpdir(), async () => ({ chromium }));
    expect(esm.chromium).toBe(chromium);
    // A module that isn't Playwright is treated as missing, not crashed on later.
    await expect(loadPlaywright(tmpdir(), async () => ({ default: {} }))).rejects.toThrow(PLAYWRIGHT_MISSING);
  });

  it("refuses routes that leave the app's origin, before loading a browser", async () => {
    for (const route of ["file:///etc/passwd", "//evil.example/x", "https://other.example/", "chrome://settings"]) {
      await expect(
        captureLive({ url: "http://localhost:5173", routes: ["/", route], viewport: { width: 10, height: 10 } }),
      ).rejects.toThrow(/is not on http:\/\/localhost:5173/);
    }
  });

  it("parses viewports", () => {
    expect(parseViewport(undefined)).toEqual({ width: 1440, height: 900 });
    expect(parseViewport("390x844")).toEqual({ width: 390, height: 844 });
    expect(() => parseViewport("big")).toThrow(/1440x900/);
  });
});

describe("anchor writer", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "forward-anchors-"));
    mkdirSync(join(root, "src"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("only accepts files inside the repository", () => {
    expect(insideRepo(root, "src/Card.tsx")).toBe("src/Card.tsx");
    expect(insideRepo(root, join(root, "src/Card.tsx"))).toBe("src/Card.tsx");
    expect(insideRepo(root, "../elsewhere/Card.tsx")).toBeNull();
    expect(insideRepo(root, "/etc/passwd")).toBeNull();
    expect(insideRepo(root, "node_modules/lib/x.js")).toBeNull();
    expect(parseSource("src/Card.tsx:12:5")).toEqual({ file: "src/Card.tsx", line: 12 });
  });

  it("inserts a line comment above the declaration, never inside JSX, and only once", async () => {
    const file = join(root, "src/Card.tsx");
    const source = ["import x from 'y';", "", "  export default function Card() {", "  return (", "    <section>", "    </section>", "  );", "}", ""].join("\n");
    writeFileSync(file, source);
    const target = { elementId: "el_abc", label: 'My "card"', component: "Card", file: "src/Card.tsx", line: 5 };
    const dry = await writeAnchors(root, [target], { dryRun: true });
    expect(dry.written).toEqual([{ elementId: "el_abc", file: "src/Card.tsx", line: 3 }]);
    expect(readFileSync(file, "utf8")).toBe(source);

    await writeAnchors(root, [target]);
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines[2]).toBe(`  // @adc el_abc "My 'card'"`);
    expect(lines[3]).toBe("  export default function Card() {");

    const again = await writeAnchors(root, [target]);
    expect(again.skipped).toEqual([{ elementId: "el_abc", file: "src/Card.tsx", reason: "already anchored" }]);
    expect(readFileSync(file, "utf8").match(/@adc/g)).toHaveLength(1);
  });

  it("keeps a hostile label inside the comment", async () => {
    const file = join(root, "src/Avatar.jsx");
    writeFileSync(file, "export function Avatar() {\n  return <img />;\n}\n");
    await writeAnchors(root, [
      { elementId: "el_av", label: "Bob\u2028;globalThis.PWNED=1;//\u2029\r\n*/", component: "Avatar", file: "src/Avatar.jsx", line: 2 },
    ]);
    const first = readFileSync(file, "utf8").split("\n")[0] ?? "";
    expect(first).toMatch(/^\/\/ @adc el_av "[\x20-\x7e]*"$/);
    expect(readFileSync(file, "utf8")).not.toMatch(/[\u2028\u2029\r]/);
  });

  it("does not follow a symlink out of the repository", async () => {
    const outside = mkdtempSync(join(tmpdir(), "forward-outside-"));
    try {
      writeFileSync(join(outside, "Card.jsx"), "export function Card() {}\n");
      symlinkSync(outside, join(root, "src/link"));
      expect(insideRepo(root, "src/link/Card.jsx")).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("compares correctly under a symlinked repository root, even for missing files", () => {
    const linked = `${root}-link`;
    symlinkSync(root, linked);
    try {
      expect(insideRepo(linked, "src/not-yet.tsx")).toBe("src/not-yet.tsx");
      expect(insideRepo(linked, join(root, "src/not-yet.tsx"))).toBe("src/not-yet.tsx");
    } finally {
      rmSync(linked);
    }
  });

  it("puts at most one anchor above a declaration", async () => {
    const file = join(root, "src/Tile.tsx");
    writeFileSync(file, "export function Tile() {\n  return <div />;\n}\n");
    await writeAnchors(root, [{ elementId: "el_desktop", label: "Tile", component: "Tile", file: "src/Tile.tsx", line: 2 }]);
    const res = await writeAnchors(root, [{ elementId: "el_mobile", label: "Tile", component: "Tile", file: "src/Tile.tsx", line: 3 }]);
    expect(res.skipped).toEqual([{ elementId: "el_mobile", file: "src/Tile.tsx", reason: "declaration already anchored" }]);
    expect(readFileSync(file, "utf8").match(/@adc/g)).toHaveLength(1);
  });

  it("skips what it can't place safely", async () => {
    writeFileSync(join(root, "src/anon.tsx"), "export default () => <div/>;\n");
    writeFileSync(join(root, "src/page.vue"), "<template></template>\n");
    const res = await writeAnchors(root, [
      { elementId: "el_1", label: "x", component: "Anon", file: "src/anon.tsx", line: 1 },
      { elementId: "el_2", label: "x", component: "Page", file: "src/page.vue", line: 1 },
      { elementId: "el_3", label: "x", component: "Gone", file: "src/missing.tsx", line: 1 },
    ]);
    expect(res.written).toEqual([]);
    expect(res.skipped.map((s) => s.reason)).toEqual([
      "no declaration of Anon above line 1",
      "not a JS/TS file",
      "file not readable",
    ]);
    expect(readFileSync(join(root, "src/anon.tsx"), "utf8")).toBe("export default () => <div/>;\n");
  });
});

describe("import_design_from_code through the in-memory client", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "forward-import-"));
    initRepo(root, { name: "Import Test" });
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/Card.tsx"), "export function Card() {\n  return <article />;\n}\n");
    process.env.FORWARD_REPO = root;
  });
  afterAll(async () => {
    const { close } = await import("./cli/call.js");
    await close();
    delete process.env.FORWARD_REPO;
    rmSync(root, { recursive: true, force: true });
  });

  const card = (y: number, title: string, source: string) => ({
    tag: "article",
    rect: { x: 0, y, w: 300, h: 100 },
    component: "Card",
    componentRoot: true,
    source,
    style: { background: "#ffffff" },
    children: [{ tag: "h3", rect: { x: 10, y: y + 10, w: 200, h: 20 }, text: title, component: "Card", source }],
  });
  const snapshot = (source: string) => ({
    version: 1,
    route: "/shop",
    viewport: { width: 1280, height: 800 },
    root: { tag: "body", rect: { x: 0, y: 0, w: 1280, h: 800 }, children: [card(0, "One", source), card(120, "Two", source)] },
  });

  it("imports a snapshot file, is idempotent, keeps edits and anchors components", async () => {
    const { callTool } = await import("./cli/call.js");
    const file = join(root, "forward-snapshot.json");
    // An absolute dev-machine path is stored repository-relative.
    writeFileSync(file, JSON.stringify(snapshot(`${join(root, "src/Card.tsx")}:2`)));

    const dry = JSON.parse((await callTool("import_design_from_code", { snapshotPath: [file], dryRun: true })).text);
    expect(dry.counts.created).toBe(5);
    const listBefore = JSON.parse((await callTool("list_design_elements", {})).text);
    expect(listBefore).toEqual([]);

    const first = await callTool("import_design_from_code", { snapshotPath: [file], writeAnchors: true });
    expect(first.isError).toBe(false);
    const res = JSON.parse(first.text);
    expect(res.counts).toMatchObject({ created: 5, conflicts: 0 });
    expect(res.pages[0]).toMatchObject({ route: "/shop", viewport: "1280x800", elements: 5 });
    expect(res.anchors.written).toHaveLength(1);
    expect(res.anchors.skipped).toEqual([]);
    expect(readFileSync(join(root, "src/Card.tsx"), "utf8")).toMatch(/^\/\/ @adc el_[0-9a-f]{14} "Card"\nexport function Card/);

    const list = JSON.parse((await callTool("list_design_elements", {})).text) as Array<{ id: string; type: string; fromCode?: { route: string } }>;
    expect(list.every((e) => e.fromCode?.route === "/shop")).toBe(true);
    expect(list.filter((e) => e.type === "component")).toHaveLength(1);
    const master = list.find((e) => e.type === "component");
    const anchors = JSON.parse((await callTool("resolve_anchors", { path: join(root, "src") })).text);
    expect(JSON.stringify(anchors)).toContain(master?.id);

    // Someone edits a draft; the next import leaves it alone and reports it.
    const text = list.find((e) => e.type === "text");
    await callTool("update_element", { elementId: text?.id, name: "Product title" });
    const second = JSON.parse((await callTool("import_design_from_code", { snapshotPath: [file], writeAnchors: true })).text);
    expect(second.counts).toMatchObject({ created: 0, updated: 0, unchanged: 4, conflicts: 1 });
    expect(second.anchors.written).toEqual([]);
    expect(readFileSync(join(root, "src/Card.tsx"), "utf8").match(/@adc/g)).toHaveLength(1);

    const info = JSON.parse((await callTool("project_info", {})).text);
    expect(info.counts.importedFromCode).toBe(5);
  });

  it("reports an anchor whose source lies outside the repository instead of dropping it", async () => {
    const { callTool } = await import("./cli/call.js");
    const outside = snapshot("/somewhere/else/Card.tsx:2");
    outside.route = "/elsewhere";
    const res = JSON.parse((await callTool("import_design_from_code", { snapshot: outside, writeAnchors: true, dryRun: true })).text);
    expect(res.anchors.written).toEqual([]);
    expect(res.anchors.skipped).toEqual([expect.objectContaining({ reason: "file is outside the repository" })]);
  });

  it("does not prune from a page that may not be the real one", async () => {
    const { callTool } = await import("./cli/call.js");
    const base = { ...snapshot("x:1"), route: "/guarded" };
    await callTool("import_design_from_code", { snapshot: base });
    const redirected = { ...base, url: "http://localhost/login", status: 200, root: { ...base.root, children: [] } };
    const res = JSON.parse((await callTool("import_design_from_code", { snapshot: redirected, prune: true })).text);
    expect(res.counts.removed).toBe(0);
    expect(res.warnings.join(" ")).toMatch(/ended up on \/login.*Not pruning/);
    const cut = JSON.parse((await callTool("import_design_from_code", { snapshot: { ...base, truncated: true, root: { ...base.root, children: [] } }, prune: true })).text);
    expect(cut.counts.removed).toBe(0);
    const error = JSON.parse((await callTool("import_design_from_code", { snapshot: { ...base, status: 500, root: { ...base.root, children: [] } }, prune: true, dryRun: true })).text);
    expect(error.warnings[0]).toMatch(/HTTP 500/);
    // Hash routers: /#/dashboard redirected to /#/login has the same pathname.
    const hashRoute = { ...base, route: "/#/dash" };
    await callTool("import_design_from_code", { snapshot: hashRoute });
    const hashRedirect = JSON.parse((await callTool("import_design_from_code", { snapshot: { ...hashRoute, url: "http://localhost/#/login", status: 200, root: { ...base.root, children: [] } }, prune: true, dryRun: true })).text);
    expect(hashRedirect.counts.removed).toBe(0);
    expect(hashRedirect.warnings[0]).toMatch(/ended up on \/#\/login/);
    // A DevTools snapshot (no status) taken under a route pattern is not a redirect.
    const manual = JSON.parse((await callTool("import_design_from_code", { snapshot: { ...base, route: "/users/:id", url: "http://localhost/users/42" }, dryRun: true })).text);
    expect(manual.warnings).toBeUndefined();
    // A genuine capture of the same route does prune.
    const real = JSON.parse((await callTool("import_design_from_code", { snapshot: { ...base, url: "http://localhost/guarded", root: { ...base.root, children: [] } }, prune: true, dryRun: true })).text);
    expect(real.counts.removed).toBeGreaterThan(0);
  });

  it("gives a readable error for a snapshot nested too deeply", async () => {
    const { callTool } = await import("./cli/call.js");
    let node: Record<string, unknown> = { tag: "div", rect: { x: 0, y: 0, w: 1, h: 1 } };
    for (let i = 0; i < 20000; i++) node = { tag: "div", rect: { x: 0, y: 0, w: 1, h: 1 }, children: [node] };
    const res = await callTool("import_design_from_code", { snapshot: { ...snapshot("x:1"), route: "/deep", root: node } });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/nests too deeply|Maximum call stack/);
  });

  it("suggests next steps, honours deletions, and restores on request", async () => {
    const { callTool } = await import("./cli/call.js");
    const page = (titles: string[]) => ({
      version: 1,
      route: "/next",
      viewport: { width: 800, height: 600 },
      root: {
        tag: "body",
        rect: { x: 0, y: 0, w: 800, h: 600 },
        children: titles.map((t, i) => ({ tag: "p", rect: { x: 0, y: i * 40, w: 300, h: 30 }, text: t, style: { background: "#fff" } })),
      },
    });
    await callTool("import_design_from_code", { snapshot: page(["One", "Two", "Three"]) });
    const list = JSON.parse((await callTool("list_design_elements", {})).text) as Array<{ id: string; text?: string; fromCode?: { route: string } }>;
    const two = list.find((e) => e.text === "Two" && e.fromCode?.route === "/next");
    await callTool("delete_element", { elementId: two?.id });

    const res = JSON.parse((await callTool("import_design_from_code", { snapshot: page(["One", "Two"]) })).text);
    expect(res.counts).toMatchObject({ created: 0, dismissed: 1, stale: 1 });
    expect(res.next.join(" ")).toMatch(/1 draft\(s\) are no longer in the code.*1 deleted draft\(s\) were not recreated/);

    const back = JSON.parse((await callTool("import_design_from_code", { snapshot: page(["One", "Two"]), restoreDismissed: true, prune: true })).text);
    expect(back.counts).toMatchObject({ created: 1, restored: 1, removed: 1 });
  });

  it("keys elements on repo-relative sources, so another checkout gets the same ids", async () => {
    const { callTool } = await import("./cli/call.js");
    // A component of its own, so the anchor preview has something to offer.
    writeFileSync(join(root, "src/Promo.tsx"), "export function Promo() {\n  return <article />;\n}\n");
    const at = (prefix: string) =>
      JSON.parse(JSON.stringify({ ...snapshot(`${prefix}/src/Promo.tsx:2`), route: "/checkout-a" }).replaceAll('"Card"', '"Promo"'));
    const first = JSON.parse((await callTool("import_design_from_code", { snapshot: at(root), dryRun: true })).text);
    // The same repository checked out somewhere else, via a symlink.
    const elsewhere = `${root}-checkout`;
    symlinkSync(root, elsewhere);
    try {
      const second = JSON.parse((await callTool("import_design_from_code", { snapshot: at(elsewhere), dryRun: true })).text);
      expect(second.pages[0].frameId).toBe(first.pages[0].frameId);
      await callTool("import_design_from_code", { snapshot: at(root) });
      const again = JSON.parse((await callTool("import_design_from_code", { snapshot: at(elsewhere) })).text);
      expect(again.counts).toMatchObject({ created: 0, unchanged: 5 });
      // And the anchors it could add are previewed, not written.
      expect(again.next.join(" ")).toMatch(/writeAnchors would add/);
    } finally {
      rmSync(elsewhere);
    }
  });

  it("anchors the id a re-matched draft kept, and drops sources this checkout can't resolve", async () => {
    const { callTool } = await import("./cli/call.js");
    writeFileSync(join(root, "src/Hero.tsx"), "export function Hero() {\n  return <header />;\n}\n");
    const hero = (y: number) => ({ tag: "header", rect: { x: 0, y, w: 600, h: 80 }, text: "Welcome", component: "Hero", componentRoot: true, source: "src/Hero.tsx:2", style: { background: "#fff" } });
    const page = (children: unknown[]) => ({ version: 1, route: "/hero", viewport: { width: 800, height: 600 }, root: { tag: "body", rect: { x: 0, y: 0, w: 800, h: 600 }, children } });
    await callTool("import_design_from_code", { snapshot: page([hero(0)]) });
    const before = (JSON.parse((await callTool("list_design_elements", {})).text) as Array<{ id: string; text?: string }>).find((e) => e.text === "Welcome");
    // The source line moves (an import added above): same element, new key.
    const moved = { ...hero(100), source: "src/Hero.tsx:3" };
    const res = JSON.parse((await callTool("import_design_from_code", { snapshot: page([{ tag: "div", rect: { x: 0, y: 0, w: 800, h: 90 }, style: { background: "#f00" }, text: "Promo" }, moved]), writeAnchors: true })).text);
    expect(res.counts.rematched).toBe(1);
    expect(res.anchors.written).toEqual([expect.objectContaining({ elementId: before?.id, file: "src/Hero.tsx" })]);

    for (const source of ["C:\\Users\\me\\repo\\src\\Hero.tsx:2", "https://cdn.example/Hero.tsx:2"]) {
      const out = JSON.parse((await callTool("import_design_from_code", { snapshot: { ...page([{ ...hero(0), source }]), route: "/hero-ext" }, dryRun: true, writeAnchors: true })).text);
      expect(out.anchors.skipped).toEqual([expect.objectContaining({ reason: "file is outside the repository" })]);
    }
    const webpack = JSON.parse((await callTool("import_design_from_code", { snapshot: { ...page([{ ...hero(0), source: "webpack:///./src/Hero.tsx:2" }]), route: "/hero-wp" }, dryRun: true, writeAnchors: true })).text);
    expect(webpack.anchors.skipped).toEqual([expect.objectContaining({ reason: "declaration already anchored" })]);
  });

  it("rejects input that is not a capture, and duplicate pages", async () => {
    const { callTool } = await import("./cli/call.js");
    const bad = await callTool("import_design_from_code", { snapshot: { version: 1, route: "/x" } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/not a Forward capture at viewport/);
    const dup = await callTool("import_design_from_code", { snapshot: [snapshot("x:1"), snapshot("x:1")] });
    expect(dup.text).toMatch(/same page/);
    const none = await callTool("import_design_from_code", {});
    expect(none.text).toMatch(/Nothing to import/);
  });
});
