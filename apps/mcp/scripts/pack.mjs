// Build the publishable `forward-mcp` package into ./pkg.
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
