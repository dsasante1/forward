import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { isSnap, type InstalledBrowser } from "./find.js";

/**
 * Live capture through a Chromium-based browser that is already installed,
 * over the Chrome DevTools Protocol — the same channel Playwright uses — with
 * nothing but Node built-ins.
 *
 * - The browser talks over a pipe (`--remote-debugging-pipe`, fds 3 and 4),
 *   so nothing listens on the network.
 * - It runs headless with a fresh temporary profile, so it never sees the
 *   user's own cookies, logins or extensions; the profile is deleted after.
 * - The process never outlives the capture, whatever happens.
 */

export interface Viewport {
  width: number;
  height: number;
}

/** Flags for a clean, quiet, headless run. */
export function launchArgs(userDataDir: string, viewport: Viewport, opts: { root: boolean }): string[] {
  return [
    "--headless",
    "--remote-debugging-pipe",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--hide-scrollbars",
    "--password-store=basic",
    "--use-mock-keychain",
    `--window-size=${viewport.width},${viewport.height}`,
    // Chromium refuses to start its sandbox as root (Docker, some CI); only then.
    ...(opts.root ? ["--no-sandbox"] : []),
    "about:blank",
  ];
}

/**
 * Where the temporary profile goes. A snap-packaged browser (Ubuntu) can't
 * write to /tmp, but can write to its own `~/snap/<name>/common`.
 */
export function profileBase(browserPath: string, home = homedir(), exists = existsSync): string {
  if (isSnap(browserPath)) {
    const snapHome = join(home, "snap", basename(browserPath).replace(/-browser$/, ""), "common");
    if (exists(snapHome)) return snapHome;
  }
  return tmpdir();
}

/**
 * Kill the browser and every helper process it started. On Unix the browser
 * runs in its own process group (see `detached` at spawn), so one signal to
 * the group reaches the renderer, GPU and crash-handler processes too — the
 * ones that would otherwise keep writing into the profile we're deleting.
 */
export function killBrowser(child: ChildProcess | undefined): void {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

type Message = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

/** One browser process and the pipe we talk to it over. */
class Connection {
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  private readonly listeners = new Set<(m: Message) => void>();
  private buffer = "";
  private stderr = "";
  private closed = false;
  /** Why the browser stopped, once it has. */
  failure: Error | undefined;
  readonly exited: Promise<void>;

  constructor(private readonly child: ChildProcess) {
    const out = child.stdio[4] as Readable;
    out.setEncoding("utf8");
    out.on("data", (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf("\0")) >= 0) {
        const raw = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        this.dispatch(raw);
      }
    });
    (child.stderr as Readable | null)?.setEncoding("utf8");
    (child.stderr as Readable | null)?.on("data", (c: string) => {
      this.stderr = (this.stderr + c).slice(-2000);
    });
    this.exited = new Promise((resolve) => {
      const done = (why: string) => {
        if (this.closed) return resolve();
        this.closed = true;
        const tail = this.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400);
        const err = new Error(`The browser stopped (${why}).${tail ? ` It said: ${tail}` : ""}`);
        this.failure = err;
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        resolve();
      };
      child.once("exit", (code, signal) => done(signal ? `signal ${signal}` : `exit code ${code}`));
      child.once("error", (e) => done(e.message));
      // A pipe that breaks (EPIPE when the browser dies between commands) must
      // end the capture, not crash the process with an unhandled 'error'.
      for (const stream of [child.stdio[3], child.stdio[4], child.stderr]) {
        (stream as Readable | Writable | null)?.on("error", (e: Error) => {
          done(e.message);
          killBrowser(child);
        });
      }
    });
  }

  private dispatch(raw: string): void {
    let msg: Message;
    try {
      msg = JSON.parse(raw) as Message;
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result ?? {});
      return;
    }
    for (const fn of this.listeners) fn(msg);
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The browser is not running."));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      (this.child.stdio[3] as Writable).write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  on(fn: (m: Message) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Close politely, then make sure. */
  async close(): Promise<void> {
    if (!this.closed) {
      await this.send("Browser.close", {}, undefined, 3_000).catch(() => {});
      const killed = setTimeout(() => killBrowser(this.child), 3_000);
      await this.exited;
      clearTimeout(killed);
    }
  }
}

/**
 * Resolves on the first matching event. Rejects after `ms`, when the page
 * crashes, or when the browser stops — with its own last words, not a timeout.
 */
