import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { PlaywrightBrowser, PlaywrightModule } from "../playwright-run.js";
import { PROTOCOL, runJob, type JobDeps } from "./job.js";
import { captureWithCompanion, locateCompanion } from "./run.js";

const job = {
  protocol: PROTOCOL,
  url: "http://localhost:5173",
  routes: ["/", "/login"],
  viewport: { width: 800, height: 600 },
  collector: "(opts) => ({ version: 1, route: opts.route })",
};

/** A Playwright stand-in: records what it was asked, returns a status per route. */
function fakePlaywright(opts: { failLaunch?: string[] } = {}) {
  const calls: string[] = [];
  const failures = [...(opts.failLaunch ?? [])];
  const browser: PlaywrightBrowser = {
    version: () => "149.0",
    close: async () => void calls.push("close"),
    newContext: async (o) => {
      calls.push(`context ${JSON.stringify(o)}`);
      return {
        newPage: async () => ({
          goto: async (url: string) => {
            calls.push(`goto ${url}`);
            return { status: () => (url.endsWith("/login") ? 302 : 200) };
          },
          waitForLoadState: async () => {},
          waitForTimeout: async () => {},
          evaluate: async (expr: string) => {
            calls.push("evaluate");
            return { evaluated: expr.length > 0 };
          },
        }),
      };
    },
  };
  const pw: PlaywrightModule = {
    chromium: {
      launch: async () => {
        const fail = failures.shift();
        if (fail) throw new Error(fail);
        calls.push("launch");
        return browser;
      },
    },
  };
  return { pw, calls };
}

const deps = (pw: PlaywrightModule, extra: Partial<JobDeps> = {}): JobDeps & { installs: number; logs: string[] } => {
  const state = { installs: 0, logs: [] as string[] };
  return Object.assign(state, {
    loadPlaywright: async () => pw,
    installBrowser: async () => void state.installs++,
    env: {},
    log: (l: string) => void state.logs.push(l),
    version: "9.9.9",
    ...extra,
  });
};

