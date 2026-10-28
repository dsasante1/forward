import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaptureSnapshot } from "forward-core";
import { COLLECTOR_SOURCE, captureLive } from "../capture.js";
import { captureWithBrowser, launchArgs, profileBase, toCookieParam } from "./cdp.js";
import { findBrowsers, resolveBrowser } from "./find.js";

const only = (paths: string[]) => (p: string) => paths.includes(p);

describe("finding installed browsers", () => {
  it("finds Chromium-based browsers on PATH (Linux), preferring non-snap builds", () => {
    const found = findBrowsers({
      platform: "linux",
      env: { PATH: "/snap/bin:/usr/bin" },
      isExecutable: only(["/snap/bin/chromium", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser"]),
    });
    expect(found.map((b) => [b.id, b.path])).toEqual([
      ["edge", "/usr/bin/microsoft-edge"],
      ["brave", "/usr/bin/brave-browser"],
      ["chromium", "/snap/bin/chromium"],
    ]);
  });

  it("knows the macOS and Windows install locations", () => {
    const mac = findBrowsers({
      platform: "darwin",
      env: { HOME: "/Users/ada" },
      isExecutable: only(["/Users/ada/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]),
    });
    expect(mac).toEqual([{ id: "chrome", name: "Google Chrome", path: "/Users/ada/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }]);
    const win = findBrowsers({
      platform: "win32",
      env: { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
      isExecutable: only(["C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]),
    });
    expect(win.map((b) => b.id)).toEqual(["edge"]);
  });

  it("resolves --browser and explains every way it can't", () => {
    const opts = { platform: "linux" as const, env: { PATH: "/usr/bin" }, isExecutable: only(["/usr/bin/chromium"]) };
    expect(resolveBrowser("auto", opts).id).toBe("chromium");
    expect(resolveBrowser(undefined, opts).id).toBe("chromium");
    expect(resolveBrowser("chromium", opts).path).toBe("/usr/bin/chromium");
    expect(() => resolveBrowser("firefox", opts)).toThrow(/Firefox can't be driven.*forward capture --script/);
    expect(() => resolveBrowser("Safari", opts)).toThrow(/Safari can't be driven/);
    expect(() => resolveBrowser("chrome", opts)).toThrow(/Google Chrome isn't installed.*Found: chromium/);
    expect(() => resolveBrowser("netscape", opts)).toThrow(/Unknown browser "netscape"/);
    expect(() => resolveBrowser("/nowhere/chrome", opts)).toThrow(/No runnable browser at \/nowhere\/chrome/);
    const none = { ...opts, isExecutable: () => false };
    expect(() => resolveBrowser("auto", none)).toThrow(/No Chromium-based browser found.*FORWARD_BROWSER.*forward capture --script/);
    // FORWARD_BROWSER sets the default.
    const withEnv = (FORWARD_BROWSER: string) => ({ ...opts, env: { ...opts.env, FORWARD_BROWSER } });
    expect(resolveBrowser("auto", withEnv("chromium")).id).toBe("chromium");
    expect(() => resolveBrowser("auto", withEnv("firefox"))).toThrow(/Firefox can't be driven/);
    // An explicit choice beats the environment.
    expect(resolveBrowser("chromium", withEnv("firefox")).id).toBe("chromium");
  });
});

describe("custom browser paths", () => {
  const unix = process.platform !== "win32";
  const dir = mkdtempSync(join(tmpdir(), "forward-paths-"));
  const script = (name: string, says: string) => {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\necho "${says}"\n`);
    chmodSync(p, 0o755);
    return p;
  };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!unix)("refuses Firefox and Safari by name, and anything that isn't a Chromium browser by what it says", () => {
    expect(() => resolveBrowser(script("firefox", "Mozilla Firefox 130.0"))).toThrow(/Firefox can't be driven.*forward capture --script/);
    expect(() => resolveBrowser(script("Safari", "x"))).toThrow(/Safari can't be driven/);
    expect(() => resolveBrowser(script("ff-nightly", "Mozilla Firefox 131.0a1"))).toThrow(/is Mozilla Firefox 131.0a1, which can't be driven/);
    expect(() => resolveBrowser(script("tool", "hello"))).toThrow(/doesn't look like a Chromium-based browser \(it says: hello\)/);
    expect(resolveBrowser(script("my-chrome", "Google Chrome 156.0.8078.47")).id).toBe("custom");
  });
});

describe("login state", () => {
  it("maps Playwright's cookies to what the browser accepts, including partitioned ones", () => {
    expect(
      toCookieParam({ name: "a", value: "1", domain: "x.test", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None", partitionKey: "https://top.test", _crHasCrossSiteAncestor: true }),
    ).toEqual({ name: "a", value: "1", domain: "x.test", path: "/", httpOnly: true, secure: true, sameSite: "None", partitionKey: { topLevelSite: "https://top.test", hasCrossSiteAncestor: true } });
    expect(toCookieParam({ name: "b", value: "2", expires: 1900000000 })).toEqual({ name: "b", value: "2", expires: 1900000000 });
  });
});

describe("launching", () => {
  it("talks over a pipe, uses a throwaway profile, and drops the sandbox only as root", () => {
    const args = launchArgs("/tmp/p", { width: 390, height: 844 }, { root: false });
    expect(args).toEqual(expect.arrayContaining(["--headless", "--remote-debugging-pipe", "--user-data-dir=/tmp/p", "--window-size=390,844"]));
    expect(args.some((a) => a.startsWith("--remote-debugging-port"))).toBe(false);
    expect(args).not.toContain("--no-sandbox");
    expect(launchArgs("/tmp/p", { width: 1, height: 1 }, { root: true })).toContain("--no-sandbox");
  });

  it("puts a snap browser's profile where the snap can write", () => {
    expect(profileBase("/snap/bin/chromium", "/home/ada", (p) => p === "/home/ada/snap/chromium/common")).toBe(
      "/home/ada/snap/chromium/common",
    );
    expect(profileBase("/usr/bin/google-chrome", "/home/ada", () => true)).toBe(tmpdir());
  });

  it("reports a browser that won't start, and leaves no profile behind", async () => {
    if (process.platform === "win32" || !existsSync("/bin/false")) return;
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith("forward-browser-")).length;
    await expect(
      captureWithBrowser({
        browser: { id: "custom", name: "false", path: "/bin/false" },
        url: "http://127.0.0.1:1",
        routes: ["/"],
        viewport: { width: 100, height: 100 },
        collector: COLLECTOR_SOURCE,
      }),
    ).rejects.toThrow(/Couldn't start false/);
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith("forward-browser-")).length).toBe(before);
  });

  it.skipIf(process.platform === "win32")("fails cleanly on a browser that never answers — no crash, no profile left", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forward-hang-"));
    const fake = join(dir, "hangs");
    writeFileSync(fake, "#!/bin/sh\nexec sleep 1000\n");
    chmodSync(fake, 0o755);
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith("forward-browser-")).length;
    try {
      await expect(
        captureWithBrowser({
          browser: { id: "custom", name: "hangs", path: fake },
          url: "http://127.0.0.1:1",
          routes: ["/"],
          viewport: { width: 100, height: 100 },
          collector: COLLECTOR_SOURCE,
          startTimeoutMs: 2_000,
        }),
      ).rejects.toThrow(/Couldn't start hangs \(.*\): Browser\.getVersion timed out after 2s\. /);
      expect(readdirSync(tmpdir()).filter((f) => f.startsWith("forward-browser-")).length).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it("falls back to an installed browser when the project's Playwright can't start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forward-brokenpw-"));
    mkdirSync(join(dir, "node_modules/playwright"), { recursive: true });
    writeFileSync(join(dir, "node_modules/playwright/package.json"), JSON.stringify({ name: "playwright", main: "index.js" }));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", devDependencies: { playwright: "1.61.1" } }));
    writeFileSync(
      join(dir, "node_modules/playwright/index.js"),
      "exports.chromium = { launch: async () => { throw new Error(\"browserType.launch: Executable doesn't exist\"); } };",
    );
    const cwd = process.cwd();
    // Never fetch the companion (or a browser) from a unit test.
    const prevNoDownload = process.env.FORWARD_NO_DOWNLOAD;
    try {
      process.chdir(dir);
      process.env.FORWARD_NO_DOWNLOAD = "1";
      const attempt = captureLive({ url: "http://127.0.0.1:1", routes: ["/"], viewport: { width: 100, height: 100 } });
      // Either an installed browser took over (and found nothing listening),
      // or none is installed and the message says why Playwright wasn't used.
      await expect(attempt).rejects.toThrow(
        installed ? /Couldn't open http:\/\/127\.0\.0\.1:1\// : /The project's Playwright couldn't start: browserType\.launch/,
      );
    } finally {
      if (prevNoDownload === undefined) delete process.env.FORWARD_NO_DOWNLOAD;
      else process.env.FORWARD_NO_DOWNLOAD = prevNoDownload;
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);

  it("refuses off-origin routes before starting anything, and uses the companion when the project has no Playwright", async () => {
    await expect(
      captureLive({ url: "http://localhost:1", routes: ["file:///etc/passwd"], viewport: { width: 1, height: 1 }, browser: "chrome" }),
    ).rejects.toThrow(/is not on http:\/\/localhost:1/);
    // `--browser playwright` with no Playwright in the project goes to the
    // companion (here a stand-in that reports itself).
    const dir = mkdtempSync(join(tmpdir(), "forward-nopw-"));
    const fake = join(dir, "companion.mjs");
    writeFileSync(
      fake,
      `process.stdin.once("data", () => { process.stdout.write(JSON.stringify({ protocol: 1, snapshots: [], capturedWith: "stand-in companion" }) + "\\n", () => process.exit(0)); });`,
    );
    const cwd = process.cwd();
    const prev = process.env.FORWARD_CAPTURE_BIN;
    try {
      process.chdir(dir);
      process.env.FORWARD_CAPTURE_BIN = fake;
      const res = await captureLive({ url: "http://localhost:1", routes: ["/"], viewport: { width: 1, height: 1 }, browser: "playwright" });
      expect(res.capturedWith).toBe("stand-in companion");
    } finally {
      process.chdir(cwd);
      if (prev === undefined) delete process.env.FORWARD_CAPTURE_BIN;
      else process.env.FORWARD_CAPTURE_BIN = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- against a real installed browser (skipped when there is none) ---------

const installed = findBrowsers()[0];

describe.skipIf(!installed)(`live capture with ${installed?.name ?? "an installed browser"}`, () => {
  let server: Server;
  let base = "";
  const dir = mkdtempSync(join(tmpdir(), "forward-cdp-test-"));
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/alert") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><body><h1>Alerted</h1><script>alert('Session expired'); confirm('Sure?');</script></body>");
        return;
      }
      if (req.url === "/missing") {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<!doctype html><body><h1>Not here</h1></body>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      // The page shows what the capture sent it: a cookie and a localStorage item.
      res.end(`<!doctype html><body style="margin:0;background:#fafafa">
        <button data-testid="go" style="background:#2563eb;color:#fff;border:0;width:120px;height:40px">Go</button>
        <p id="cookie"></p><p id="storage"></p>
        <script>
          document.getElementById("cookie").textContent = "cookie:" + (document.cookie || "none");
          document.getElementById("storage").textContent = "storage:" + (localStorage.getItem("token") || "none");
        </script></body>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("captures routes with their status, logged in, then cleans up", async (ctx) => {
    const state = join(dir, "state.json");
    writeFileSync(
      state,
      JSON.stringify({
        cookies: [{ name: "session", value: "abc", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }],
        origins: [{ origin: base, localStorage: [{ name: "token", value: "xyz" }] }],
      }),
    );
    const profilesBefore = readdirSync(tmpdir()).filter((f) => f.startsWith("forward-browser-")).length;
    let result: Awaited<ReturnType<typeof captureWithBrowser>>;
    try {
      result = await captureWithBrowser({
        browser: installed!,
        url: base,
        routes: ["/", "/missing", "/#/hash-route", "/alert"],
        viewport: { width: 800, height: 600 },
        collector: COLLECTOR_SOURCE,
        storageState: state,
      });
    } catch (err) {
      // Some CI kernels forbid the browser's sandbox; that is the machine, not the code.
      if (/sandbox|namespace/i.test((err as Error).message)) return ctx.skip();
      throw err;
    }
    const [home, missing, hashed, alerted] = result.snapshots.map((s) => CaptureSnapshot.parse(s));
    expect(JSON.stringify(alerted?.root)).toContain("Alerted"); // dialogs dismissed, not hung
    expect(result.product).toMatch(/Chrome|Chromium|Edg|Brave|Vivaldi|Opera|HeadlessChrome/);
    expect(home?.status).toBe(200);
    expect(home?.viewport).toEqual({ width: 800, height: 600 });
    expect(missing?.status).toBe(404);
    expect(hashed?.route).toBe("/#/hash-route"); // same-document navigation didn't hang
    const texts = JSON.stringify(home?.root);
    expect(texts).toContain("cookie:session=abc");
    expect(texts).toContain("storage:xyz");
    expect(texts).toContain('"testid":"go"');
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith("forward-browser-")).length).toBe(profilesBefore);
  }, 120_000);
});
