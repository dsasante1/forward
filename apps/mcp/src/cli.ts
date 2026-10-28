#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  checkoutForwardAt,
  diffProjects,
  findRepoRoot,
  initRepo,
  loadBundle,
  refExists,
  renderDiffMarkdown,
  toJson,
  validateRepo,
} from "forward-core/repo";
import { parseArgs, str, type Args } from "./cli/args.js";
import { callTool, close, coerceFlags, listTools, type ToolInfo } from "./cli/call.js";
import { findBrowsers } from "./browser/find.js";
import { captureSnippet } from "./capture.js";
import { scaffoldAgents, scaffoldGithub, scaffoldRoot, type AgentTarget, type ScaffoldResult } from "./cli/scaffold.js";
import { serve } from "./cli/serve.js";
import { writeStaticSite } from "./cli/ui.js";
import { server } from "./tools.js";
import { VERSION } from "./version.js";

const HELP = `forward — design, API docs and architecture, versioned in your git repo.

Project
  forward init [--name <name>] [--id <id>] [--no-agents] [--no-github]
                             Create .forward/ here, plus agent configs and the GitHub workflow
  forward serve [--port 4747] [--host 127.0.0.1] [--open]
                             Open the canvas editor on .forward/
  forward validate [--format text|json|github] [--strict]
                             Check every file (CI runs this); exits 1 on errors
  forward diff <git-ref> [--format markdown|json] [--out <file>]
                             What changed since a ref: the catch-up digest for a PR
  forward export [--out _site] [--no-history]
                             Build a read-only static site for GitHub Pages
  forward capture <url> [route ...] [--browser auto|playwright|chrome|edge|brave|chromium|
                vivaldi|opera|<path>] [--viewport 1440x900] [--auth state.json]
                [--prune] [--restore] [--anchors] [--no-components] [--dry-run]
                             Generate design drafts from a running frontend, with the project's
                             Playwright or a Chromium-based browser you already have
  forward capture --browsers List the browsers live capture can use on this device
  forward capture --script [--route /path]
                             Print a DevTools snippet that captures the page in any browser
  forward capture --from <snapshot.json> [more.json ...] [--prune] [--restore] [--anchors] [--dry-run]
                             Import snapshots saved by that snippet

Agents
  forward agents [--claude] [--cursor] [--vscode] [--agents-md]
                             Write AGENTS.md / CLAUDE.md and MCP configs (all by default)
  forward github             Write .github/workflows/forward.yml
  forward mcp                Serve the agent tools over MCP stdio (same as forward-mcp)
  forward tools [<tool>] [--json]
                             List the agent tools, or one tool's arguments
  forward <tool> [--arg value ...]
  forward call <tool> ['<json args>' | -]
                             Run an agent tool from the shell (same code as MCP)

Environment
  FORWARD_REPO               Use this repository instead of searching up from the cwd
  FORWARD_AUTHOR             Name stamped on writes (default: git user.name)
  FORWARD_AGENT              Agent name added to the author, e.g. "Ada via claude"
`;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const [cmd, ...rest] = args.positionals;
  const sub: Args = { positionals: rest, flags: args.flags };

  switch (cmd) {
    case undefined:
    case "help":
      if (args.flags.version || args.flags.v) return printVersion();
      process.stdout.write(HELP);
      return 0;
    case "version":
      return printVersion();
    case "init":
      return cmdInit(sub);
    case "serve":
      return cmdServe(sub);
    case "validate":
      return cmdValidate(sub);
    case "diff":
      return cmdDiff(sub);
    case "export":
      return cmdExport(sub);
    case "capture":
      return cmdCapture(sub);
    case "agents":
      return cmdAgents(sub);
    case "github":
      return report(scaffoldGithub(scaffoldRoot(process.cwd())));
    case "mcp":
      await server.connect(new StdioServerTransport());
      console.error("[forward] MCP server ready on stdio");
      return new Promise<number>(() => {}); // run until stdin closes
    case "tools":
      return cmdTools(sub);
    case "call":
      return cmdCall(sub.positionals[0], sub);
    default:
      if (args.flags.help) {
        process.stdout.write(HELP);
        return 0;
      }
      return cmdCall(cmd, sub, true);
  }
}

function printVersion(): number {
  process.stdout.write(`${VERSION}\n`);
  return 0;
}

function requireRoot(): string {
  const root = findRepoRoot(process.cwd());
  if (!root) throw new Error("No .forward/ found here or above. Run `forward init` in your repository root.");
  return root;
}

function cmdInit(a: Args): number {
  const root = scaffoldRoot(process.cwd());
  const { created, manifest } = initRepo(root, {
    ...(str(a.flags.name) ? { name: str(a.flags.name)! } : {}),
    ...(str(a.flags.id) ? { id: str(a.flags.id)! } : {}),
  });
  console.log(
    created
      ? `Created .forward/ for "${manifest.name}" (project id ${manifest.id}) in ${root}`
      : `.forward/ already exists in ${root}`,
  );
  if (a.flags.agents !== false) report(scaffoldAgents(root, ["agents-md", "claude", "cursor"]));
  if (a.flags.github !== false) report(scaffoldGithub(root));
  console.log("\nNext: `forward serve` to open the canvas, then commit .forward/ with your code.");
  return 0;
}

