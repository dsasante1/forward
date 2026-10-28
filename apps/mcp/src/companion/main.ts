#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PlaywrightModule } from "../playwright-run.js";
import { VERSION } from "../version.js";
import { runJob } from "./job.js";

/**
 * forward-capture — live capture with Playwright, for forward-mcp.
 *
 *   forward-capture run           one job as JSON on stdin → one result as JSON on stdout
 *   forward-capture install       download Playwright's headless Chromium now
 *   forward-capture install-deps  install its system libraries (Linux; needs sudo)
 *   forward-capture --version
 *
 * People don't normally run this: `forward capture` starts it when a capture
 * has nothing else to use. It is its own package so forward-mcp stays free of
 * dependencies; this one has exactly one, playwright-core.
 */

const require = createRequire(import.meta.url);

/** playwright-core's own CLI, which knows how to fetch its browsers. */
function playwrightCli(): string {
  return join(dirname(require.resolve("playwright-core/package.json")), "cli.js");
}

/**
 * Run playwright-core's CLI with its output on our stderr (stdout is the
 * result channel). An abort (forward went away) stops it — no download keeps
 * running for nobody.
 */
function runPlaywrightCli(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli(), ...args], { stdio: ["ignore", process.stderr, process.stderr] });
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new Error(signal?.aborted ? "Stopped: forward went away." : `playwright ${args.join(" ")} exited with ${code}`));
    });
  });
}

const installBrowser = (signal?: AbortSignal) => runPlaywrightCli(["install", "--only-shell", "chromium"], signal);

/**
 * The job is the first line on stdin. forward-mcp then keeps stdin open for as
 * long as it wants the capture: when it goes away — exits, is killed, gives up
 * — the pipe closes, which reaches us even through npx and the shell it runs
 * us under (signals don't). So end of input after the job means "stop now".
 */
function readJob(onGone: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let got = false;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => {
      if (got) return;
      data += c;
      const nl = data.indexOf("\n");
      if (nl >= 0) {
        got = true;
        resolve(data.slice(0, nl));
      }
    });
    const end = () => (got ? onGone() : resolve(data));
    process.stdin.once("end", end);
    process.stdin.once("close", end);
    process.stdin.on("error", (e) => (got ? onGone() : reject(e)));
  });
}

/** Write all of `text` to stdout before exiting: a pipe write is asynchronous. */
function writeThenExit(text: string, code: number): void {
  process.stdout.write(text, () => process.exit(code));
}

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  switch (cmd) {
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case "install":
      await installBrowser(undefined);
      return 0;
    case "install-deps":
      await runPlaywrightCli(["install-deps", "chromium"]);
      return 0;
    case "run": {
      const gone = new AbortController();
      // The parent is gone: close the browser (runJob listens) and leave.
      const onGone = () => {
        if (gone.signal.aborted) return;
        gone.abort();
        setTimeout(() => process.exit(2), 5_000).unref();
      };
      let job: unknown;
      try {
        job = JSON.parse(await readJob(onGone));
      } catch {
        job = undefined;
      }
      const result = await runJob(job, {
        signal: gone.signal,
        // A variable specifier: resolved at runtime next to this package, never bundled.
        loadPlaywright: async () => {
          const name = "playwright-core";
          const mod = (await import(name)) as PlaywrightModule & { default?: PlaywrightModule };
          return mod.chromium ? mod : (mod.default as PlaywrightModule);
        },
        installBrowser,
        env: process.env,
        log: (line) => process.stderr.write(`${line}\n`),
        version: VERSION,
      });
      writeThenExit(`${JSON.stringify(result)}\n`, "error" in result ? 1 : 0);
      return new Promise<number>(() => {}); // writeThenExit ends the process
    }
    default:
      process.stderr.write(
        "forward-capture: live capture with Playwright, for forward-mcp (`forward capture` runs it).\n" +
          `${cmd ? `Unknown command "${cmd}". ` : ""}Usage: forward-capture run | install | install-deps | --version\n`,
      );
      return cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    process.stderr.write(`forward-capture: ${err.message}\n`);
    process.exit(1);
  },
);
