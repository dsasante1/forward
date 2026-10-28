import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitTopLevel } from "forward-core/repo";
import { spawnSync } from "node:child_process";
import { VERSION } from "../version.js";

/** The package an agent runs. One name everywhere keeps the configs copy-pasteable. */
export const NPX_ARGS = ["-y", "forward-mcp"];
/**
 * The workflow pins the Action to the immutable `mcp-v<version>` release tag of the
 * CLI that wrote it (never a moving branch), and runs that same version from npm.
 */
export const ACTION_REF = `dsasante1/forward@mcp-v${VERSION}`;

const START = "<!-- forward:start -->";
const END = "<!-- forward:end -->";

/** Agent instructions, shared by every agent that reads AGENTS.md / CLAUDE.md. */
export const AGENT_INSTRUCTIONS = `${START}
## Forward: design, API docs and architecture live in \`.forward/\`

This repository keeps its UI design, the API documentation attached to it, the
infrastructure graph and flows, the data model and tasks in \`.forward/\`
([Forward](https://github.com/dsasante1/forward)). Keep it in step with the code.

- Use the \`forward\` MCP tools when connected. Without MCP, the CLI runs the same
  tools: \`npx -y -p forward-mcp forward tools\` lists them and
  \`npx -y -p forward-mcp forward <tool> --arg value\` calls one.
- Start with \`project_info\`. Find the design element behind a feature with
  \`find_element\`, then attach its API docs with \`write_documentation\`.
- When you add or change an endpoint, document it on its design element and mark
  the handler with an \`@adc <elementId> "label"\` comment so \`resolve_anchors\`
  can link code to design.
- When a screen exists in code but has no design, generate a draft from the
  running app with \`import_design_from_code\` (\`forward capture <url> <route>\`;
  \`dryRun\` first). Drafts stay in step with the code until someone edits or
  adopts them. If the app can't run, read the components and sketch the screen
  with \`create_element\` instead.
- When you add a service, queue, cache or database, update the architecture with
  \`write_infra_node\` and \`connect_infra\`. For schema changes use \`write_entity\`
  and \`relate_entities\`.
- Never hand-edit the JSON in \`.forward/\`. Run \`validate_project\` (or
  \`forward validate\`) before committing, and commit \`.forward/\` changes in the
  same commit as the code they describe.
- To brief someone on what changed, call \`get_changes_since_ref\` with the base
  branch (for example \`origin/main\`).
${END}
`;

export type AgentTarget = "agents-md" | "claude" | "cursor" | "vscode";

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
  notes: string[];
}

/** Write agent instructions + MCP client configs into `root`. Idempotent; never clobbers. */
export function scaffoldAgents(root: string, targets: AgentTarget[]): ScaffoldResult {
  const r: ScaffoldResult = { written: [], skipped: [], notes: [] };
  const want = new Set(targets);

  if (want.has("agents-md")) upsertBlock(root, "AGENTS.md", AGENT_INSTRUCTIONS, r);
  if (want.has("claude")) {
    const claudeMd = join(root, "CLAUDE.md");
    if (!existsSync(claudeMd)) {
      // Claude Code reads CLAUDE.md; import AGENTS.md so both stay one source.
      writeFileSync(claudeMd, "@AGENTS.md\n");
      r.written.push("CLAUDE.md");
    } else if (!/^@AGENTS\.md\s*$/m.test(readFileSync(claudeMd, "utf8"))) {
      upsertBlock(root, "CLAUDE.md", AGENT_INSTRUCTIONS, r);
    } else {
      r.skipped.push("CLAUDE.md (already imports AGENTS.md)");
    }
    mergeJson(root, ".mcp.json", ["mcpServers", "forward"], {
      command: "npx",
      args: NPX_ARGS,
      env: { FORWARD_AGENT: "claude" },
    }, r);
  }
  if (want.has("cursor")) {
    mergeJson(root, ".cursor/mcp.json", ["mcpServers", "forward"], {
      command: "npx",
      args: NPX_ARGS,
      env: { FORWARD_AGENT: "cursor" },
    }, r);
  }
  if (want.has("vscode")) {
    mergeJson(root, ".vscode/mcp.json", ["servers", "forward"], {
      type: "stdio",
      command: "npx",
      args: NPX_ARGS,
      env: { FORWARD_AGENT: "copilot" },
    }, r);
  }
  r.notes.push(
    "Codex reads AGENTS.md. Register the MCP server in ~/.codex/config.toml:\n" +
      "  [mcp_servers.forward]\n" +
      '  command = "npx"\n' +
      '  args = ["-y", "forward-mcp"]\n' +
      '  env = { FORWARD_AGENT = "codex" }',
    "Any other MCP client: run `npx -y forward-mcp` (stdio) from the repository root.",
  );
  return r;
}

