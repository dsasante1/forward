// Copy the built canvas host into dist/ui so `forward serve` / `forward export`
// work from the published package. Skipped (with a note) when the canvas hasn't
// been built — validate/diff/MCP don't need it.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../canvas/dist-host/", import.meta.url));
const to = fileURLToPath(new URL("../dist/ui/", import.meta.url));
if (!existsSync(`${from}index.html`)) {
  console.warn("[forward-mcp] canvas host not built; `forward serve`/`export` will look for it at runtime.");
} else {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log("[forward-mcp] bundled canvas UI into dist/ui");
}
