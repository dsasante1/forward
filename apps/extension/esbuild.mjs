import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, context } from "esbuild";

/**
 * Two bundles:
 *   1. The extension host code -> CommonJS for Node. `vscode` is provided by the
 *      host at runtime so it stays external; the shared workspace package IS
 *      bundled in so there's nothing to resolve at runtime.
 *   2. The canvas webview -> a browser IIFE. It mounts the real `forward-canvas`
 *      editor (so the toolbar + authoring match the dashboard) driven by a
 *      postMessage bridge to the host. Mermaid and the canvas CSS are bundled
 *      in, so the webview loads no external resources.
 */

/**
 * Resolve `import x from "./foo.css?inline"` to the file's text. The canvas uses
 * this Vite-ism to inline its stylesheet; esbuild needs a small shim to match.
 */
const cssInlinePlugin = {
  name: "css-inline",
  setup(b) {
    b.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?inline$/, "")),
      namespace: "css-inline",
    }));
    b.onLoad({ filter: /.*/, namespace: "css-inline" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

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
  entryPoints: ["src/canvas-webview.ts"],
  outfile: "dist/webview.js",
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "iife",
  sourcemap: true,
  // Mermaid (pulled in by the canvas) probes these globals; pin them so the
  // bundle runs in the webview without a Node-style `process`/`global`.
  define: {
    "process.env.NODE_ENV": '"production"',
    global: "globalThis",
  },
  plugins: [cssInlinePlugin],
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