function upsertBlock(root: string, rel: string, block: string, r: ScaffoldResult): void {
  const file = join(root, rel);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  let next: string;
  if (start >= 0 && end > start) {
    next = current.slice(0, start) + block.trimEnd() + current.slice(end + END.length);
  } else {
    next = current ? `${current.trimEnd()}\n\n${block}` : block;
  }
  if (next === current) {
    r.skipped.push(`${rel} (up to date)`);
    return;
  }
  writeFileSync(file, next);
  r.written.push(rel);
}

function mergeJson(
  root: string,
  rel: string,
  path: [string, string],
  value: unknown,
  r: ScaffoldResult,
): void {
  const file = join(root, rel);
  let doc: Record<string, Record<string, unknown>> = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      r.skipped.push(`${rel} (not valid JSON — add the forward server by hand)`);
      return;
    }
  }
  const [group, key] = path;
  doc[group] ??= {};
  if (doc[group]![key]) {
    r.skipped.push(`${rel} (already has "${key}")`);
    return;
  }
  doc[group]![key] = value;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  r.written.push(rel);
}

/** The branch Pages should deploy from: origin's default, else the current branch, else main. */
export function defaultBranch(root: string): string {
  const run = (args: string[]) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout?.trim();
  const remote = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (remote) return remote.replace(/^origin\//, "");
  return run(["branch", "--show-current"]) || "main";
}

/** The workflow a team drops into its repo: PR check + digest, and Pages on the default branch. */
export function workflowYaml(branch: string): string {
  return `# Forward: validate .forward/ and post a catch-up digest on pull requests,
# and publish a read-only canvas of ${branch} to GitHub Pages.
# Enable Pages with "Source: GitHub Actions" in Settings → Pages.
name: Forward

on:
  pull_request:
    paths: [".forward/**"]
  push:
    branches: [${JSON.stringify(branch)}]
    paths: [".forward/**"]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: forward-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ${ACTION_REF}
        with:
          cli-version: ${JSON.stringify(VERSION)}
          comment: true

  pages:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: forward
        uses: ${ACTION_REF}
        with:
          cli-version: ${JSON.stringify(VERSION)}
          export: _site
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deploy
        uses: actions/deploy-pages@v4
`;
}

export function scaffoldGithub(root: string): ScaffoldResult {
  const r: ScaffoldResult = { written: [], skipped: [], notes: [] };
  const rel = ".github/workflows/forward.yml";
  const file = join(root, rel);
  if (existsSync(file)) {
    r.skipped.push(`${rel} (exists)`);
    return r;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, workflowYaml(defaultBranch(root)));
  r.written.push(rel);
  r.notes.push("Turn on GitHub Pages with \"Source: GitHub Actions\" (Settings → Pages) to publish the canvas.");
  return r;
}

/** The repository root to scaffold into: the git top level, else the cwd. */
export function scaffoldRoot(cwd: string): string {
  return gitTopLevel(cwd) ?? cwd;
}
