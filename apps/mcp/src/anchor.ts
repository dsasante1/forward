import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

/**
 * Deterministic linking via in-code anchors.
 *
 * Instead of fuzzily matching a feature description to a design element (see
 * match.ts), a developer pins the link in the source itself, next to the code
 * that implements it:
 *
 *     // @adc el_login_submit
 *     app.post("/api/v1/login", loginHandler)
 *
 * The anchor is unambiguous and re-runnable: an agent (or CI) reads the marker
 * and knows exactly which element to document — no guessing, no confirm step.
 *
 * The parser is pure and comment-syntax-agnostic (it just looks for the `@adc`
 * token, so `//`, `#`, `/* *​/`, `<!-- -->` all work); the filesystem walk is a
 * thin layer on top.
 */

export interface Anchor {
  /** The design element id the anchor points at. */
  elementId: string;
  /** Source file the anchor was found in (absent when scanning raw text). */
  file?: string;
  /** 1-based line number of the anchor. */
  line: number;
}

// `@adc <elementId>` — the `@` must not be part of a larger token (so an email
// like `user@adc.io` is not mistaken for an anchor), and the id is the usual
// id charset. The element id is captured.
const ANCHOR_RE = /(?<![\w@])@adc[ \t]+([A-Za-z0-9_-]+)/g;

/** Find every `@adc <elementId>` anchor in a block of source text. */
export function findAnchorsInSource(source: string, file?: string): Anchor[] {
  const out: Anchor[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    for (const m of text.matchAll(ANCHOR_RE)) {
      const elementId = m[1];
      if (elementId) out.push({ elementId, line: i + 1, ...(file ? { file } : {}) });
    }
  });
  return out;
}

// Directories never worth scanning, and the text/code extensions we do scan.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next",
  ".turbo", "vendor", ".venv", "__pycache__",
]);
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".java",
  ".kt", ".kts", ".rs", ".php", ".cs", ".c", ".h", ".hpp", ".cpp", ".cc",
  ".swift", ".scala", ".ex", ".exs", ".vue", ".svelte", ".graphql", ".gql",
  ".sql", ".sh", ".yaml", ".yml", ".md", ".txt",
]);
const MAX_BYTES = 1_000_000; // skip anything bigger than ~1 MB

/**
 * Scan a file or directory for anchors. A single file is read regardless of
 * extension (the caller named it explicitly); a directory is walked, skipping
 * vendored/build folders and non-text files. Unreadable files are skipped, not
 * fatal, so one bad file never sinks the whole scan.
 */
export async function scanPath(path: string): Promise<Anchor[]> {
  const info = await stat(path);
  if (info.isFile()) return scanFile(path);
  const out: Anchor[] = [];
  await walk(path, out);
  return out;
}

async function walk(dir: string, out: Anchor[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(full, out);
    } else if (e.isFile() && TEXT_EXT.has(extname(e.name).toLowerCase())) {
      out.push(...(await scanFile(full)));
    }
  }
}

async function scanFile(file: string): Promise<Anchor[]> {
  try {
    const info = await stat(file);
    if (info.size > MAX_BYTES) return [];
    return findAnchorsInSource(await readFile(file, "utf8"), file);
  } catch {
    return [];
  }
}
