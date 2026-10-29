// Build the publishable `forward-mcp` package into ./pkg, and its companion
// `forward-capture` into ./pkg-capture (see the end of this file).
//
// The workspace package depends on `forward-core`, which is not published, so
// the npm package is a self-contained esbuild bundle instead: `forward-mcp`
// (MCP stdio server) and `forward` (CLI) with forward-core, zod and the MCP SDK
// inlined, plus the prebuilt canvas UI. Its package.json has no dependencies,
// so `npx -y forward-mcp` installs one tarball and nothing else.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { thirdPartyNotices } from "../../../scripts/third-party-notices.mjs";
import { zodEnglishOnly } from "../../../scripts/zod-english-only.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../pkg/");
const src = JSON.parse(readFileSync(here("../package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}dist`, { recursive: true });

const { metafile } = await build({
  entryPoints: { server: here("../src/server.ts"), cli: here("../src/cli.ts") },
  outdir: `${out}dist`,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  legalComments: "eof",
  metafile: true,
  plugins: [zodEnglishOnly],
  // Live capture drives an installed browser with built-in code (src/browser/),
  // or loads Playwright from the user's project at runtime; Playwright is never
  // bundled and never a dependency of the package.
  external: ["playwright", "playwright-core"],
  banner: {
    // Bundled CJS dependencies may call require(); give ESM output one.
    js: "import { createRequire as __fwdCreateRequire } from 'node:module';\nconst require = __fwdCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});

const ui = here("../../canvas/dist-host/");
if (!existsSync(`${ui}index.html`)) {
  console.error("Build the canvas host first: npm run build -w apps/canvas");
  process.exit(1);
}
cpSync(ui, `${out}dist/ui`, { recursive: true });
cpSync(here("../README.md"), `${out}README.md`);
cpSync(here("../../../LICENSE"), `${out}LICENSE`);
cpSync(here("../../../NOTICE"), `${out}NOTICE`);
// The server/CLI bundle's dependencies; the canvas UI carries its own list in
// dist/ui/THIRD_PARTY_NOTICES.txt (written by the canvas host build).
writeFileSync(
  `${out}THIRD_PARTY_NOTICES.txt`,
  thirdPartyNotices(Object.keys(metafile.inputs), process.cwd(), "forward-mcp (dist/server.js, dist/cli.js)"),
);

writeFileSync(
  `${out}package.json`,
  `${JSON.stringify(
    {
      name: "forward-mcp",
      version: src.version,
      description: src.description,
      license: "Apache-2.0",
      type: "module",
      bin: { "forward-mcp": "dist/server.js", forward: "dist/cli.js" },
      files: ["dist", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"],
      engines: { node: ">=22" },
      publishConfig: { access: "public" },
      repository: { type: "git", url: "git+https://github.com/dsasante1/forward.git", directory: "apps/mcp" },
      homepage: "https://github.com/dsasante1/forward#readme",
      bugs: "https://github.com/dsasante1/forward/issues",
      keywords: ["mcp", "model-context-protocol", "ai-agents", "api-documentation", "design", "claude", "codex"],
    },
    null,
    2,
  )}\n`,
);
console.log(`Packed forward-mcp@${src.version} into ${out}`);

// --- forward-capture: the companion package -------------------------------
// Live capture for machines with neither the project's Playwright nor a
// Chromium-based browser: `forward capture` runs it at exactly this version
// (src/companion/). It is its own package so forward-mcp keeps no
// dependencies; this one has exactly one, playwright-core, pinned exactly
// because each Playwright release expects one browser build.
const capture = here("../pkg-capture/");
const playwrightCore = src.devDependencies?.["playwright-core"];
if (!playwrightCore || !/^\d+\.\d+\.\d+$/.test(playwrightCore)) {
  console.error(`apps/mcp/package.json must pin playwright-core exactly (found "${playwrightCore}")`);
  process.exit(1);
}
rmSync(capture, { recursive: true, force: true });
mkdirSync(`${capture}dist`, { recursive: true });
const companion = await build({
  entryPoints: { main: here("../src/companion/main.ts") },
  outdir: `${capture}dist`,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  legalComments: "eof",
  metafile: true,
  plugins: [zodEnglishOnly],
  external: ["playwright-core"],
  banner: {
    js: "import { createRequire as __fwdCreateRequire } from 'node:module';\nconst require = __fwdCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});
writeFileSync(
  `${capture}README.md`,
  `# forward-capture

Live capture for [Forward](https://github.com/dsasante1/forward), with Playwright.

You don't normally install or run this yourself. \`forward capture <url>\` uses the project's
Playwright, or a Chromium-based browser you already have (Chrome, Edge, Brave, Chromium, Vivaldi,
Opera). Only when neither is available does it run \`npx -y forward-capture@<its own version>\`,
which brings Playwright and downloads its headless Chromium once (about 100 MB, into Playwright's
shared cache). Set \`FORWARD_NO_DOWNLOAD=1\` to forbid both downloads.

Commands: \`forward-capture install\` (fetch the browser now), \`forward-capture install-deps\`
(its system libraries on Linux; needs sudo), \`forward-capture --version\`. \`forward-capture run\`
takes one capture job as JSON on stdin and prints the result as JSON on stdout.
`,
);
cpSync(here("../../../LICENSE"), `${capture}LICENSE`);
cpSync(here("../../../NOTICE"), `${capture}NOTICE`);
writeFileSync(
  `${capture}THIRD_PARTY_NOTICES.txt`,
  thirdPartyNotices(Object.keys(companion.metafile.inputs), process.cwd(), "forward-capture (dist/main.js)"),
);
writeFileSync(
  `${capture}package.json`,
  `${JSON.stringify(
    {
      name: "forward-capture",
      version: src.version,
      description: "Live capture with Playwright for Forward (run by `forward capture` when needed).",
      license: "Apache-2.0",
      type: "module",
      bin: { "forward-capture": "dist/main.js" },
      files: ["dist", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"],
      dependencies: { "playwright-core": playwrightCore },
      engines: { node: ">=22" },
      publishConfig: { access: "public" },
      repository: { type: "git", url: "git+https://github.com/dsasante1/forward.git", directory: "apps/mcp" },
      homepage: "https://github.com/dsasante1/forward#readme",
      bugs: "https://github.com/dsasante1/forward/issues",
      keywords: ["forward", "playwright", "design", "capture"],
    },
    null,
    2,
  )}\n`,
);
console.log(`Packed forward-capture@${src.version} (playwright-core ${playwrightCore}) into ${capture}`);
