import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initRepo } from "forward-core/repo";
import { parseArgs } from "./args.js";
import { coerceFlags, type ToolInfo } from "./call.js";
import { ACTION_REF, AGENT_INSTRUCTIONS, scaffoldAgents, workflowYaml } from "./scaffold.js";
import { VERSION } from "../version.js";

describe("parseArgs", () => {
  it("handles positionals, values, = values, booleans and negation", () => {
    expect(parseArgs(["serve", "--port", "1", "--host=0.0.0.0", "--open", "--no-agents", "--", "--raw"])).toEqual({
      positionals: ["serve", "--raw"],
      flags: { port: "1", host: "0.0.0.0", open: true, agents: false },
    });
  });
});

describe("coerceFlags", () => {
  const tool: ToolInfo = {
    name: "t",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        x: { type: "number" },
        done: { type: "boolean" },
        labels: { type: "array", items: { type: "string" } },
        style: { type: "object" },
      },
    },
  };
  it("coerces to schema types and accepts kebab-case names", () => {
    expect(
      coerceFlags(tool, { "element-id": "el_1", x: "12.5", done: "true", labels: "a, b", style: '{"fill":"#fff"}' }),
    ).toEqual({ elementId: "el_1", x: 12.5, done: true, labels: ["a", "b"], style: { fill: "#fff" } });
  });
  it("rejects unknown arguments and bad numbers", () => {
    expect(() => coerceFlags(tool, { nope: "1" })).toThrow(/Unknown argument --nope/);
    expect(() => coerceFlags(tool, { x: "abc" })).toThrow(/must be a number/);
  });
});

describe("scaffoldAgents", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "forward-scaffold-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("writes configs once, keeps user content, and never clobbers an existing server", () => {
    writeFileSync(join(root, "AGENTS.md"), "# My rules\n");
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const first = scaffoldAgents(root, ["agents-md", "claude", "cursor", "vscode"]);
    expect(first.written.sort()).toEqual([".cursor/mcp.json", ".mcp.json", ".vscode/mcp.json", "AGENTS.md", "CLAUDE.md"]);
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# My rules\n")).toBe(true);
    expect(agents).toContain(AGENT_INSTRUCTIONS.trim());
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["other", "forward"]);
    expect(mcp.mcpServers.forward.args).toEqual(["-y", "forward-mcp"]);

    const second = scaffoldAgents(root, ["agents-md", "claude", "cursor", "vscode"]);
    expect(second.written).toEqual([]);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(agents);
  });

  it("renders a workflow for the given branch", () => {
    expect(workflowYaml("trunk")).toContain('branches: ["trunk"]');
  });

  it("pins the Action and the CLI to this release, never a branch", () => {
    const yaml = workflowYaml("main");
    expect(ACTION_REF).toBe(`dsasante1/forward@mcp-v${VERSION}`);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(yaml.match(/uses: dsasante1\/forward@\S+/g)).toEqual([`uses: ${ACTION_REF}`, `uses: ${ACTION_REF}`]);
    expect(yaml.match(/cli-version: \S+/g)).toEqual([`cli-version: "${VERSION}"`, `cli-version: "${VERSION}"`]);
  });
});

