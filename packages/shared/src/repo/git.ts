/// <reference types="node" />
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectTimelineEvent, TimelineDomain, VersionAction } from "../schema.js";
import { FORWARD_DIR, collectionOf, type CollectionKey } from "./layout.js";

/**
 * Git integration for repo mode. Git is optional: every helper degrades to an
 * empty result outside a repository, so a plain directory still works.
 */

function git(root: string, args: string[], input?: string): string | undefined {
  const res = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return res.status === 0 ? res.stdout : undefined;
}

export function isGitRepo(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
}

/** The top of the git work tree containing `dir`, if any. */
export function gitTopLevel(dir: string): string | undefined {
  return git(dir, ["rev-parse", "--show-toplevel"])?.trim() || undefined;
}

/** Who is writing: `$FORWARD_AUTHOR`, then git `user.name`, then the OS user. */
export function resolveAuthor(root: string): string {
  const env = process.env.FORWARD_AUTHOR?.trim();
  if (env) return env;
  const name = git(root, ["config", "user.name"])?.trim();
  if (name) return name;
  try {
    return userInfo().username || "local";
  } catch {
    return "local";
  }
}

/** Does `ref` name a commit in this repository? */
export function refExists(root: string, ref: string): boolean {
  return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined;
}

export interface Contributor {
  userId: string;
  email: string | null;
  name: string;
  /** A hosting-platform automation account (`name[bot]`), not a person. */
  bot: boolean;
  /** When they first committed to `.forward/`. */
  addedAt: string;
}

export interface Roster {
  members: Contributor[];
  /** The clone has only part of the history, so `members` may be incomplete. */
  shallow: boolean;
}

let lastRoster: { key: string; roster: Roster } | undefined;

/**
 * Everyone who has committed to `.forward/`, as a read-only roster. Identity is
 * the git author name after `.mailmap`, the same one the project timeline shows;
 * access is whatever the repository grants, so this grants nothing.
 *
 * It walks the whole history and the extension validates on every `.forward/`
 * change, so the last answer is kept until HEAD, the clone depth or `.mailmap`
 * moves.
 */
export function contributors(root: string): Roster {
  const state = git(root, ["rev-parse", "--is-shallow-repository", "--show-toplevel", "HEAD"]);
  if (!state) return { members: [], shallow: false }; // no git, or no commits yet
  const [shallow, top = root] = state.split("\n");
  const key = [root, state, mtimeOf(join(top, ".mailmap"))].join("\0");
  if (lastRoster?.key === key) return lastRoster.roster;

  const out = new Map<string, Contributor>();
  const log = git(root, ["log", "--reverse", "--format=%aN%x1f%aE%x1f%at", "--", FORWARD_DIR]);
  for (const line of (log ?? "").split("\n")) {
    // From the end: nothing stops an author name holding the separator, and this
    // history can be anyone's, so a malformed commit must not throw in `validate`.
    const fields = line.split("\x1f");
    const when = new Date(Number(fields.pop()) * 1000);
    const email = fields.pop();
    const name = fields.join("\x1f");
    if (!name || out.has(name)) continue;
    out.set(name, {
      userId: name,
      email: email || null,
      name,
      bot: /\[bot\]$/i.test(name),
      addedAt: (Number.isNaN(when.getTime()) ? new Date(0) : when).toISOString(),
    });
  }
  const roster = { members: [...out.values()], shallow: shallow === "true" };
  if (log !== undefined) lastRoster = { key, roster };
  return roster;
}

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

const DOMAIN: Partial<Record<CollectionKey, TimelineDomain>> = {
  elements: "design",
  history: "api",
  infraNodes: "infra",
  infraEdges: "infra",
  infraFlows: "flow",
  // The server files ER changes under "flow"; repo mode matches it.
  entities: "flow",
  relations: "flow",
  agents: "agent",
  servers: "agent",
};

interface FileChange {
  status: "A" | "M" | "D";
  /** Path relative to `.forward/`. */
  rel: string;
}

/**
 * The unified project activity feed, built from git history instead of a
 * database table: one event per changed record per commit, newest first, plus
 * the uncommitted changes in the working tree (stamped with the file's mtime) so
 * a live editing session sees its own work before it is committed.
 */
