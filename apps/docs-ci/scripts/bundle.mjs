// Bundle the docs-ci Action into dist/action.mjs (committed: the Action runs it
// from the tagged commit with no install step), plus the licenses of what it inlines.
import { writeFileSync } from "node:fs";
import { build } from "esbuild";
import { thirdPartyNotices } from "../../../scripts/third-party-notices.mjs";

const { metafile } = await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/action.mjs",
  metafile: true,
});
writeFileSync(
  "dist/THIRD_PARTY_NOTICES.txt",
  thirdPartyNotices(Object.keys(metafile.inputs), process.cwd(), "The Forward docs-ci Action (dist/action.mjs)"),
);