describe("tools through the in-memory client (repo mode)", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "forward-cli-"));
    initRepo(root, { name: "CLI Test" });
    process.env.FORWARD_REPO = root;
  });
  afterAll(async () => {
    const { close } = await import("./call.js");
    await close();
    delete process.env.FORWARD_REPO;
    rmSync(root, { recursive: true, force: true });
  });

  it("lists every tool and runs one against the repo", async () => {
    const { callTool, listTools } = await import("./call.js");
    const names = (await listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["project_info", "write_documentation", "get_changes_since_ref"]));

    const created = await callTool("create_element", { type: "frame", name: "Checkout", x: 0, y: 0, width: 100, height: 100 });
    expect(created.isError).toBe(false);
    const { id } = JSON.parse(created.text) as { id: string };
    const doc = await callTool("write_documentation", { elementId: id, title: "POST /checkout", description: "Pays." });
    expect(doc.isError).toBe(false);

    const info = JSON.parse((await callTool("project_info", {})).text);
    expect(info.mode.kind).toBe("repo");
    expect(info.counts).toMatchObject({ designElements: 1, documentedEndpoints: 1 });

    const valid = JSON.parse((await callTool("validate_project", {})).text);
    expect(valid.valid).toBe(true);
  });

  it("schedules tasks and reports them as a gantt timeline", async () => {
    const { callTool } = await import("./call.js");
    const create = async (args: Record<string, unknown>) => {
      const res = await callTool("create_task", args);
      expect(res.isError, res.text).toBe(false);
      return JSON.parse(res.text) as { id: string; key: string };
    };
    const api = await create({ title: "Build: the API", startDate: "2026-11-02", dueDate: "2026-11-06" });
    const ui = await create({ title: "UI", startDate: "2026-11-04", dueDate: "2026-11-10", dependsOn: [api.id] });
    for (const dates of [{ startDate: "next week" }, { dueDate: "Nov 20" }]) {
      const bad = await callTool("create_task", { title: "Nope", ...dates });
      expect(bad.isError).toBe(true);
      expect(bad.text).toMatch(/ISO date/);
    }
    // A milestone filed before due dates had to be ISO still loads, with a warning.
    const legacy = { id: "legacy", key: "FWD-9", title: "Launch", type: "milestone", dueDate: "Nov 20" };
    const stamp = "2026-10-01T00:00:00.000Z";
    writeFileSync(join(root, ".forward/tasks/legacy.json"), JSON.stringify({ ...legacy, createdAt: stamp, updatedAt: stamp }));

    const timeline = JSON.parse((await callTool("get_task_timeline", {})).text);
    expect(timeline.ganttDiagram).toMatch(new RegExp(`\\n  ${api.key} Build꞉ the API :t\\d, 2026-11-02, 5d\\n`));
    expect(timeline.tasks.find((t: { id: string }) => t.id === ui.id)).toMatchObject({ start: "2026-11-04", end: "2026-11-10" });
    expect(timeline.warnings).toEqual([
      expect.stringMatching(/due date "Nov 20" isn't an ISO date/),
      `${ui.key} starts 2026-11-04, before ${api.key} is due (2026-11-06).`,
    ]);

    // An empty start date clears it, and the change is logged.
    expect((await callTool("update_task", { taskId: ui.id, startDate: "" })).isError).toBe(false);
    const task = JSON.parse((await callTool("get_task", { taskId: ui.id })).text).task;
    expect(task.startDate).toBeUndefined();
    expect(task.activity.at(-1)).toMatchObject({ verb: "cleared the start date" });
  });
});

const BUILT_CLI = join(import.meta.dirname, "../../dist/cli.js");

describe.skipIf(!existsSync(BUILT_CLI) || process.platform === "win32")("the built CLI", () => {
  it("writes all of a large output before it exits, even into a pipe nobody is reading yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "forward-pipe-"));
    try {
      // Into a file (written synchronously): the whole output, for comparison.
      const file = join(dir, "tools.json");
      execFileSync("sh", ["-c", '"$0" "$1" tools --json > "$2"', process.execPath, BUILT_CLI, file]);
      const whole = readFileSync(file, "utf8");
      expect(whole.length, "the output must overflow one pipe buffer to test this").toBeGreaterThan(65_536);

      // Into a pipe whose reader falls behind, as `| jq` can on a busy machine:
      // it starts reading once forward has exited or 3s have passed. A forward
      // that exits without draining has lost the rest by then; one that waits
      // for the reader is still there, and delivers it all.
      const done = join(dir, "exited");
      const lag = 'i=0; until [ -e "$2" ] || [ $i -ge 60 ]; do sleep 0.05; i=$((i+1)); done; cat';
      const piped = execFileSync(
        "sh",
        ["-c", `{ "$0" "$1" tools --json; : > "$2"; } | { ${lag}; }`, process.execPath, BUILT_CLI, done],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 20_000 },
      );
      expect(piped).toBe(whole);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
