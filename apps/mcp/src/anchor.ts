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
 * An optional quoted label may follow the id — a human-readable note so the
 * anchor reads in the diff without anyone transcribing the opaque id:
 *
 *     // @adc el_login_submit "Login submit button"
 *
 * The label is purely for humans; resolution is always by id. Because it is
 * quote-delimited, the trailing `*​/` or `-->` of a block comment falls outside
 * the quotes and is never captured. Tooling can cross-check the label against
 * the element's current name to warn when the two have drifted apart.
 *
 * The parser is pure and comment-syntax-agnostic (it just looks for the `@adc`
 * token, so `//`, `#`, `/* *​/`, `<!-- -->` all work); the filesystem walk is a
 * thin layer on top.
 */

export interface Anchor {
  /** The design element id the anchor points at. */
  elementId: string;
  /** Optional human-readable label authored in the source (the quoted text). */
  label?: string;
  /** Source file the anchor was found in (absent when scanning raw text). */
  file?: string;
  /** 1-based line number of the anchor. */
  line: number;
}

// `@adc <elementId> ["label"]` — the `@` must not be part of a larger token (so
// an email like `user@adc.io` is not mistaken for an anchor), and the id is the
// usual id charset. The element id is captured, plus an optional quoted label
// (any text but a double-quote or newline) that follows on the same line.
const ANCHOR_RE = /(?<![\w@])@adc[ \t]+([A-Za-z0-9_-]+)(?:[ \t]+"([^"\n]*)")?/g;

/** Find every `@adc <elementId> ["label"]` anchor in a block of source text. */
export function findAnchorsInSource(source: string, file?: string): Anchor[] {
  const out: Anchor[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    for (const m of text.matchAll(ANCHOR_RE)) {
      const elementId = m[1];
      const label = m[2]?.trim();
      if (elementId) {
        out.push({
          elementId,
          line: i + 1,
          ...(label ? { label } : {}),
          ...(file ? { file } : {}),
        });
      }
    }
  });
  return out;
}

/** The element facts an anchor is cross-checked against (from the live canvas). */
export interface AnchorElement {
  name: string;
  type: string;
  documented: boolean;
}

/** An anchor resolved against the canvas — enriched with element facts + flags. */
export interface ResolvedAnchor extends Anchor {
  /** Whether the elementId exists; `null` when the canvas couldn't be reached. */
  exists: boolean | null;
  name?: string;
  type?: string;
  documented?: boolean;
  /** Set when the anchor's label no longer matches the element's current name. */
  labelDrifted?: boolean;
  /** The element's current name, included alongside `labelDrifted`. */
  currentName?: string;
}

/**
 * Resolve anchors against the canvas's elements (keyed by id). Pure so it can be
 * unit-tested without a server. When `validated` is false the element map is
 * unknown (canvas unreachable), so `exists` is reported as `null` and no drift
 * is computed. When validated, an anchor carrying a label whose text differs
 * from the element's current name is flagged `labelDrifted` — a cheap catch for
 * moved code or a design renamed out from under the anchor.
 */
export function resolveAnchors(
  anchors: Anchor[],
  byId: Map<string, AnchorElement>,
  validated: boolean,
): ResolvedAnchor[] {
  return anchors.map((a) => {
    const el = byId.get(a.elementId);
    const drift =
      validated && el && a.label != null && a.label !== el.name
        ? { labelDrifted: true, currentName: el.name }
        : {};
    return {
      ...a,
      exists: validated ? Boolean(el) : null,
      ...(el ? { name: el.name, type: el.type, documented: el.documented } : {}),
      ...drift,
    };
  });
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
