// Fill each built page with its server-rendered markup, so the content is in the
// HTML itself (search engines, link previews, no-JS readers); the browser then
// hydrates it. Runs after `vite build` and `vite build --ssr src/prerender.tsx`.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const site = join(import.meta.dirname, "..");
const ssrDir = join(site, "out/ssr");
const { pages } = await import(pathToFileURL(join(ssrDir, "prerender.js")).href);

const MARK = "<!--app-html-->";
for (const [file, render] of Object.entries(pages)) {
  const path = join(site, "dist", file);
  const html = readFileSync(path, "utf8");
  if (html.split(MARK).length !== 2) throw new Error(`${file}: expected exactly one ${MARK}`);
  writeFileSync(path, html.replace(MARK, () => render()));
  console.log(`prerendered ${file}`);
}
rmSync(ssrDir, { recursive: true, force: true });
