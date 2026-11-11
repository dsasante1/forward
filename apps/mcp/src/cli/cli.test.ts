import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initRepo } from "forward-core/repo";
import { parseArgs } from "./args.js";
import { coerceFlags, parseBatch, resolveRefs, runBatch, type ToolInfo } from "./call.js";
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

describe("batch", () => {
  it("parses a JSON array or JSON Lines, skipping comments", () => {
    const steps = [{ tool: "a", args: { x: 1 }, as: "first" }, { tool: "b" }];
    expect(parseBatch(JSON.stringify(steps))).toEqual(steps);
    expect(parseBatch(`# setup\n{"tool":"a","args":{"x":1},"as":"first"}\n\n// then\n{"tool":"b"}\n`)).toEqual(steps);
    expect(() => parseBatch(`{"args":{}}`)).toThrow(/needs a "tool"/);
  });

  it("resolves whole-string references to earlier results, by name or index", () => {
    const results = new Map<string, unknown>([["frame", { id: "el_1", refs: { card: "el_2" } }], ["0", { id: "el_1" }]]);
    expect(resolveRefs({ parentId: "$frame.id", list: ["$0.id", "$frame.refs.card"], note: "costs $5", n: 3 }, results)).toEqual({
      parentId: "el_1",
      list: ["el_1", "el_2"],
      note: "costs $5",
      n: 3,
    });
    expect(() => resolveRefs("$nope.id", results)).toThrow(/no earlier step named "nope"/);
    expect(() => resolveRefs("$frame.missing", results)).toThrow(/has no "missing"/);
  });

  it("feeds results forward and stops at the first failure", async () => {
    const calls: Array<[string, unknown]> = [];
    const fake = async (tool: string, args: Record<string, unknown>) => {
      calls.push([tool, args]);
      return tool === "boom" ? { text: "it broke", isError: true } : { text: JSON.stringify({ id: `${tool}_id` }), isError: false };
    };
    const out = await runBatch(
      [{ tool: "make", as: "m" }, { tool: "use", args: { parent: "$m.id", prev: "$0.id" } }, { tool: "boom" }, { tool: "never" }],
      fake,
    );
    expect(calls.map(([t]) => t)).toEqual(["make", "use", "boom"]);
    expect(calls[1]![1]).toEqual({ parent: "make_id", prev: "make_id" });
    expect(out.map((o) => o.ok)).toEqual([true, true, false]);
    expect(out[2]).toMatchObject({ step: 2, tool: "boom", result: "it broke" });
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

    // An update touches only the fields it passes; list_tasks without filters lists everything.
    const busy = await create({
      title: "Busy",
      type: "bug",
      status: "blocked",
      priority: "urgent",
      labels: ["backend"],
      assignees: ["ada"],
      dependsOn: [api.id],
    });
    expect((await callTool("update_task", { taskId: busy.id, title: "Busy, renamed" })).isError).toBe(false);
    const kept = JSON.parse((await callTool("get_task", { taskId: busy.id })).text).task;
    expect(kept).toMatchObject({
      title: "Busy, renamed",
      type: "bug",
      status: "blocked",
      priority: "urgent",
      labels: ["backend"],
      assignees: ["ada"],
      dependsOn: [api.id],
    });
    const listed = JSON.parse((await callTool("list_tasks", {})).text);
    expect(listed.count).toBe(4);
    expect(new Set(listed.tasks.map((t: { status: string }) => t.status))).toEqual(new Set(["todo", "blocked"]));

    // An empty start date clears it, and the change is logged.
    expect((await callTool("update_task", { taskId: ui.id, startDate: "" })).isError).toBe(false);
    const task = JSON.parse((await callTool("get_task", { taskId: ui.id })).text).task;
    expect(task.startDate).toBeUndefined();
    expect(task.activity.at(-1)).toMatchObject({ verb: "cleared the start date" });
  });

  it("creates an image element, fills an existing shape, removes it and prunes the file", async () => {
    // A 1×1 PNG, and an SVG the store must refuse.
    const PNG_1X1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    writeFileSync(join(root, "logo.png"), Buffer.from(PNG_1X1, "base64"));
    writeFileSync(join(root, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { callTool } = await import("./call.js");
    const json = async (name: string, args: Record<string, unknown>) => {
      const res = await callTool(name, args);
      expect(res.isError, res.text).toBe(false);
      return JSON.parse(res.text);
    };
    const created = await json("set_element_image", { path: join(root, "logo.png"), x: 10, y: 20 });
    expect(created).toMatchObject({ action: "created", width: 1, height: 1 });
    expect(created.asset).toMatch(/^[a-f0-9]{64}\.png$/);
    const el = JSON.parse(readFileSync(join(root, ".forward/design", `${created.id}.json`), "utf8"));
    expect(el.style.image).toEqual({ asset: created.asset, fit: "cover", naturalWidth: 1, naturalHeight: 1, alt: "logo" });
    expect(el).toMatchObject({ type: "rectangle", name: "image logo", x: 10, y: 20 });

    const box = await json("create_element", { type: "ellipse", name: "Avatar", x: 0, y: 0, width: 40, height: 40 });
    await json("set_element_image", { elementId: box.id, path: join(root, "logo.png"), fit: "contain", alt: "Ada" });
    const listed = await json("list_images", {});
    expect(listed).toEqual([expect.objectContaining({ name: created.asset, elements: expect.arrayContaining([created.id, box.id]) })]);

    const svg = await callTool("set_element_image", { path: join(root, "logo.svg") });
    expect(svg.isError).toBe(true);
    expect(svg.text).toMatch(/SVG is not accepted/);

    await json("set_element_image", { elementId: box.id, remove: true });
    await json("delete_element", { elementId: created.id });
    expect((await json("list_images", { prune: true, dryRun: true })).removed).toEqual([created.asset]);
    expect(existsSync(join(root, ".forward/assets", created.asset))).toBe(true);
    expect((await json("list_images", { prune: true })).removed).toEqual([created.asset]);
    expect(existsSync(join(root, ".forward/assets", created.asset))).toBe(false);
  });
});

const BUILT_CLI = join(import.meta.dirname, "../../dist/cli.js");

describe.skipIf(!existsSync(BUILT_CLI) || process.platform === "win32")("the built CLI", () => {
  it("exports the images the design uses into images/ and lists and prunes the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "forward-export-images-"));
    try {
      initRepo(dir, { name: "Export" });
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      writeFileSync(join(dir, "a.png"), Buffer.from(png, "base64"));
      writeFileSync(join(dir, "b.gif"), Buffer.from([...Buffer.from("GIF89a"), 1, 0, 1, 0, 0, 0, 0, 0x3b]));
      const run = (...args: string[]) =>
        execFileSync(process.execPath, [BUILT_CLI, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, FORWARD_REPO: dir } });
      const used = JSON.parse(run("set_element_image", "--path", join(dir, "a.png"))).asset as string;
      const spare = JSON.parse(run("set_element_image", "--path", join(dir, "b.gif"))) as { id: string; asset: string };
      run("delete_element", "--element-id", spare.id);

      run("export", "--out", join(dir, "_site"), "--no-history");
      expect(readdirSync(join(dir, "_site", "images"))).toEqual([used]);

      const listed = JSON.parse(run("assets", "--json")) as Array<{ name: string; used: boolean }>;
      expect(listed.map((a) => [a.name, a.used]).sort()).toEqual([[spare.asset, false], [used, true]].sort());
      expect(run("assets", "prune", "--dry-run")).toContain(`would remove  ${spare.asset}`);
      run("assets", "prune");
      expect(readdirSync(join(dir, ".forward", "assets"))).toEqual([used]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

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
