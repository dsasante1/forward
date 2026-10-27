/// <reference types="node" />
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { FORMAT_VERSION, FORWARD_DIR, MANIFEST_FILE } from "./layout.js";
import { toJson, type RepoManifest } from "./store.js";

export interface InitOptions {
  /** Display name. Defaults to the directory name. */
  name?: string;
  /** Project id. Defaults to a slug of the name. */
  id?: string;
}

/** Create `.forward/` with a manifest and a short README. Idempotent. */
export function initRepo(root: string, opts: InitOptions = {}): { created: boolean; manifest: RepoManifest } {
  const dir = join(root, FORWARD_DIR);
  const file = join(dir, MANIFEST_FILE);
  const name = opts.name?.trim() || basename(root) || "forward";
  const manifest: RepoManifest = {
    format: FORMAT_VERSION,
    id: opts.id?.trim() || slug(name),
    name,
  };
  if (existsSync(file)) return { created: false, manifest };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, toJson(manifest));
  writeFileSync(join(dir, "README.md"), FORWARD_README);
  return { created: true, manifest };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "forward";
}

export const FORWARD_README = `# .forward

This directory is a [Forward](https://github.com/dsasante1/forward) project: the
UI design, the API documentation attached to it, the infrastructure graph and
flows, the data model, agents and tasks — stored as plain JSON so they are
versioned, reviewed and merged with the code.

Edit it with the tools, not by hand:

- \`npx -y -p forward-mcp forward serve\` opens the canvas editor on this directory.
- AI agents use the \`forward\` MCP server (\`npx -y forward-mcp\`) or the
  \`forward\` CLI (\`forward tools\`, \`forward call <tool> '{...}'\`).
- \`forward validate\` checks every file; CI runs it on each pull request.

Layout: one file per record, named after its id.

| Path | Holds |
|---|---|
| \`forward.json\` | project manifest (id, name, format) |
| \`design/\` | design elements, each with its optional \`apiBinding\` docs |
| \`history/<elementId>/\` | append-only API-doc history, one file per version |
| \`infra/nodes\`, \`infra/edges\`, \`infra/flows\` | infrastructure graph and narrated flows |
| \`data/entities\`, \`data/relations\` | ER data model |
| \`agents/agents\`, \`agents/servers\` | agents and the MCP servers they call |
| \`tasks/\` | task tracker |
| \`checkpoints/\` | named, restorable snapshots of design + infra |

The project activity feed is your git history: commit messages show up in the
History timeline.
`;
