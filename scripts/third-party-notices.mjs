// Third-party license notices for a bundled artifact. The npm package, the VS Code
// extension and the canvas UI inline their dependencies, so the MIT/ISC/BSD/Apache
// notices those packages carry have to travel inside the artifact. Each build hands
// this the module files its bundler actually included (esbuild metafile inputs,
// Rollup chunk modules), so the list is what ships, not the whole lockfile.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

/** The node_modules package directory a bundled file came from, or null for first-party code. */
function packageDir(file, baseDir) {
  const path = resolve(baseDir, file.replace(/^\0/, "").replace(/\?.*$/, "")).replace(/\\/g, "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  return name ? `${path.slice(0, at)}/node_modules/${name}` : null;
}

/**
 * @param {Iterable<string>} files module paths the bundle included
 * @param {string} baseDir what relative paths are relative to (esbuild: its working directory)
 * @param {string} artifact a name for the header, e.g. "forward-mcp"
 */
export function thirdPartyNotices(files, baseDir, artifact) {
  const dirs = new Set();
  for (const f of files) {
    const dir = packageDir(f, baseDir);
    if (dir && existsSync(`${dir}/package.json`)) dirs.add(dir);
  }
  const entries = [...dirs]
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
      const texts = readdirSync(dir)
        .filter((f) => LICENSE_FILE.test(f))
        .sort()
        .map((f) => readFileSync(`${dir}/${f}`, "utf8").trim());
      const license = typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? "UNKNOWN");
      return { id: `${pkg.name}@${pkg.version}`, license, texts };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const rule = "-".repeat(78);
  return [
    `${artifact} includes the following third-party software. Each package's license`,
    "and notices are reproduced below.",
    "",
    ...entries.flatMap((e) => [
      rule,
      `${e.id} (${e.license})`,
      rule,
      "",
      ...(e.texts.length ? e.texts.flatMap((t) => [t, ""]) : [`Licensed under ${e.license}.`, ""]),
    ]),
  ].join("\n");
}