function cmdAgents(a: Args): number {
  const all: AgentTarget[] = ["agents-md", "claude", "cursor", "vscode"];
  const picked = all.filter((t) => a.flags[t] === true);
  return report(scaffoldAgents(scaffoldRoot(process.cwd()), picked.length ? picked : all));
}

function report(r: ScaffoldResult): number {
  for (const f of r.written) console.log(`  wrote   ${f}`);
  for (const f of r.skipped) console.log(`  kept    ${f}`);
  for (const n of r.notes) console.log(`\n${n}`);
  return 0;
}

async function cmdServe(a: Args): Promise<number> {
  const root = requireRoot();
  const port = Number(str(a.flags.port) ?? process.env.PORT ?? 4747);
  const host = str(a.flags.host) ?? "127.0.0.1";
  const { url } = await serve({ root, port, host });
  console.log(`Forward canvas for ${root}\n  ${url}\nEdits are written to .forward/ — commit them with your code. Ctrl+C to stop.`);
  if (a.flags.open) openBrowser(url);
  return new Promise<number>(() => {});
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const argv = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, argv, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

function cmdValidate(a: Args): number {
  const root = requireRoot();
  const issues = validateRepo(root);
  const errors = issues.filter((i) => i.level === "error");
  const format = str(a.flags.format) ?? "text";
  if (format === "json") {
    console.log(JSON.stringify({ valid: errors.length === 0, issues }, null, 2));
  } else if (format === "github") {
    for (const i of issues) {
      const msg = i.message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      console.log(`::${i.level} file=${i.file}::${msg}`);
    }
    console.log(`Forward: ${errors.length} error(s), ${issues.length - errors.length} warning(s).`);
  } else {
    for (const i of issues) console.log(`${i.level === "error" ? "error  " : "warning"}  ${i.file}  ${i.message}`);
    console.log(issues.length ? `\n${errors.length} error(s), ${issues.length - errors.length} warning(s).` : "✓ .forward/ is valid.");
  }
  return errors.length || (a.flags.strict && issues.length) ? 1 : 0;
}

function cmdDiff(a: Args): number {
  const root = requireRoot();
  const ref = a.positionals[0];
  if (!ref) throw new Error("Usage: forward diff <git-ref>   (e.g. origin/main)");
  if (!refExists(root, ref)) throw new Error(`Unknown git ref "${ref}". In CI, check out with fetch-depth: 0.`);
  const baseRoot = checkoutForwardAt(root, ref);
  try {
    const before =
      baseRoot && existsSync(join(baseRoot, ".forward", "forward.json"))
        ? loadBundle(baseRoot, { timeline: false })
        : undefined;
    const diff = diffProjects(before, loadBundle(root, { timeline: false }));
    const out =
      str(a.flags.format) === "json"
        ? JSON.stringify(diff, null, 2) + "\n"
        : renderDiffMarkdown(diff, {
            title: str(a.flags.title) ?? `Forward changes since ${ref}`,
            ...(str(a.flags["viewer-url"]) ? { viewerUrl: str(a.flags["viewer-url"])! } : {}),
          });
    const file = str(a.flags.out);
    if (file) writeFileSync(file, out);
    else process.stdout.write(out);
    return 0;
  } finally {
    if (baseRoot) rmSync(baseRoot, { recursive: true, force: true });
  }
}

function cmdExport(a: Args): number {
  const root = requireRoot();
  const out = resolve(str(a.flags.out) ?? "_site");
  const bundle = loadBundle(root, { timeline: a.flags.history !== false });
  writeStaticSite(out, "forward.json");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "forward.json"), toJson(bundle));
  console.log(`Exported "${bundle.project.name}" (${bundle.elements.length} elements) to ${out}`);
  return 0;
}

async function cmdTools(a: Args): Promise<number> {
  const tools = await listTools();
  const name = a.positionals[0];
  if (name) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`No tool "${name}". Run \`forward tools\` for the list.`);
    if (a.flags.json) console.log(JSON.stringify(tool, null, 2));
    else printTool(tool);
    return 0;
  }
  if (a.flags.json) {
    console.log(JSON.stringify(tools, null, 2));
    return 0;
  }
  const width = Math.max(...tools.map((t) => t.name.length));
  for (const t of tools) {
    const summary = (t.description ?? "").split(/(?<=\.)\s/)[0] ?? "";
    console.log(`${t.name.padEnd(width)}  ${summary}`);
  }
  console.log(`\n${tools.length} tools. \`forward tools <tool>\` shows arguments; \`forward <tool> --arg value\` runs one.`);
  return 0;
}

