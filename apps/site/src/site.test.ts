import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pages } from "./prerender.js";

const repo = resolve(import.meta.dirname, "../../..");
const CLI = join(repo, "apps/mcp/dist/cli.js");
const forward = (...args: string[]) => execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

const html = Object.fromEntries(Object.entries(pages).map(([file, render]) => [file, render()]));
/** Each page's template, whose <head> (title, description, og tags) the rendered markup doesn't include. */
const template = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8");
const landing = html["index.html"]!;
const docs = html["docs/index.html"]!;

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const textOf = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const ids = (s: string) => new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
const hrefs = (s: string) => [...s.matchAll(/\shref="([^"]+)"/g)].map((m) => decode(m[1]!));

describe.each(Object.keys(pages))("%s", (file) => {
  const page = html[file]!;

  it("renders the same markup every time (it is prerendered, then hydrated)", () => {
    expect(pages[file]!()).toBe(page);
  });

  it("says nothing about the hosted service Forward no longer is", () => {
    const banned = [
      "sign up", "sign-up", "signup", "sign in", "sign-in", "log in", "pricing", "per seat", "free trial",
      "workspace", "organisation", "organization", "multi-tenant", "invite", "api key", "access token",
      "clerk", "supabase", "firebase", "dashboard", "hosted", "account", "billing", "subscription",
    ];
    // Tags become spaces, so a word split across elements still reads as one phrase.
    const text = `${textOf(template(file))} ${decode(template(file))} ${textOf(page)}`.toLowerCase();
    expect(banned.filter((w) => text.includes(w))).toEqual([]);
  });

  it("links only to anchors that exist", () => {
    const own = ids(page);
    const docIds = ids(docs);
    const broken = hrefs(page).filter((h) => {
      if (h.startsWith("#")) return !own.has(h.slice(1));
      const m = /^\/docs\/#(.+)$/.exec(h);
      return m ? !docIds.has(m[1]!) : false;
    });
    expect(broken).toEqual([]);
  });

  it("links only to the site's own pages, or to absolute https URLs", () => {
    const bad = hrefs(page).filter((h) => !/^(#|\/(docs\/|demo\/)?(#|$)|https:\/\/)/.test(h));
    expect(bad).toEqual([]);
  });
});

describe("what the pages tell people to run", () => {
  const help = existsSync(CLI) ? forward("help") : "";
  const tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[] = existsSync(CLI)
    ? JSON.parse(forward("tools", "--json"))
    : [];

  it("has the built CLI to check against", () => {
    expect(existsSync(CLI), `build the CLI first: npm run build -w packages/shared && npm run build -w apps/mcp`).toBe(true);
  });

  it("names only real `forward` commands and agent tools", () => {
    const commands = new Set([...help.matchAll(/^ {2}forward ([a-z][a-z-]*)/gm)].map((m) => m[1]!));
    commands.add("help");
    const toolNames = new Set(tools.map((t) => t.name));
    // All text, not just <code>: terminal mockups are styled divs. Lower-case
    // "forward" followed by a word is a command; the product name is capitalised.
    const used = [landing, docs].flatMap((p) => [...textOf(p).matchAll(/(?:^|[\s(`$])forward ([a-z][a-z_-]*)/g)].map((m) => m[1]!));
    expect(used.length).toBeGreaterThan(5);
    expect([...new Set(used)].filter((c) => !commands.has(c) && !toolNames.has(c))).toEqual([]);
  });

  it("names only real agent tools", () => {
    const toolNames = new Set(tools.map((t) => t.name));
    // snake_case words are tool names, apart from these field and config names.
    const notTools = new Set(["version_timeline", "in_progress", "mcp_servers", "user_id", "el_pay_button"]);
    const named = [landing, docs].flatMap((p) => [...textOf(p).matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map((m) => m[0]));
    expect([...new Set(named)].filter((n) => !toolNames.has(n) && !notTools.has(n))).toEqual([]);
  });

  it("counts the tools right", () => {
    const counts = [landing, docs].flatMap((p) => [...textOf(p).matchAll(/\b(\d+)\s+(?:MCP\s+|agent\s+)?tools\b/gi)].map((m) => Number(m[1])));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.filter((n) => n !== tools.length)).toEqual([]);
  });

  it("uses only flags the CLI or its tools accept", () => {
    const known = new Set([
      ...[...help.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]!),
      ...tools.flatMap((t) => Object.keys(t.inputSchema?.properties ?? {})),
      // npm's and npx's own
      "global", "yes", "save-dev", "workspace",
    ]);
    const flags = [landing, docs].flatMap((p) => [...textOf(p).matchAll(/(?:^|[\s(`])--([a-zA-Z][a-zA-Z-]*)/g)].map((m) => m[1]!));
    expect([...new Set(flags)].filter((f) => !known.has(f))).toEqual([]);
  });
});

describe("the deployment", () => {
  const vercel = JSON.parse(readFileSync(join(repo, "vercel.json"), "utf8")) as Record<string, unknown>;

  it("builds forward-core, the canvas and the CLI before the site, and serves its output", () => {
    const steps = String(vercel.buildCommand).split("&&").map((s) => s.trim());
    expect(steps).toEqual([
      "npm run build -w packages/shared",
      "npm run build -w apps/canvas",
      "npm run build -w apps/mcp",
      "npm run build -w apps/site",
    ]);
    expect(vercel.outputDirectory).toBe("apps/site/dist");
  });

  it("redirects /demo to /demo/, so the exported canvas finds its relative files", () => {
    expect(vercel.trailingSlash).toBe(true);
    expect(vercel.rewrites).toBeUndefined(); // a catch-all would swallow /demo/forward.json
  });
});

describe("the demo", () => {
  const out = mkdtempSync(join(tmpdir(), "forward-site-demo-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("is a forward export of the fictional Pantry project, with nothing from the machine that built it", async () => {
    // @ts-expect-error -- plain JS build script
    const { buildDemo } = (await import("../demo/build-demo.mjs")) as { buildDemo: (out: string, env: NodeJS.ProcessEnv) => void };
    const leak = "Ada Leakwood";
    buildDemo(join(out, "demo"), {
      ...process.env,
      FORWARD_AUTHOR: leak,
      FORWARD_AGENT: "leaky-agent",
      ADC_AGENT: "leaky-agent",
      GIT_AUTHOR_NAME: leak,
      GIT_AUTHOR_EMAIL: "ada@leak.invalid",
      GIT_COMMITTER_NAME: leak,
      GIT_COMMITTER_EMAIL: "ada@leak.invalid",
    });
    const dir = join(out, "demo");
    expect(readdirSync(dir).sort()).toEqual([".nojekyll", "THIRD_PARTY_NOTICES.txt", "assets", "forward.json", "index.html"]);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toContain('"mode":"static"');

    const raw = readFileSync(join(dir, "forward.json"), "utf8");
    for (const s of [leak, "leak.invalid", "leaky-agent", tmpdir(), repo, homedir()]) expect(raw).not.toContain(s);

    // Everyone the bundle credits is the fictional cast…
    const strings: [key: string, value: string][] = [];
    JSON.parse(raw, (key, value: unknown) => {
      if (typeof value === "string") strings.push([key, value]);
      return value;
    });
    const credited = new Set(strings.filter(([k]) => /author|^by$|email|contributor|member|uid/i.test(k)).map(([, v]) => v));
    expect([...credited].sort()).toEqual(["Maya Okafor", "Sam Reyes", "Sam Reyes via claude"]);
    // …and no value is the builder: git's identity, or the OS login forward falls back to.
    const gitConfig = (key: string) => {
      try {
        return execFileSync("git", ["config", key], { encoding: "utf8", cwd: repo }).trim();
      } catch {
        return ""; // not set on this machine
      }
    };
    const builder = [gitConfig("user.name"), gitConfig("user.email"), userInfo().username].filter(Boolean);
    const isBuilder = (v: string) => builder.some((b) => v === b || v.startsWith(`${b} via `) || (b.includes("@") && v.includes(b)));
    expect(strings.filter(([, v]) => isBuilder(v))).toEqual([]);

    const bundle = JSON.parse(raw) as { project: { name: string }; elements: unknown[]; timeline: unknown[] };
    expect(bundle.project.name).toBe("Pantry");
    expect(bundle.elements.length).toBeGreaterThan(20);
    expect(bundle.timeline.length).toBeGreaterThan(10); // History has something to show
  }, 120_000);
});
