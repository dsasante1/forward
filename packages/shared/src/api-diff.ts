import {
  type ApiBinding,
  type DiffRow,
  type DiffSection,
  VersionDiff,
} from "./schema.js";

/**
 * Compute the structured documentation diff between two API bindings — the
 * `VersionDiff` the History timeline expands when an `api` event is opened.
 *
 * An `apiBinding` is just `{ title, description }`, so a "git diff for API docs"
 * is a title-change pair plus a line-level diff of the Markdown description. Pure
 * and framework-free (like the rest of the timeline helpers) so the single writer
 * (`rtdb-rest`) and the unit tests share one implementation.
 *
 * `prev`/`next` are optional so the same helper covers the whole lifecycle: a
 * create (no `prev`) is all-added, a delete (no `next`) is all-removed. The
 * caller owns the `breaking` flag (it can't be inferred from text reliably) and
 * merges it onto the returned diff.
 */
export function diffBindings(
  prev: ApiBinding | undefined,
  next: ApiBinding | undefined,
): VersionDiff {
  const sections: DiffSection[] = [];

  const titleRows = diffTitle(prev?.title ?? "", next?.title ?? "");
  if (titleRows.length) sections.push({ label: "Title", rows: titleRows });

  const descRows = diffLines(prev?.description ?? "", next?.description ?? "");
  if (descRows.length) sections.push({ label: "Description", rows: descRows });

  let added = 0;
  let removed = 0;
  for (const sec of sections) {
    for (const r of sec.rows) {
      if (r.op === "added") added++;
      else if (r.op === "removed") removed++;
    }
  }

  return VersionDiff.parse({ added, removed, sections });
}

/** A single-line field: unchanged when equal, else a removed→added pair. */
function diffTitle(before: string, after: string): DiffRow[] {
  if (before === after) {
    return after ? [{ op: "unchanged", cols: [after] }] : [];
  }
  const rows: DiffRow[] = [];
  if (before) rows.push({ op: "removed", cols: [before] });
  if (after) rows.push({ op: "added", cols: [after] });
  return rows;
}

/** Split into trailing-whitespace-trimmed lines; empty text yields no lines. */
function splitLines(text: string): string[] {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed ? trimmed.split("\n").map((l) => l.replace(/\s+$/, "")) : [];
}

/**
 * Classic line-level LCS diff (the same shape `git diff` shows): unchanged lines
 * give context, removed/added lines colour red/green. Each line becomes one
 * `DiffRow` with the text in a single column, so it renders through the existing
 * diff table unchanged.
 */
function diffLines(before: string, after: string): DiffRow[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // lcs[i*w + j] = length of the longest common subsequence of a[i:] and b[j:].
  // A flat array keeps the 2-D table cheap; `g` reads it (0 outside the table).
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  const g = (idx: number): number => lcs[idx] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? g((i + 1) * w + (j + 1)) + 1
          : Math.max(g((i + 1) * w + j), g(i * w + (j + 1)));
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ op: "unchanged", cols: [a[i] as string] });
      i++;
      j++;
    } else if (g((i + 1) * w + j) >= g(i * w + (j + 1))) {
      rows.push({ op: "removed", cols: [a[i] as string] });
      i++;
    } else {
      rows.push({ op: "added", cols: [b[j] as string] });
      j++;
    }
  }
  while (i < n) rows.push({ op: "removed", cols: [a[i++] as string] });
  while (j < m) rows.push({ op: "added", cols: [b[j++] as string] });
  return rows;
}
