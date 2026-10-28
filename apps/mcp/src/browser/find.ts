import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";

/**
 * Finding a Chromium-based browser already installed on this device, so live
 * capture can drive it directly (see cdp.ts) — no Playwright, no download.
 *
 * Only Chromium browsers speak the DevTools protocol over a pipe. Firefox and
 * Safari can't be driven without special builds, so they are recognised by
 * name only to say so, and pointed at the DevTools snippet instead.
 */

export const BROWSER_IDS = ["chrome", "edge", "chromium", "brave", "vivaldi", "opera"] as const;
export type BrowserId = (typeof BROWSER_IDS)[number];

export interface InstalledBrowser {
  id: BrowserId | "custom";
  name: string;
  path: string;
}

const NAMES: Record<BrowserId, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  chromium: "Chromium",
  brave: "Brave",
  vivaldi: "Vivaldi",
  opera: "Opera",
};

/** Where each browser lives, per platform. Paths are tried in order. */
function candidates(id: BrowserId, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "darwin") {
    const app = {
      chrome: "Google Chrome.app/Contents/MacOS/Google Chrome",
      edge: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      chromium: "Chromium.app/Contents/MacOS/Chromium",
      brave: "Brave Browser.app/Contents/MacOS/Brave Browser",
      vivaldi: "Vivaldi.app/Contents/MacOS/Vivaldi",
      opera: "Opera.app/Contents/MacOS/Opera",
    }[id];
    return ["/Applications", join(env.HOME ?? homedir(), "Applications")].map((dir) => join(dir, app));
  }
  if (platform === "win32") {
    const rel = {
      chrome: ["Google\\Chrome\\Application\\chrome.exe"],
      edge: ["Microsoft\\Edge\\Application\\msedge.exe"],
      chromium: ["Chromium\\Application\\chrome.exe"],
      brave: ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
      vivaldi: ["Vivaldi\\Application\\vivaldi.exe"],
      opera: [] as string[], // Opera installs a launcher that doesn't take Chromium flags
    }[id];
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean) as string[];
    return roots.flatMap((root) => rel.map((r) => `${root}\\${r}`));
  }
  // Linux and the other Unixes: names on PATH.
  const bins = {
    chrome: ["google-chrome", "google-chrome-stable"],
    edge: ["microsoft-edge", "microsoft-edge-stable"],
    chromium: ["chromium", "chromium-browser"],
    brave: ["brave-browser", "brave"],
    vivaldi: ["vivaldi", "vivaldi-stable"],
    opera: ["opera"],
  }[id];
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  return bins.flatMap((bin) => dirs.map((dir) => join(dir, bin)));
}

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Snap-packaged browsers (Ubuntu) can't use a profile in /tmp; prefer anything else. */
export function isSnap(path: string): boolean {
  try {
    return realpathSync(path).includes("/snap/") || path.startsWith("/snap/");
  } catch {
    return path.startsWith("/snap/");
  }
}

export interface FindOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** For tests: whether a path is a runnable file. */
  isExecutable?: (path: string) => boolean;
  /** For tests: check that a custom path is a Chromium-based browser (throws if not). */
  probe?: (path: string) => void;
}

/**
 * Ask a custom binary what it is (`--version`) before starting it with
 * browser flags. Chromium browsers answer "Google Chrome 1xx", "Chromium …",
 * "Microsoft Edge …" and so on. On Windows chrome.exe prints nothing, so the
 * name check above is all there is.
 */
export function probeVersion(path: string): void {
  if (process.platform === "win32") return;
  let said: string;
  try {
    said = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error(`${path} didn't answer \`--version\`; is it a Chromium-based browser?`);
  }
  if (/firefox|mozilla|safari|webkit/i.test(said)) {
    throw new Error(`${path} is ${said.split("\n")[0]}, which can't be driven for live capture. ${SNIPPET_ADVICE}`);
  }
  if (!/chrom|edge|brave|vivaldi|opera|yandex/i.test(said)) {
    throw new Error(`${path} doesn't look like a Chromium-based browser (it says: ${said.split("\n")[0] || "nothing"}).`);
  }
}

