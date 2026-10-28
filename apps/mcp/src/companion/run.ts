import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PageJob } from "../playwright-run.js";
import { NO_DOWNLOAD_ENV, PROTOCOL, downloadsForbidden, type CaptureJob, type CaptureResult } from "./job.js";

/**
 * forward-mcp's side of the companion: find forward-capture at exactly our
 * version, give it one job, and read back its result (see job.ts).
 *
 * Where it comes from, in order:
 *   1. `$FORWARD_CAPTURE_BIN` — an explicit companion (tests, air-gapped setups);
 *   2. a copy installed in the project, if it is our version;
 *   3. `npx -y forward-capture@<our version>` — fetched once into npm's cache.
 * `$FORWARD_NO_DOWNLOAD` rules out 3 (and the browser download inside it).
 */

export const COMPANION = "forward-capture";

interface Command {
  file: string;
  args: string[];
  shell: boolean;
  /** For the report, and for errors. */
  label: string;
  /** Fetched from npm on first use (npx). */
  fetched?: boolean;
}

/** How to start the companion, or a readable reason it can't be. */
export function locateCompanion(version: string, cwd = process.cwd(), env = process.env): Command {
  const explicit = env.FORWARD_CAPTURE_BIN?.trim();
  if (explicit) {
    const js = /\.(c|m)?js$/.test(explicit);
    return { file: js ? process.execPath : explicit, args: js ? [explicit, "run"] : ["run"], shell: false, label: explicit };
  }
  try {
    const manifestPath = createRequire(join(cwd, "package.json")).resolve(`${COMPANION}/package.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string; bin?: Record<string, string> | string };
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[COMPANION];
    // Only our exact version speaks our protocol and pins our browser build.
    if (manifest.version === version && bin) {
      return { file: process.execPath, args: [join(dirname(manifestPath), bin), "run"], shell: false, label: `${COMPANION}@${version} (project)` };
    }
  } catch {
    // not installed in the project
  }
  if (downloadsForbidden(env)) {
    throw new Error(
      `Live capture needs Playwright, a Chromium-based browser, or ${COMPANION}, and ${NO_DOWNLOAD_ENV} forbids fetching ` +
        `${COMPANION}. Install one (e.g. \`npm i -D ${COMPANION}@${version}\`), or use \`forward capture --script\`.`,
    );
  }
  // A build that couldn't read its own version, or a prerelease, was never
  // published: don't ask npm for it.
  if (!/^\d+\.\d+\.\d+$/.test(version) || version === "0.0.0") {
    throw new Error(
      `This forward (version ${version}) has no published ${COMPANION} to fetch. Install a matching one in the ` +
        "project, set FORWARD_CAPTURE_BIN, add Playwright to the project, or use `forward capture --script`.",
    );
  }
  const spec = `${COMPANION}@${version}`;
  // npx is a .cmd script on Windows, which Node only runs through a shell; the
  // command is fixed (our own version), so nothing user-supplied reaches it.
  if (process.platform === "win32") {
    return { file: `npx.cmd --yes ${spec} run`, args: [], shell: true, label: `npx ${spec}`, fetched: true };
  }
  return { file: "npx", args: ["--yes", spec, "run"], shell: false, label: `npx ${spec}`, fetched: true };
}

export interface CompanionCapture {
  snapshots: unknown[];
  capturedWith: string;
  /** What was downloaded on the way, for the report. */
  notes: string[];
}

/**
 * Kill the companion and everything under it. Through npx it runs as
 * npx → sh → node, and npm passes signals only to the shell, so the whole
 * process group (Unix) or tree (Windows) has to go. Closing its stdin, which
 * the caller also does, reaches it in every case.
 */
function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      // If taskkill itself can't start, fall back rather than crash on an unhandled 'error'.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill());
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }
}

