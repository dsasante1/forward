import { build, context } from "esbuild";

/**
 * Two bundles:
 *   1. The extension host code -> CommonJS for Node. `vscode` is provided by the
 *      host at runtime so it stays external; the shared workspace package IS
 *      bundled in so there's nothing to resolve at runtime.
 *   2. The read-only canvas webview -> a browser IIFE loaded inside the webview.
 */
const host = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

const webview = {
  entryPoints: ["src/webview.ts"],
  outfile: "dist/webview.js",
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "iife",
  sourcemap: true,
  logLevel: "info",
};

const watch = process.argv.includes("--watch");
if (watch) {
  const ctxs = await Promise.all([context(host), context(webview)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("esbuild: watching…");
} else {
  await Promise.all([build(host), build(webview)]);
}
