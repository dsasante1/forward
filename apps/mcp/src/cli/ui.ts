import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the built canvas host lives. Published builds carry it in `dist/ui`
 * (copied there by the build); inside the monorepo we fall back to the canvas
 * workspace's own build output.
 */
export function uiDir(): string | undefined {
  const candidates = [
    fileURLToPath(new URL("./ui/", import.meta.url)),
    fileURLToPath(new URL("../ui/", import.meta.url)),
    fileURLToPath(new URL("../../../canvas/dist-host/", import.meta.url)),
    fileURLToPath(new URL("../../canvas/dist-host/", import.meta.url)),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html")));
}

export function requireUiDir(): string {
  const dir = uiDir();
  if (!dir) {
    throw new Error(
      "The canvas UI isn't built. In the Forward repo run `npm run build -w apps/canvas` " +
        "(published packages ship it prebuilt).",
    );
  }
  return dir;
}

/** Inject the host config into index.html, safely escaped for a <script> block. */
export function renderIndex(dir: string, config: unknown): string {
  const html = readFileSync(join(dir, "index.html"), "utf8");
  // Escape "<" so a value can never close the <script> block early.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return html.replace("<!--forward:config-->", `<script>window.__FORWARD__=${json};</script>`);
}

/** Copy the UI into `out` with a static config pointing at `bundleFile`. */
export function writeStaticSite(out: string, bundleFile: string): void {
  const dir = requireUiDir();
  mkdirSync(out, { recursive: true });
  cpSync(join(dir, "assets"), join(out, "assets"), { recursive: true });
  writeFileSync(join(out, "index.html"), renderIndex(dir, { mode: "static", bundle: bundleFile }));
  // The UI bundles mermaid and friends; a published site carries their licenses.
  const notices = join(dir, "THIRD_PARTY_NOTICES.txt");
  if (existsSync(notices)) cpSync(notices, join(out, "THIRD_PARTY_NOTICES.txt"));
  // GitHub Pages: serve files as-is (no Jekyll processing of `_`-prefixed assets).
  writeFileSync(join(out, ".nojekyll"), "");
}
