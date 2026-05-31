import { build, context } from "esbuild";

/**
 * Bundle the extension into a single CommonJS file VS Code can load.
 * `vscode` is provided by the host at runtime, so it stays external; the shared
 * workspace package IS bundled in so there's nothing to resolve at runtime.
 */
const options = {
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

const watch = process.argv.includes("--watch");
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild: watching…");
} else {
  await build(options);
}
