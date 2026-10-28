import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ImportedElement } from "forward-core";

/**
 * Opt-in `@adc <id>` anchors for elements generated from code.
 *
 * After an import, each frontend component that produced an element can get a
 * source anchor pointing at that element, so `resolve_anchors` (and the agent
 * workflows built on it) link the code to its design deterministically.
 *
 * Writing into someone's source is the riskiest thing this feature does, so it
 * is narrow on purpose: only JS/TS files inside the repository, only a single
 * `// @adc` line comment, and only directly above the component's own
 * `function`/`const`/`class` declaration — a statement position where a line
 * comment is always legal. JSX bodies are never touched (a `//` there would
 * render as text). Anything else is reported as skipped, never guessed.
 */

const SCRIPT_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const NEVER = new Set(["node_modules", ".forward", ".git", "dist", "build"]);

export interface AnchorTarget {
  elementId: string;
  label: string;
  component: string;
  /** Repository-relative file. */
  file: string;
  /** 1-based line of the JSX that rendered the element. */
  line: number;
}

export interface AnchorOutcome {
  written: Array<{ elementId: string; file: string; line: number }>;
  skipped: Array<{ elementId: string; file?: string; reason: string }>;
}

/** Split "src/Card.tsx:12" into file + line. */
export function parseSource(source: string): { file: string; line: number } | null {
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(source);
  if (!m?.[1] || !m[2]) return null;
  return { file: m[1], line: Number(m[2]) };
}

/**
 * The real path (symlinks resolved). For a path that doesn't exist yet, the
 * nearest existing ancestor is resolved and the rest appended, so it compares
 * correctly against a root that is itself behind a symlink.
 */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(real(parent), basename(path));
  }
}

/**
 * Repository-relative path when `file` lies inside `root`; null otherwise.
 * Symlinks are resolved first, so a link inside the repository that points
 * outside it is outside.
 */
export function insideRepo(root: string, file: string): string | null {
  const rel = relative(real(root), real(resolve(root, file)));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (rel.split(sep).some((part) => NEVER.has(part))) return null;
  return rel.split(sep).join("/");
}

/**
 * One anchor per component and file: the master when components were
 * detected, otherwise the first element the component rendered (parents are
 * listed before children, so that is its outermost painted box).
 */
export function planAnchors(root: string, elements: ImportedElement[]): AnchorOutcome & { targets: AnchorTarget[] } {
  const targets: AnchorTarget[] = [];
  const skipped: AnchorOutcome["skipped"] = [];
  const seen = new Map<string, AnchorTarget>();
  const ordered = [...elements].sort(
    (a, b) => Number(b.type === "component") - Number(a.type === "component"),
  );
  for (const el of ordered) {
    const { component, source } = el.origin;
    if (!component || !source || el.type === "text" || el.type === "instance") continue;
    const loc = parseSource(source);
    if (!loc) continue;
    const file = insideRepo(root, loc.file);
    const key = `${component}\u0000${loc.file}`;
    if (seen.has(key)) continue;
    if (!file) {
      skipped.push({ elementId: el.id, file: loc.file, reason: "file is outside the repository" });
      seen.set(key, { elementId: el.id, label: "", component, file: loc.file, line: loc.line });
      continue;
    }
    const target = { elementId: el.id, label: el.name, component, file, line: loc.line };
    seen.set(key, target);
    targets.push(target);
  }
  return { targets, written: [], skipped };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Insert the anchors (or, with `dryRun`, only work out where they would go).
 * A file that already anchors the element is left alone, so re-running an
 * import never stacks duplicate anchors.
 */
export async function writeAnchors(
  root: string,
  targets: AnchorTarget[],
  opts: { dryRun?: boolean } = {},
): Promise<AnchorOutcome> {
  const out: AnchorOutcome = { written: [], skipped: [] };
  const byFile = new Map<string, AnchorTarget[]>();
  for (const t of targets) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);

  for (const [file, list] of byFile) {
    if (!SCRIPT_EXT.has(extname(file))) {
      for (const t of list) out.skipped.push({ elementId: t.elementId, file, reason: "not a JS/TS file" });
      continue;
    }
    const path = resolve(root, file);
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      for (const t of list) out.skipped.push({ elementId: t.elementId, file, reason: "file not readable" });
      continue;
    }
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const lines = source.split(/\r?\n/);
    const inserts: Array<{ at: number; text: string; target: AnchorTarget }> = [];
    for (const t of list) {
      if (new RegExp(`(?<![\\w@])@adc[ \\t]+${escapeRe(t.elementId)}(?![\\w-])`).test(source)) {
        out.skipped.push({ elementId: t.elementId, file, reason: "already anchored" });
        continue;
      }
      const name = escapeRe(t.component);
      const decl = new RegExp(
        `^(\\s*)(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s*\\*?\\s*${name}\\b|(?:const|let|var)\\s+${name}\\b|class\\s+${name}\\b)`,
      );
      let at = -1;
      let indent = "";
      for (let i = Math.min(t.line, lines.length) - 1; i >= 0; i--) {
        const m = decl.exec(lines[i] ?? "");
        if (m) {
          at = i;
          indent = m[1] ?? "";
          break;
        }
      }
      if (at < 0) {
        out.skipped.push({ elementId: t.elementId, file, reason: `no declaration of ${t.component} above line ${t.line}` });
        continue;
      }
      // Another route or viewport's draft of the same component already
      // anchors this declaration; one anchor per declaration is enough.
      if (/(?<![\w@])@adc[ \t]+[A-Za-z0-9_-]+/.test(lines[at - 1] ?? "")) {
        out.skipped.push({ elementId: t.elementId, file, reason: "declaration already anchored" });
        continue;
      }
      if (inserts.some((x) => x.at === at)) {
        out.skipped.push({ elementId: t.elementId, file, reason: "declaration already gets an anchor" });
        continue;
      }
      // The label lands inside a `//` comment: keep it to printable ASCII so no
      // line terminator (\n, \r, U+2028, U+2029) can end the comment early.
      const label = t.label.replace(/[^\x20-\x7e]/g, " ").replace(/"/g, "'").trim().slice(0, 120);
      inserts.push({ at, text: `${indent}// @adc ${t.elementId} "${label}"`, target: t });
    }
    if (!inserts.length) continue;
    // Insert bottom-up so earlier line numbers stay valid.
    inserts.sort((a, b) => b.at - a.at);
    for (const ins of inserts) lines.splice(ins.at, 0, ins.text);
    if (!opts.dryRun) await writeFile(path, lines.join(eol));
    // Report the line each anchor ends up on (1-based), top-down.
    for (const [i, ins] of [...inserts].reverse().entries()) {
      out.written.push({ elementId: ins.target.elementId, file, line: ins.at + i + 1 });
    }
  }
  return out;
}
