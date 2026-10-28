/**
 * The Playwright capture loop, shared by forward-mcp (a project that has
 * Playwright) and the forward-capture companion package (which brings its
 * own). Typed structurally, so neither needs Playwright's types to build.
 */

export interface PlaywrightPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
  waitForLoadState(state: string, opts: { timeout: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  on?(event: "dialog", handler: (dialog: { dismiss(): Promise<void> }) => void): unknown;
}

export interface PlaywrightBrowser {
  newContext(opts: Record<string, unknown>): Promise<{ newPage(): Promise<PlaywrightPage> }>;
  close(): Promise<void>;
  version?(): string;
}

export interface PlaywrightModule {
  chromium: {
    launch(opts?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  };
}

export interface PageJob {
  /** Base URL of the running app. */
  url: string;
  routes: string[];
  viewport: { width: number; height: number };
  /** Storage-state file (cookies + localStorage), for pages behind a login. */
  storageState?: string;
  waitMs?: number;
  /** Per-route page-load limit (default 30s). */
  timeoutMs?: number;
}

/** Throws unless every route stays on the base URL's origin (and that is http(s)). */
export function checkRoutes(url: string, routes: string[]): URL {
  const base = new URL(url);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error(`Capture URL must be http(s), got ${base.protocol}`);
  }
  // A route is a path on the app; an absolute one (file://, another host,
  // chrome://) could pull a local file or another site into .forward/.
  for (const route of routes) {
    if (new URL(route, base).origin !== base.origin) {
      throw new Error(`Route "${route}" is not on ${base.origin}; give paths like /login.`);
    }
  }
  return base;
}

/**
 * Capture each route with an already-launched Playwright browser, running
 * `collector` (the browser-side collector's source) in each page. Closes the
 * browser when done, whatever happens.
 */
export async function capturePages(browser: PlaywrightBrowser, job: PageJob, collector: string): Promise<unknown[]> {
  const base = checkRoutes(job.url, job.routes);
  try {
    const context = await browser.newContext({
      viewport: job.viewport,
      ...(job.storageState ? { storageState: job.storageState } : {}),
    });
    const page = await context.newPage();
    // An alert/confirm/prompt would block the page: dismiss it (Playwright's default too).
    page.on?.("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
    const out: unknown[] = [];
    for (const route of job.routes) {
      const response = await page.goto(new URL(route, base).toString(), {
        waitUntil: "load",
        timeout: job.timeoutMs ?? 30_000,
      });
      // Let client-side rendering and data fetching settle; a page that never
      // goes idle (polling, websockets) is captured as it stands.
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      if (job.waitMs) await page.waitForTimeout(job.waitMs);
      // A page stuck in a loop never answers: give up rather than hang forever.
      let timer: NodeJS.Timeout | undefined;
      const snapshot = (await Promise.race([
        page.evaluate(`(${collector})(${JSON.stringify({ route })})`),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Capturing ${route} timed out after 60s (is the page stuck?)`)), 60_000);
        }),
      ]).finally(() => clearTimeout(timer))) as Record<string, unknown>;
      const status = (response as { status?: () => number } | null)?.status?.();
      out.push({ ...snapshot, ...(typeof status === "number" ? { status } : {}) });
    }
    return out;
  } finally {
    await browser.close();
  }
}