function nextEvent(
  conn: Connection,
  match: (m: Message) => boolean,
  ms: number,
  what: string,
  sessionId?: string,
): Promise<Message> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      fn();
    };
    const off = conn.on((m) => {
      if (m.method === "Inspector.targetCrashed" && (!sessionId || m.sessionId === sessionId)) {
        finish(() => reject(new Error(`The page crashed during: ${what}`)));
      } else if (match(m)) finish(() => resolve(m));
    });
    const timer = setTimeout(() => finish(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`))), ms);
    void conn.exited.then(() => finish(() => reject(conn.failure ?? new Error("The browser stopped."))));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Playwright's storage-state file: cookies, plus localStorage per origin. */
interface StorageState {
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    /** Playwright writes a partitioned (CHIPS) cookie's top-level site as a string. */
    partitionKey?: string | { topLevelSite: string; hasCrossSiteAncestor?: boolean };
    _crHasCrossSiteAncestor?: boolean;
  }>;
  origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
}

/**
 * A storage-state cookie as CDP's CookieParam — the fields it accepts, in the
 * shapes it wants (Playwright stores a partition key as a plain string).
 */
export function toCookieParam(c: NonNullable<StorageState["cookies"]>[number]): Record<string, unknown> {
  const out: Record<string, unknown> = { name: c.name, value: c.value };
  for (const k of ["domain", "path", "httpOnly", "secure", "sameSite"] as const) if (c[k] !== undefined) out[k] = c[k];
  if (typeof c.expires === "number" && c.expires > 0) out.expires = c.expires;
  if (typeof c.partitionKey === "string") {
    out.partitionKey = { topLevelSite: c.partitionKey, hasCrossSiteAncestor: Boolean(c._crHasCrossSiteAncestor) };
  } else if (c.partitionKey && typeof c.partitionKey === "object") {
    out.partitionKey = { topLevelSite: c.partitionKey.topLevelSite, hasCrossSiteAncestor: Boolean(c.partitionKey.hasCrossSiteAncestor) };
  }
  return out;
}

async function readStorageState(path: string): Promise<StorageState> {
  try {
    const state = JSON.parse(await readFile(path, "utf8")) as StorageState;
    if (typeof state !== "object" || state === null) throw new Error("not an object");
    return state;
  } catch (err) {
    throw new Error(`Couldn't read the login state ${path}: ${(err as Error).message}`);
  }
}

export interface BrowserCaptureOptions {
  browser: InstalledBrowser;
  url: string;
  routes: string[];
  viewport: Viewport;
  /** The collector function source; evaluated as `(source)(opts)` in each page. */
  collector: string;
  storageState?: string;
  waitMs?: number;
  /** Per-route page-load limit (default 30s). */
  timeoutMs?: number;
}

/**
 * Capture each route with an installed Chromium-based browser. Returns the
 * snapshots (with the page's HTTP status) and the browser's product string.
 */