export function projectTimeline(root: string, limit = 500): ProjectTimelineEvent[] {
  if (!isGitRepo(root)) return [];
  const commits: Array<{ author: string; at: number; subject: string; files: FileChange[] }> = [];
  const log = git(root, [
    "log",
    `-n${limit}`,
    "--no-renames",
    "--format=%x1e%aN%x1f%at%x1f%s",
    "--name-status",
    "--",
    FORWARD_DIR,
  ]);
  for (const record of (log ?? "").split("\x1e")) {
    const [header, ...lines] = record.split("\n");
    if (!header) continue;
    const [author = "", at = "0", subject = ""] = header.split("\x1f");
    const files: FileChange[] = [];
    for (const line of lines) {
      const [status, path] = line.split("\t");
      const rel = relOf(path);
      if (!rel || (status !== "A" && status !== "M" && status !== "D")) continue;
      files.push({ status, rel });
    }
    commits.push({ author, at: Number(at) * 1000, subject, files });
  }
  commits.reverse(); // oldest first, so seq grows with time

  const events: ProjectTimelineEvent[] = [];
  let seq = 0;
  for (const c of commits) {
    for (const e of eventsFor(root, c.files, c.author, () => c.at, c.subject)) {
      events.push({ ...e, seq: ++seq });
    }
  }

  // Working-tree changes not yet committed.
  const status = git(root, ["status", "--porcelain=v1", "-uall", "-z", "--", FORWARD_DIR]);
  const pending: FileChange[] = [];
  for (const entry of (status ?? "").split("\0")) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const rel = relOf(entry.slice(3));
    if (!rel) continue;
    const s = code.includes("D") ? "D" : code === "??" || code.includes("A") ? "A" : "M";
    pending.push({ status: s, rel });
  }
  const self = resolveAuthor(root);
  const mtime = (rel: string) => {
    try {
      return Math.floor(statSync(join(root, FORWARD_DIR, rel)).mtimeMs);
    } catch {
      return Date.now();
    }
  };
  for (const e of eventsFor(root, pending, self, mtime, "Uncommitted")) {
    events.push({ ...e, seq: ++seq });
  }

  return events.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
}

function relOf(path: string | undefined): string | undefined {
  const prefix = `${FORWARD_DIR}/`;
  if (!path || !path.startsWith(prefix) || !path.endsWith(".json")) return undefined;
  return path.slice(prefix.length);
}

function eventsFor(
  root: string,
  files: FileChange[],
  author: string,
  when: (rel: string) => number,
  subject: string,
): Array<Omit<ProjectTimelineEvent, "seq">> {
  // A doc save rewrites the element file *and* adds a history entry; the server
  // records only the API event for it, so skip the paired design event.
  const documented = new Set(
    files.filter((f) => collectionOf(f.rel) === "history").map((f) => f.rel.split("/")[1]),
  );
  const out: Array<Omit<ProjectTimelineEvent, "seq">> = [];
  for (const f of files) {
    const key = collectionOf(f.rel);
    const domain = key ? DOMAIN[key] : undefined;
    if (!key || !domain) continue;
    const parts = f.rel.split("/");
    const fileId = (parts[parts.length - 1] ?? "").replace(/\.json$/, "");
    const current = f.status === "D" ? undefined : readJsonAt(root, f.rel);

    if (key === "history") {
      const elementId = parts[1] ?? fileId;
      const entry = current as
        | { action?: VersionAction; endpoint?: { title?: string }; changeLog?: string }
        | undefined;
      out.push({
        domain,
        action: entry?.action ?? "modified",
        targetId: elementId,
        title: entry?.endpoint?.title ?? elementId,
        detail: entry?.changeLog || subject,
        author,
        timestamp: when(f.rel),
      });
      continue;
    }
    if (key === "elements" && f.status === "M" && documented.has(fileId)) continue;

    const rec = (current ?? {}) as { id?: string; name?: string; label?: string };
    const id = rec.id ?? fileId;
    const title = rec.name || rec.label || id;
    const action: VersionAction =
      f.status === "A" ? "created" : f.status === "D" ? "deleted" : "modified";
    const verb = action === "created" ? "Added" : action === "deleted" ? "Removed" : "Updated";
    out.push({
      domain,
      action,
      targetId: id,
      title,
      detail: `${verb} ${noun(key)} "${title}" — ${subject}`,
      author,
      timestamp: when(f.rel),
    });
  }
  return out;
}

function noun(key: CollectionKey): string {
  switch (key) {
    case "elements": return "element";
    case "infraNodes": return "infra node";
    case "infraEdges": return "edge";
    case "infraFlows": return "flow";
    case "entities": return "entity";
    case "relations": return "relation";
    case "agents": return "agent";
    case "servers": return "MCP server";
    default: return "record";
  }
}

function readJsonAt(root: string, rel: string): unknown {
  try {
    return JSON.parse(readFileSync(join(root, FORWARD_DIR, rel), "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Materialize `.forward/` as it was at `ref` into a temporary directory, so a
 * {@link RepoStore} can read a past state. Returns the temp root, or undefined
 * when the ref doesn't exist or holds no Forward project.
 */
export function checkoutForwardAt(root: string, ref: string): string | undefined {
  if (!refExists(root, ref)) return undefined;
  const listing = git(root, ["ls-tree", "-r", "-z", "--name-only", ref, "--", FORWARD_DIR]);
  const paths = (listing ?? "").split("\0").filter(Boolean);
  const dest = mkdtempSync(join(tmpdir(), "forward-ref-"));
  if (!paths.length) return dest;
  // One `cat-file --batch` process instead of a `git show` per file.
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: paths.map((p) => `${ref}:${p}`).join("\n") + "\n",
    maxBuffer: 512 * 1024 * 1024,
  });
  let offset = 0;
  for (const path of paths) {
    const nl = raw.indexOf(0x0a, offset);
    const header = raw.subarray(offset, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    const body = raw.subarray(nl + 1, nl + 1 + size);
    offset = nl + 1 + size + 1;
    if (!Number.isFinite(size) || header.endsWith("missing")) continue;
    const file = join(dest, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return dest;
}