function printTool(t: ToolInfo): void {
  console.log(`${t.name}${t.title ? ` — ${t.title}` : ""}\n\n${t.description ?? ""}\n`);
  const props = t.inputSchema.properties ?? {};
  const required = new Set(t.inputSchema.required ?? []);
  if (!Object.keys(props).length) {
    console.log("No arguments.");
    return;
  }
  console.log("Arguments:");
  for (const [k, p] of Object.entries(props)) {
    const type = Array.isArray(p.type) ? p.type.join("|") : p.type ?? (p.anyOf ? "any" : "");
    const choices = p.enum ? ` (${p.enum.join(", ")})` : "";
    console.log(`  --${k}  ${type}${choices}${required.has(k) ? "  required" : ""}`);
    if (p.description) console.log(`      ${p.description}`);
  }
}

/**
 * `forward capture`: the shell front door to `import_design_from_code`. The
 * tool does the work; this only turns positionals (url, routes, files) into
 * its arguments and prints the snippet, which needs no project at all.
 */
async function cmdCapture(a: Args): Promise<number> {
  const f = a.flags;
  if (f.script) {
    process.stdout.write(captureSnippet(str(f.route)));
    return 0;
  }
  if (f.browsers) {
    const found = findBrowsers();
    if (!found.length) {
      console.log("No Chromium-based browser found. Set FORWARD_BROWSER to one's path, or use `forward capture --script`.");
      return 0;
    }
    console.log("Live capture can use (first is the default after the project's Playwright):");
    for (const b of found) console.log(`  ${b.id.padEnd(9)} ${b.name.padEnd(15)} ${b.path}`);
    return 0;
  }
  const known = new Set(["from", "viewport", "auth", "wait", "prune", "anchors", "components", "dry-run", "route", "restore", "browser"]);
  for (const k of Object.keys(f)) {
    if (!known.has(k)) throw new Error(`Unknown option --${k} for capture. Run \`forward help\`.`);
  }
  const input: Record<string, unknown> = {};
  const from = str(f.from);
  if (from) {
    input.snapshotPath = [from, ...a.positionals];
  } else {
    const [url, ...routes] = a.positionals;
    if (!url) {
      throw new Error(
        "Usage: forward capture <url> [route ...] | forward capture --from <snapshot.json> | forward capture --script | forward capture --browsers",
      );
    }
    input.url = url;
    const extra = str(f.route);
    input.routes = [...routes, ...(extra ? [extra] : [])];
    if (str(f.viewport)) input.viewport = str(f.viewport);
    if (f.browser === true) throw new Error("--browser needs a value: auto, playwright, chrome, edge, chromium, brave, vivaldi, opera, or a path.");
    const browser = str(f.browser);
    // A path is the user's own choice, made here on the command line; it reaches
    // the capture through FORWARD_BROWSER (the tool itself takes names only).
    if (browser && /[\\/]/.test(browser)) process.env.FORWARD_BROWSER = resolve(process.cwd(), browser);
    else if (browser) input.browser = browser;
    if (str(f.auth)) input.storageState = str(f.auth);
    if (str(f.wait)) input.waitMs = Number(str(f.wait));
  }
  if (f.prune === true) input.prune = true;
  if (f.anchors === true) input.writeAnchors = true;
  if (f.components === false) input.detectComponents = false;
  if (f["dry-run"] === true) input.dryRun = true;
  if (f.restore === true) input.restoreDismissed = true;
  const res = await callTool("import_design_from_code", input);
  (res.isError ? process.stderr : process.stdout).write(res.text.endsWith("\n") ? res.text : `${res.text}\n`);
  return res.isError ? 1 : 0;
}

async function cmdCall(name: string | undefined, a: Args, implicit = false): Promise<number> {
  if (!name) throw new Error("Usage: forward call <tool> ['<json args>' | -]");
  const tools = await listTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    if (implicit) throw new Error(`Unknown command "${name}". Run \`forward help\`.`);
    throw new Error(`No tool "${name}". Run \`forward tools\` for the list.`);
  }
  let input: Record<string, unknown> = {};
  const raw = a.positionals[implicit ? 0 : 1];
  if (raw === "-") input = JSON.parse(await readStdin());
  else if (raw) input = JSON.parse(raw);
  Object.assign(input, coerceFlags(tool, a.flags));
  const res = await callTool(name, input);
  (res.isError ? process.stderr : process.stdout).write(res.text.endsWith("\n") ? res.text : `${res.text}\n`);
  return res.isError ? 1 : 0;
}

function readStdin(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Exit once stdout and stderr have drained: on a pipe their writes are
 * asynchronous, and exiting straight away cuts off large output (`tools --json`).
 */
function exitWhenFlushed(code: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

main(process.argv.slice(2))
  .then(async (code) => {
    await close();
    exitWhenFlushed(code);
  })
  .catch(async (err: Error) => {
    console.error(`forward: ${err.message}`);
    await close().catch(() => {});
    exitWhenFlushed(1);
  });