export async function captureWithBrowser(
  opts: BrowserCaptureOptions,
): Promise<{ snapshots: unknown[]; product: string }> {
  const base = new URL(opts.url);
  const state = opts.storageState ? await readStorageState(opts.storageState) : undefined;
  const profile = await mkdtemp(join(profileBase(opts.browser.path), "forward-browser-"));
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  let conn: Connection | undefined;
  let child: ChildProcess | undefined;
  // Ctrl-C, or an MCP host stopping the server, skips `finally`: kill the
  // browser and delete the profile (it may hold login cookies) on the way out.
  // Ctrl-C, or an MCP host stopping the server, skips `finally`: kill the
  // browser and delete the profile (it may hold login cookies) on the way out.
  const removeProfileSync = () => {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // best effort on the way out
    }
  };
  // `process.exit()` (the CLI, an MCP host) runs only synchronous handlers.
  const onExit = () => {
    killBrowser(child);
    removeProfileSync();
  };
  const onSignal = (signal: NodeJS.Signals) => {
    // Keep the synchronous exit hook until we're done: the capture now fails
    // (its browser is gone) and the CLI may call process.exit() before this does.
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    killBrowser(child);
    // Give the killed processes a moment to let go of their files, then clean
    // up and end the way the signal would have.
    const gone = conn ? conn.exited : Promise.resolve();
    void Promise.race([gone, sleep(3_000)])
      .then(() => sleep(100))
      .then(() => rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
      .catch(() => {})
      .finally(() => {
        unhook();
        process.kill(process.pid, signal);
      });
  };
  const unhook = () => {
    process.off("exit", onExit);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  process.on("exit", onExit);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    child = spawn(opts.browser.path, launchArgs(profile, opts.viewport, { root }), {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      // Its own process group (Unix), so the whole browser can be killed at once
      // and a Ctrl-C in the terminal reaches us, not the browser, first.
      detached: process.platform !== "win32",
    });
    conn = new Connection(child);
    const c = conn;
    const { product } = await c.send<{ product: string }>("Browser.getVersion", {}, undefined, 20_000).catch((err: Error) => {
      throw new Error(
        `Couldn't start ${opts.browser.name} (${opts.browser.path}): ${err.message} ` +
          "If it's managed by your organisation, remote debugging may be blocked; use `forward capture --script` instead.",
      );
    });

    const { targetId } = await c.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await c.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const s = <T = any>(method: string, params: object = {}, ms?: number) => c.send<T>(method, params, sessionId, ms);
    await s("Page.enable");
    await s("Network.enable");
    await s("Emulation.setDeviceMetricsOverride", {
      width: opts.viewport.width,
      height: opts.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    if (state?.cookies?.length) {
      await s("Network.setCookies", { cookies: state.cookies.map(toCookieParam) });
    }
    const storage = Object.fromEntries(
      (state?.origins ?? []).map((o) => [o.origin, (o.localStorage ?? []).map((i) => [i.name, i.value])]),
    );
    let seedScript: string | undefined;
    if (Object.keys(storage).length) {
      // Seed localStorage before any page script runs, for the matching origin
      // only — and only for the first page, as Playwright does, so an app that
      // rotates a token on one route doesn't get the stale one back on the next.
      ({ identifier: seedScript } = await s<{ identifier: string }>("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { const all = ${JSON.stringify(storage)}; const items = all[location.origin];
          if (items) for (const [k, v] of items) { try { localStorage.setItem(k, v); } catch {} } })();`,
      }));
    }

    // An alert/confirm/prompt blocks the page until answered: dismiss it, as
    // Playwright does (accepting only "leave this page?").
    await s("Inspector.enable");
    c.on((m) => {
      if (m.sessionId === sessionId && m.method === "Page.javascriptDialogOpening") {
        void s("Page.handleJavaScriptDialog", { accept: m.params?.type === "beforeunload" }).catch(() => {});
      }
    });

    // Requests in flight, for "the page has settled". Long-lived streams never finish.
    const inflight = new Set<string>();
    let lastActivity = Date.now();
    // A document's response can arrive before Page.navigate returns its
    // loaderId, so remember every document's status by loader.
    const documentStatus = new Map<string, number>();
    c.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === "Network.responseReceived" && m.params?.type === "Document" && m.params.loaderId) {
        documentStatus.set(m.params.loaderId, m.params.response?.status);
      }
      if (m.method === "Network.requestWillBeSent") {
        if (m.params?.type !== "EventSource" && m.params?.type !== "WebSocket") inflight.add(m.params.requestId);
        lastActivity = Date.now();
      } else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") {
        inflight.delete(m.params.requestId);
        lastActivity = Date.now();
      }
    });

    const snapshots: unknown[] = [];
    for (const route of opts.routes) {
      const target = new URL(route, base).toString();
      inflight.clear();
      const loaded = nextEvent(
        c,
        (m) => m.sessionId === sessionId && m.method === "Page.loadEventFired",
        opts.timeoutMs ?? 30_000,
        `Loading ${target}`,
        sessionId,
      );
      loaded.catch(() => {}); // a same-document navigation never fires it
      const nav = await s<{ loaderId?: string; errorText?: string }>("Page.navigate", { url: target });
      if (nav.errorText) throw new Error(`Couldn't open ${target}: ${nav.errorText}. Is the app running?`);
      const loaderId = nav.loaderId;
      // Without a loaderId the URL only changed its #hash: there is no new document to wait for.
      if (loaderId) await loaded;
      if (seedScript) {
        await s("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedScript }).catch(() => {});
        seedScript = undefined;
      }
      // Let client-side rendering and data fetching settle: 500ms with no
      // requests in flight, for at most 5s — a page that polls is taken as it stands.
      const until = Date.now() + 5_000;
      while (Date.now() < until && (inflight.size > 0 || Date.now() - lastActivity < 500)) await sleep(50);
      if (opts.waitMs) await sleep(opts.waitMs);
      const status = loaderId ? documentStatus.get(loaderId) : undefined;

      const res = await s<{ result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
        "Runtime.evaluate",
        { expression: `(${opts.collector})(${JSON.stringify({ route })})`, returnByValue: true, awaitPromise: true },
        60_000,
      );
      if (res.exceptionDetails) {
        const why = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "unknown error";
        throw new Error(`Capturing ${target} failed in the page: ${why.split("\n")[0]}`);
      }
      const value = res.result?.value;
      if (!value || typeof value !== "object") throw new Error(`Capturing ${target} returned nothing.`);
      snapshots.push({ ...(value as object), ...(typeof status === "number" ? { status } : {}) });
    }
    return { snapshots, product };
  } finally {
    await conn?.close();
    unhook();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((err: Error) => {
      // Not fatal, but the profile can hold login cookies: say where it is.
      console.error(`[forward] couldn't delete the temporary browser profile ${profile}: ${err.message}`);
    });
  }
}