/** Every supported browser found on this device, in preference order. */
export function findBrowsers(opts: FindOptions = {}): InstalledBrowser[] {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const ok = opts.isExecutable ?? executable;
  const found: InstalledBrowser[] = [];
  const seen = new Set<string>();
  for (const id of BROWSER_IDS) {
    const path = candidates(id, platform, env).find((p) => ok(p));
    if (path && !seen.has(path)) {
      seen.add(path);
      found.push({ id, name: NAMES[id], path });
    }
  }
  // A snap build works, but less reliably: try it last.
  return [...found.filter((b) => !isSnap(b.path)), ...found.filter((b) => isSnap(b.path))];
}

/** Browsers we recognise but can't drive. */
const UNSUPPORTED: Record<string, string> = {
  firefox: "Firefox",
  safari: "Safari",
  webkit: "WebKit",
};

export const SNIPPET_ADVICE =
  "Capture it from that browser instead: run `forward capture --script`, paste the snippet into " +
  "its DevTools console, then `forward capture --from forward-snapshot.json`.";

/**
 * Resolve `--browser`: a browser id, a path to a Chromium-based binary, or
 * (with `$FORWARD_BROWSER`, or "auto") the first one installed. Throws a
 * readable error when nothing suitable exists.
 */
export function resolveBrowser(choice: string | undefined, opts: FindOptions = {}): InstalledBrowser {
  const env = opts.env ?? process.env;
  const ok = opts.isExecutable ?? executable;
  const wanted = (choice && choice !== "auto" ? choice : env.FORWARD_BROWSER || "auto").trim();
  const lower = wanted.toLowerCase();

  if (UNSUPPORTED[lower]) {
    throw new Error(
      `${UNSUPPORTED[lower]} can't be driven for live capture (only Chromium-based browsers can: ` +
        `${BROWSER_IDS.join(", ")}). ${SNIPPET_ADVICE}`,
    );
  }
  if (/[\\/]/.test(wanted)) {
    if (!existsSync(wanted) || !ok(wanted)) throw new Error(`No runnable browser at ${wanted}.`);
    // A path to Firefox or Safari would start the real thing on the user's own
    // profile (neither honours our flags): refuse it by name, then by what it says it is.
    const unsupported = Object.entries(UNSUPPORTED).find(([key]) =>
      basename(wanted).toLowerCase().replace(/\.(exe|app)$/, "").includes(key),
    );
    if (unsupported || /minibrowser/i.test(basename(wanted))) {
      throw new Error(`${unsupported?.[1] ?? "WebKit"} can't be driven for live capture (only Chromium-based browsers can). ${SNIPPET_ADVICE}`);
    }
    (opts.probe ?? probeVersion)(wanted);
    return { id: "custom", name: wanted, path: wanted };
  }

  const found = findBrowsers(opts);
  if (lower === "auto") {
    const first = found[0];
    if (first) return first;
    throw new Error(
      `No Chromium-based browser found (looked for ${BROWSER_IDS.map((id) => NAMES[id]).join(", ")}). ` +
        "Install one, set FORWARD_BROWSER to its path, or add Playwright to the project " +
        "(`npm i -D playwright && npx playwright install chromium`). Or: " +
        SNIPPET_ADVICE.charAt(0).toLowerCase() +
        SNIPPET_ADVICE.slice(1),
    );
  }
  if (!(BROWSER_IDS as readonly string[]).includes(lower)) {
    throw new Error(
      `Unknown browser "${wanted}". Use one of: auto, playwright, ${BROWSER_IDS.join(", ")}, or a path to a Chromium-based browser.`,
    );
  }
  const match = found.find((b) => b.id === lower);
  if (!match) {
    const others = found.length ? ` Found: ${found.map((b) => b.id).join(", ")}.` : "";
    throw new Error(`${NAMES[lower as BrowserId]} isn't installed where Forward looks.${others} Pass its path with --browser /path/to/browser.`);
  }
  return match;
}