describe("forward-capture: running a job", () => {
  it("captures every route with its status and closes the browser", async () => {
    const { pw, calls } = fakePlaywright();
    const result = await runJob(job, deps(pw));
    expect(result).toEqual({
      protocol: PROTOCOL,
      snapshots: [
        { evaluated: true, status: 200 },
        { evaluated: true, status: 302 },
      ],
      capturedWith: "forward-capture 9.9.9 (Playwright Chromium 149.0)",
    });
    expect(calls.filter((c) => c.startsWith("goto"))).toEqual(["goto http://localhost:5173/", "goto http://localhost:5173/login"]);
    expect(calls.at(-1)).toBe("close");
  });

  it("downloads the browser once when it is missing, with a notice", async () => {
    const { pw } = fakePlaywright({ failLaunch: ["browserType.launch: Executable doesn't exist at /x/chrome-headless-shell"] });
    const d = deps(pw);
    const result = await runJob(job, d);
    expect("snapshots" in result).toBe(true);
    expect(d.installs).toBe(1);
    expect(d.logs.join(" ")).toMatch(/Downloading Playwright's headless Chromium.*one time/);
  });

  it("says a download happened even when the browser then fails to start", async () => {
    const { pw } = fakePlaywright({
      failLaunch: ["Executable doesn't exist at /x", "Host system is missing dependencies to run browsers."],
    });
    const result = await runJob(job, deps(pw));
    expect(result).toEqual({ protocol: PROTOCOL, error: expect.stringMatching(/was downloaded, but didn't start: .*install-deps/) });
  });

  it("stops a download when forward goes away", async () => {
    const { pw, calls } = fakePlaywright({ failLaunch: ["Executable doesn't exist at /x"] });
    const gone = new AbortController();
    let sawSignal: AbortSignal | undefined;
    const d = deps(pw, {
      signal: gone.signal,
      installBrowser: async (signal) => {
        sawSignal = signal;
        gone.abort(); // forward disappears mid-download
      },
    });
    const result = await runJob(job, d);
    expect(sawSignal).toBe(gone.signal);
    expect(result).toEqual({ protocol: PROTOCOL, error: "Stopped: forward went away." });
    expect(calls).not.toContain("launch");
  });

  it("never downloads when told not to, and says how to fetch it", async () => {
    const { pw } = fakePlaywright({ failLaunch: ["Executable doesn't exist at /x"] });
    const d = deps(pw, { env: { FORWARD_NO_DOWNLOAD: "1" } });
    const result = await runJob(job, d);
    expect(d.installs).toBe(0);
    expect(result).toEqual({ protocol: PROTOCOL, error: expect.stringMatching(/FORWARD_NO_DOWNLOAD is set.*forward-capture@9\.9\.9 install/) });
  });

  it("explains missing system libraries instead of looping on downloads", async () => {
    const { pw } = fakePlaywright({ failLaunch: ["Host system is missing dependencies to run browsers."] });
    const d = deps(pw);
    const result = await runJob(job, d);
    expect(d.installs).toBe(0);
    expect(result).toEqual({ protocol: PROTOCOL, error: expect.stringMatching(/install-deps/) });
  });

  it("rejects a malformed job or an off-origin route before launching anything", async () => {
    const { pw, calls } = fakePlaywright();
    expect(await runJob({ ...job, protocol: 2 }, deps(pw))).toEqual({ protocol: PROTOCOL, error: expect.stringMatching(/Bad capture job at protocol/) });
    expect(await runJob(undefined, deps(pw))).toEqual({ protocol: PROTOCOL, error: expect.stringMatching(/Bad capture job/) });
    expect(await runJob({ ...job, routes: ["file:///etc/passwd"] }, deps(pw))).toEqual({
      protocol: PROTOCOL,
      error: expect.stringMatching(/is not on http:\/\/localhost:5173/),
    });
    expect(calls).toEqual([]);
  });
});

describe("forward-mcp: finding and running the companion", () => {
  const dir = mkdtempSync(join(tmpdir(), "forward-companion-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const script = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  it("uses FORWARD_CAPTURE_BIN, then the project's copy of our exact version, then npx", () => {
    expect(locateCompanion("1.2.3", dir, { FORWARD_CAPTURE_BIN: "/opt/fc/main.js" })).toMatchObject({
      file: process.execPath,
      args: ["/opt/fc/main.js", "run"],
    });
    const project = join(dir, "project");
    mkdirSync(join(project, "node_modules/forward-capture/dist"), { recursive: true });
    const manifest = (version: string) =>
      writeFileSync(
        join(project, "node_modules/forward-capture/package.json"),
        JSON.stringify({ name: "forward-capture", version, bin: { "forward-capture": "dist/main.js" } }),
      );
    manifest("1.2.3");
    expect(locateCompanion("1.2.3", project, {})).toMatchObject({
      file: process.execPath,
      args: [join(project, "node_modules/forward-capture/dist/main.js"), "run"],
    });
    // Another version speaks another protocol and pins another browser: not used.
    manifest("1.2.2");
    const npx = locateCompanion("1.2.3", project, {});
    expect(npx.args).toEqual(["--yes", "forward-capture@1.2.3", "run"]);
    expect(npx.file).toBe(process.platform === "win32" ? "npx.cmd" : "npx");
    expect(() => locateCompanion("1.2.3", project, { FORWARD_NO_DOWNLOAD: "1" })).toThrow(/FORWARD_NO_DOWNLOAD forbids fetching forward-capture/);
  });

  const run = (bin: string) =>
    captureWithCompanion({ url: "http://localhost:1", routes: ["/"], viewport: { width: 1, height: 1 } }, "c", "1.2.3", {
      env: { ...process.env, FORWARD_CAPTURE_BIN: bin },
    });

  it("sends the job on stdin and reads the result from stdout", async () => {
    const echo = script(
      "echo.mjs",
      // The protocol: the job is the first line; stdin then stays open until forward is done.
      `let s = ""; process.stdin.on("data", (d) => { s += d; if (!s.includes("\\n")) return;
         const job = JSON.parse(s.slice(0, s.indexOf("\\n")));
         process.stderr.write("progress…\\n");
         process.stdout.write(JSON.stringify({ protocol: 1, snapshots: [{ route: job.routes[0], collector: job.collector, protocol: job.protocol }], capturedWith: "echo" }) + "\\n", () => process.exit(0));
       });`,
    );
    await expect(run(echo)).resolves.toEqual({ snapshots: [{ route: "/", collector: "c", protocol: 1 }], capturedWith: "echo", notes: [] });
  });

  it("turns every way the companion can fail into a readable error", async () => {
    const reports = script("reports.mjs", `process.stdin.once("data", () => { process.stdout.write(JSON.stringify({ protocol: 1, error: "Couldn't open the app" }) + "\\n", () => process.exit(1)); });`);
    await expect(run(reports)).rejects.toThrow("Couldn't open the app");
    // What real npx prints on a version that isn't published: the cause first, boilerplate last.
    const junk = script(
      "junk.mjs",
      `process.stderr.write("npm error code E404\\nnpm error 404 Not Found - GET https://registry.npmjs.org/forward-capture - Not found\\nnpm error 404\\nnpm error 404  'forward-capture@1.2.3' is not in this registry.\\nnpm error 404\\nnpm error 404 Note that you can also install from a\\nnpm error 404 tarball, folder, http url, or git url.\\nnpm error A complete log of this run can be found in: /x/debug-0.log\\n"); process.exit(1);`,
    );
    await expect(run(junk)).rejects.toThrow(/didn't return a capture \(exit code 1\).*is not in this registry.*That version isn't on npm/);
    await expect(run(junk)).rejects.not.toThrow(/complete log|tarball, folder/);
    const offline = script("offline.mjs", `process.stderr.write("npm ERR! getaddrinfo ENOTFOUND registry.npmjs.org\\n"); process.exit(1);`);
    await expect(run(offline)).rejects.toThrow(/needs network access/);
    await expect(run(join(dir, "missing-binary"))).rejects.toThrow(/Couldn't start .*missing-binary/);
  });
});

// --- the built program, over real pipes --------------------------------------

describe("forward-capture main.js, built and run", () => {
  const dir = mkdtempSync(join(tmpdir(), "forward-companion-main-"));
  let main = "";
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // A playwright-core stand-in whose page returns a big snapshot, or never answers.
  const stub = (mode: "big" | "hang") => {
    const pkg = join(dir, mode, "node_modules", "playwright-core");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "playwright-core", version: "0.0.0", type: "module", main: "index.js" }));
    writeFileSync(
      join(pkg, "index.js"),
      `const closed = []; export const chromium = { launch: async () => ({
         version: () => "stub", close: async () => { closed.push(1); process.stderr.write("browser closed\\n"); },
         newContext: async () => ({ newPage: async () => ({
           on() {}, goto: async () => ({ status: () => 200 }), waitForLoadState: async () => {}, waitForTimeout: async () => {},
           evaluate: async () => ${mode === "big" ? `({ nodes: Array.from({ length: 6000 }, (_, i) => ({ tag: "div", text: "x".repeat(300) + i })) })` : "new Promise(() => {})"},
         }) }),
       }) };`,
    );
    return join(dir, mode);
  };

  const start = (cwd: string) => {
    const child = spawn(process.execPath, [main, "run"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (err += c));
    const closed = new Promise<number | null>((r) => child.once("close", r));
    return { child, closed, out: () => out, err: () => err };
  };

  it("builds", async () => {
    const { build } = await import("esbuild");
    for (const mode of ["big", "hang"] as const) {
      const root = stub(mode);
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "forward-capture", version: "9.9.9", type: "module" }));
      await build({
        entryPoints: [join(__dirname, "main.ts")],
        outfile: join(root, "dist", "main.js"),
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        external: ["playwright-core"],
        banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
        logLevel: "silent",
      });
    }
    main = join(dir, "big", "dist", "main.js");
  }, 60_000);

  it("returns a multi-megabyte result intact through a pipe", async () => {
    const run = start(join(dir, "big"));
    run.child.stdin.write(`${JSON.stringify({ ...job, routes: ["/"] })}\n`);
    expect(await run.closed).toBe(0);
    const result = JSON.parse(run.out().trim()) as { snapshots: Array<{ nodes: unknown[] }> };
    expect(run.out().length).toBeGreaterThan(1_500_000);
    expect(result.snapshots[0]?.nodes).toHaveLength(6000);
  }, 60_000);

  it("closes the browser and exits when forward goes away (its stdin closes)", async () => {
    main = join(dir, "hang", "dist", "main.js");
    const run = start(join(dir, "hang"));
    run.child.stdin.write(`${JSON.stringify(job)}\n`);
    await new Promise((r) => setTimeout(r, 500)); // mid-capture: the page never answers
    run.child.stdin.end();
    const code = await run.closed;
    expect(code).not.toBeNull();
    expect(run.err()).toContain("browser closed");
  }, 30_000);
});