/** Run one capture job through the companion. */
export async function captureWithCompanion(
  job: PageJob,
  collector: string,
  version: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CompanionCapture> {
  const env = opts.env ?? process.env;
  const cmd = locateCompanion(version, opts.cwd, env);
  const payload: CaptureJob = { protocol: PROTOCOL, ...job, collector };

  if (cmd.fetched) {
    process.stderr.write(
      `[forward] Live capture needs Playwright here: running ${cmd.label} ` +
        "(fetched from npm on first use; it may then download a headless Chromium once, about 100 MB).\n",
    );
  }
  let child: ChildProcess;
  try {
    child = spawn(cmd.file, cmd.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: cmd.shell,
      env,
      // Its own process group (Unix), so it can be stopped as a whole.
      detached: process.platform !== "win32",
    });
  } catch (err) {
    throw new Error(`Couldn't start ${cmd.label}: ${(err as Error).message}`);
  }
  const stop = () => {
    child.stdin?.destroy(); // the companion stops when its input closes
    killTree(child);
  };

  // Stopping forward (Ctrl-C, an MCP host) stops the companion, whose
  // Playwright then closes its browser.
  const forward = (signal: NodeJS.Signals) => {
    stop();
    unhook();
    process.kill(process.pid, signal);
  };
  const onExit = stop;
  const unhook = () => {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
    process.off("exit", onExit);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  process.on("exit", onExit);

  let stdout = "";
  let stderrTail = "";
  child.stdout?.setEncoding("utf8").on("data", (c: string) => (stdout += c));
  child.stderr?.setEncoding("utf8").on("data", (c: string) => {
    stderrTail = (stderrTail + c).slice(-2000);
    // Progress (the one-time browser download) is worth seeing; our own stdout
    // may be the MCP channel, so it goes to stderr.
    process.stderr.write(c);
  });
  child.stdin?.on("error", () => {}); // a companion that exits early closes it
  // One line, and the pipe stays open: closing it is how we say "stop".
  child.stdin?.write(`${JSON.stringify(payload)}\n`);

  const limit = opts.timeoutMs ?? 20 * 60_000;
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error(`${cmd.label} took longer than ${Math.round(limit / 60_000)} minutes.`));
      }, limit);
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Couldn't start ${cmd.label}: ${err.message}.` +
              (cmd.file.startsWith("npx") ? " Is npm installed and on PATH?" : ""),
          ),
        );
      });
      // 'close', not 'exit': only then has all of its stdout arrived.
      child.once("close", (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });

    const last = stdout.trim().split("\n").pop() ?? "";
    let result: CaptureResult | undefined;
    try {
      result = JSON.parse(last) as CaptureResult;
    } catch {
      result = undefined;
    }
    if (result && "error" in result) throw new Error(result.error);
    if (result && result.protocol === PROTOCOL && Array.isArray(result.snapshots)) {
      const notes = [
        ...(cmd.fetched ? [`Live capture ran ${cmd.label}, fetched from npm (cached for next time).`] : []),
        ...(result.downloadedBrowser ? ["Playwright's headless Chromium was downloaded once (about 100 MB) for live capture."] : []),
      ];
      return { snapshots: result.snapshots, capturedWith: result.capturedWith, notes };
    }
    // npm ends with boilerplate ("A complete log of this run…", "Note that you
    // can also install from…"); keep the lines that say what went wrong.
    const lines = stderrTail.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const telling = lines.filter(
      (l) => !/complete log of this run|note that you can also install|tarball, folder, http url|^npm (error|ERR!)( 404)?$/i.test(l),
    );
    const said = telling.slice(-3).join(" ").slice(0, 400);
    const missing = /E404|404 Not Found|is not in this registry/i.test(stderrTail);
    const offline = !missing && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network/i.test(stderrTail);
    throw new Error(
      `${cmd.label} didn't return a capture (exit code ${code}).` +
        (said ? ` It said: ${said}` : "") +
        (missing ? ` That version isn't on npm; install a matching ${COMPANION} or use \`forward capture --script\`.` : "") +
        (offline ? " Fetching it needs network access; or use `forward capture --script`." : ""),
    );
  } finally {
    unhook();
    child.stdin?.destroy();
  }
}
