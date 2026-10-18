import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, context } from "esbuild";
import { thirdPartyNotices } from "../../scripts/third-party-notices.mjs";

/**
 * Two bundles:
 *   1. The extension host code -> CommonJS for Node. `vscode` is provided by the
 *      host at runtime so it stays external; the shared workspace package IS
 *      bundled in so there's nothing to resolve at runtime.
 *   2. The canvas webview -> a browser IIFE. It mounts the real `forward-canvas`
 *      editor (so the toolbar + authoring match `forward serve`) driven by a
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
  const results = await Promise.all([build({ ...host, metafile: true }), build({ ...webview, metafile: true })]);
  // Both bundles inline their dependencies (mermaid, zod, ...): ship their
  // licenses and the project NOTICE inside dist/, which the .vsix includes.
  const inputs = results.flatMap((r) => Object.keys(r.metafile.inputs));
  await writeFile("dist/THIRD_PARTY_NOTICES.txt", thirdPartyNotices(inputs, process.cwd(), "The Forward VS Code extension"));
  await copyFile("../../NOTICE", "dist/NOTICE");
}
