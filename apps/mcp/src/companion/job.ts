import { z } from "zod";
import { capturePages, checkRoutes, type PlaywrightModule } from "../playwright-run.js";

/**
 * The contract between forward-mcp and its companion package, forward-capture.
 *
 * forward-mcp stays dependency-free. When a live capture has no Playwright in
 * the project and no Chromium-based browser installed, it runs forward-capture
 * (which depends on playwright-core) at its own exact version, sends one job
 * as JSON on stdin, and reads one result as JSON on stdout. Progress (the
 * one-time browser download) goes to stderr, so stdout carries nothing else.
 *
 * The job is pure data — including the collector's source, so the companion
 * never has its own copy to drift from forward-mcp's.
 */

export const PROTOCOL = 1;

export const CaptureJob = z.object({
  protocol: z.literal(PROTOCOL),
  url: z.string().url(),
  routes: z.array(z.string().min(1)).min(1),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  storageState: z.string().optional(),
  waitMs: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** The browser-side collector function's source, evaluated in each page. */
  collector: z.string().min(1),
});
export type CaptureJob = z.infer<typeof CaptureJob>;

export type CaptureResult =
  | { protocol: typeof PROTOCOL; snapshots: unknown[]; capturedWith: string; downloadedBrowser?: boolean }
  | { protocol: typeof PROTOCOL; error: string };

/** Set to forbid every download: the npx fetch of this package and the browser. */
export const NO_DOWNLOAD_ENV = "FORWARD_NO_DOWNLOAD";

/** Whether FORWARD_NO_DOWNLOAD is on ("0", "false", "no" and empty mean off). */
export function downloadsForbidden(env: NodeJS.ProcessEnv): boolean {
  const v = env[NO_DOWNLOAD_ENV]?.trim().toLowerCase();
  return Boolean(v) && !["0", "false", "no", "off"].includes(v as string);
}

export interface JobDeps {
  loadPlaywright(): Promise<PlaywrightModule>;
  /** Download Playwright's headless Chromium (progress to stderr); stops when `signal` aborts. */
  installBrowser(signal?: AbortSignal): Promise<void>;
  env: NodeJS.ProcessEnv;
  log(line: string): void;
  version: string;
  /** Aborted when forward-mcp goes away: close the browser and stop. */
  signal?: AbortSignal;
}

const MISSING_BROWSER = /executable doesn't exist|please run the following command to download new browsers/i;
const MISSING_LIBS = /host system is missing dependencies|missing libraries|error while loading shared libraries/i;

/** Run one capture job; never throws — failures come back as `{ error }`. */
export async function runJob(input: unknown, deps: JobDeps): Promise<CaptureResult> {
  try {
    const parsed = CaptureJob.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Bad capture job${issue?.path.length ? ` at ${issue.path.join(".")}` : ""}: ${issue?.message}`);
    }
    const job = parsed.data;
    checkRoutes(job.url, job.routes);
    const pw = await deps.loadPlaywright();
    // Missing system libraries only show up once the browser exists, so the
    // launch after a download gets the same explanation.
    const launch = async () => {
      try {
        return await pw.chromium.launch({ headless: true });
      } catch (err) {
        if (MISSING_LIBS.test((err as Error).message)) {
          throw new Error(
            "Playwright's Chromium is missing system libraries on this machine. Install them once with " +
              `\`sudo npx -y forward-capture@${deps.version} install-deps\`, or capture with a browser you have ` +
              "(`forward capture --browsers`).",
          );
        }
        throw err;
      }
    };
    let browser;
    let downloadedBrowser = false;
    try {
      browser = await launch();
    } catch (err) {
      const message = (err as Error).message;
      if (!MISSING_BROWSER.test(message)) throw err;
      if (downloadsForbidden(deps.env)) {
        throw new Error(
          `Playwright's browser isn't downloaded, and ${NO_DOWNLOAD_ENV} is set. Fetch it once with ` +
            `\`npx -y forward-capture@${deps.version} install\`, or use \`forward capture --script\`.`,
        );
      }
      deps.log("Downloading Playwright's headless Chromium for live capture (one time, about 100 MB)…");
      await deps.installBrowser(deps.signal);
      if (deps.signal?.aborted) throw new Error("Stopped: forward went away.");
      downloadedBrowser = true;
      try {
        browser = await launch();
      } catch (relaunch) {
        // Don't let the report hide that 100 MB just arrived.
        throw new Error(`Playwright's headless Chromium was downloaded, but didn't start: ${(relaunch as Error).message}`);
      }
    }
    if (deps.signal?.aborted) {
      await browser.close();
      throw new Error("Stopped: forward went away.");
    }
    const launched = browser;
    deps.signal?.addEventListener("abort", () => void launched.close().catch(() => {}), { once: true });
    const version = browser.version?.();
    const snapshots = await capturePages(browser, job, job.collector);
    return {
      protocol: PROTOCOL,
      snapshots,
      capturedWith: `forward-capture ${deps.version} (Playwright Chromium${version ? ` ${version}` : ""})`,
      ...(downloadedBrowser ? { downloadedBrowser } : {}),
    };
  } catch (err) {
    return { protocol: PROTOCOL, error: (err as Error).message.split("\n")[0] ?? "Capture failed" };
  }
}
