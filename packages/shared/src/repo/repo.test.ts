import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../api-rest.js";
import type { DesignElement, InfraNode, Task } from "../schema.js";
import {
  checkoutForwardAt,
  diffProjects,
  fileNameForId,
  findRepoRoot,
  initRepo,
  loadBundle,
  projectTimeline,
  renderDiffMarkdown,
  repoConfig,
  validateRepo,
} from "./index.js";

const T = "2026-01-01T00:00:00.000Z";
const el = (id: string, extra: Partial<DesignElement> = {}) =>
  ({ id, type: "rectangle", name: id, x: 0, y: 0, width: 10, height: 10, updatedAt: T, ...extra }) as DesignElement;
const node = (id: string): InfraNode =>
  ({ id, kind: "backend", label: id, x: 0, y: 0, updatedAt: T }) as InfraNode;

let root: string;
let cfg: api.ApiConfig;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forward-repo-test-"));
  initRepo(root, { name: "Demo App" });
  cfg = repoConfig(root, { author: "tester" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("repo mode through forward-core/api", () => {
  it("derives the project id from the manifest", () => {
    expect(cfg.projectId).toBe("demo-app");
    expect(findRepoRoot(join(root, ".forward"))).toBe(root);
  });

  it("saves elements as one file each and never persists a binding via saveElement", async () => {
    await api.saveElement(cfg, el("btn"));
    await api.bindApiToElement(cfg, "btn", { title: "POST /login", description: "Logs in" }, { version: "v1", changeLog: "first", action: "created" });
    // A save that (illegally, via a cast) carries a different binding keeps the stored one.
    await api.saveElement(cfg, { ...el("btn", { x: 5 }), apiBinding: { title: "HACK", description: "" } } as never);
    const [saved] = await api.fetchElements(cfg);
    expect(saved?.x).toBe(5);
    expect(saved?.apiBinding?.title).toBe("POST /login");
    expect(existsSync(join(root, ".forward/design/btn.json"))).toBe(true);
    expect(readFileSync(join(root, ".forward/design/btn.json"), "utf8").endsWith("\n")).toBe(true);
  });

  it("appends an immutable history entry with a diff on bind and unbind", async () => {
    await api.saveElement(cfg, el("btn"));
    await api.bindApiToElement(cfg, "btn", { title: "GET /a", description: "one" }, { version: "v1", changeLog: "c1", action: "created" });
    await api.bindApiToElement(cfg, "btn", { title: "GET /a", description: "two" }, { version: "v2", changeLog: "c2" });
    await api.unbindApiFromElement(cfg, "btn", { version: "v3", changeLog: "gone", endpoint: { title: "GET /a" } } as never);
    const { timelines } = await api.fetchTimelinesConditional(cfg, undefined);
    const entries = timelines.btn ?? [];
    expect(entries.map((e) => e.action)).toEqual(["created", "modified", "deleted"]);
    expect(entries[1]?.diff?.added).toBe(1);
    expect(entries.every((e) => e.author === "tester")).toBe(true);
    expect(readdirSync(join(root, ".forward/history/btn"))).toHaveLength(3);
    expect((await api.fetchElements(cfg))[0]?.apiBinding).toBeUndefined();
  });

  it("cascades element deletes to the subtree and keeps history", async () => {
    await api.saveElement(cfg, el("frame"));
    await api.saveElement(cfg, el("child", { parentId: "frame" }));
    await api.saveElement(cfg, el("other"));
    await api.bindApiToElement(cfg, "child", { title: "x", description: "" }, { version: "v1", changeLog: "" });
    const deleted = await api.deleteElement(cfg, "frame");
    expect(deleted.sort()).toEqual(["child", "frame"]);
    expect((await api.fetchElements(cfg)).map((e) => e.id)).toEqual(["other"]);
    expect((await api.fetchTimelinesConditional(cfg, undefined)).timelines.child).toHaveLength(1);
  });

  it("cascades infra node and MCP server deletes like the server", async () => {
    await api.saveInfraNode(cfg, node("a"));
    await api.saveInfraNode(cfg, node("b"));
    await api.saveInfraEdge(cfg, { id: "e", from: "a", to: "b", updatedAt: T });
    await api.deleteInfraNode(cfg, "a");
    expect((await api.fetchInfra(cfg)).edges).toEqual([]);

    await api.saveMcpServer(cfg, { id: "s", label: "S", transport: "stdio", origin: "built", tools: [], x: 0, y: 0, updatedAt: T } as never);
    await api.saveAgentNode(cfg, { id: "ag", label: "A", mcpServerIds: ["s"], x: 0, y: 0, updatedAt: T } as never);
    await api.deleteMcpServer(cfg, "s");
    expect((await api.fetchAgents(cfg)).agents[0]?.mcpServerIds).toEqual([]);
  });

  it("rejects invalid bodies with a readable 400", async () => {
    await expect(api.saveInfraNode(cfg, { id: "x" } as never)).rejects.toThrow(/Invalid infra node/);
    await expect(api.patchElement(cfg, "missing", { x: 1 })).rejects.toThrow(/No design element "missing"/);
  });

  it("assigns task keys and preserves createdAt", async () => {
    const task = { id: "t1", title: "Do it", createdAt: T, updatedAt: T } as Task;
    await api.saveTask(cfg, task);
    await api.saveTask(cfg, { ...task, createdAt: "2030-01-01T00:00:00.000Z", title: "Done" });
    const [saved] = await api.fetchTasks(cfg);
    expect(saved?.key).toMatch(/^FWD-\d+$/);
    expect(saved?.createdAt).toBe(T);
    expect(saved?.title).toBe("Done");
  });

  it("creates and restores checkpoints", async () => {
    await api.saveElement(cfg, el("keep"));
    const cp = await api.createCheckpoint(cfg, { title: "Before", description: "", tag: "checkpoint" });
    expect(cp.changes).toEqual([{ layer: "DESIGN", n: 1 }]);
    await api.saveElement(cfg, el("extra"));
    await api.deleteElement(cfg, "keep");
    await api.restoreCheckpoint(cfg, cp.id);
    expect((await api.fetchElements(cfg)).map((e) => e.id)).toEqual(["keep"]);
  });

  it("keeps odd ids inside their directory", async () => {
    const id = "../../etc/passwd";
    await api.saveElement(cfg, el(id));
    expect(fileNameForId(id)).not.toContain("/");
    expect((await api.fetchElements(cfg)).map((e) => e.id)).toEqual([id]);
    await api.deleteElement(cfg, id);
    expect(await api.fetchElements(cfg)).toEqual([]);
  });
});

describe("git integration", () => {
  beforeEach(() => {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Ada");
    git("config", "user.email", "ada@example.com");
    git("config", "commit.gpgsign", "false");
  });

  it("builds the project timeline from commits plus uncommitted work", async () => {
    await api.saveElement(cfg, el("btn"));
    await api.saveInfraNode(cfg, node("api"));
    git("add", "-A");
    git("commit", "-qm", "Add login button");
    await api.bindApiToElement(cfg, "btn", { title: "POST /login", description: "" }, { version: "v1", changeLog: "Documented login", action: "created" });

    const events = projectTimeline(root);
    const api0 = events.find((e) => e.domain === "api");
    expect(api0).toMatchObject({ action: "created", targetId: "btn", title: "POST /login", detail: "Documented login" });
    // The doc save also rewrote design/btn.json; that pairs with the api event and is not repeated.
    expect(events.filter((e) => e.domain === "design" && e.action === "modified")).toHaveLength(0);
    expect(events.find((e) => e.domain === "infra")).toMatchObject({ action: "created", author: "Ada" });
    expect((await api.fetchProjectTimeline(cfg)).length).toBe(events.length);
  });

  it("diffs a past ref against the working tree into a PR digest", async () => {
    await api.saveElement(cfg, el("btn"));
    await api.saveElement(cfg, el("old"));
    await api.bindApiToElement(cfg, "old", { title: "GET /old", description: "" }, { version: "v1", changeLog: "" });
    git("add", "-A");
    git("commit", "-qm", "base");

    await api.bindApiToElement(cfg, "btn", { title: "POST /login", description: "Body: email" }, { version: "v1", changeLog: "Login endpoint", action: "created" });
    await api.unbindApiFromElement(cfg, "old", { version: "v2", changeLog: "Retired" });
    await api.saveInfraNode(cfg, node("db"));

    const baseRoot = checkoutForwardAt(root, "HEAD");
    expect(baseRoot).toBeDefined();
    const diff = diffProjects(loadBundle(baseRoot!, { timeline: false }), loadBundle(root, { timeline: false }));
    expect(diff.api.toIntegrate.map((c) => c.title)).toEqual(["POST /login"]);
    expect(diff.api.toIntegrate[0]?.changeLogs).toEqual(["Login endpoint"]);
    expect(diff.api.toRemove.map((c) => c.title)).toEqual(["GET /old"]);
    expect(diff.layers.find((l) => l.layer === "Infra nodes")?.added).toEqual(["db (db)"]);
    // A doc-only change is not reported as a design change.
    expect(diff.layers.find((l) => l.layer === "Design elements")).toBeUndefined();
    const md = renderDiffMarkdown(diff);
    expect(md).toContain("<!-- forward-digest -->");
    expect(md).toContain("**POST /login**");
    rmSync(baseRoot!, { recursive: true, force: true });
  });

  it("lists git contributors as the roster", async () => {
    await api.saveElement(cfg, el("a"));
    git("add", "-A");
    git("commit", "-qm", "x");
    const members = await api.listMembers(cfg);
    expect(members.map((m) => m.name)).toContain("Ada");
  });
});

describe("validateRepo", () => {
  it("passes a clean project and flags broken files and dangling links", async () => {
    await api.saveElement(cfg, el("a"));
    expect(validateRepo(root)).toEqual([]);

    await api.saveElement(cfg, el("b", { parentId: "ghost" }));
    writeFileSync(join(root, ".forward/design/bad.json"), "{ nope");
    writeFileSync(join(root, ".forward/design/renamed.json"), JSON.stringify(el("not-renamed")));
    const issues = validateRepo(root);
    expect(issues.filter((i) => i.level === "error").map((i) => i.file).sort()).toEqual([
      ".forward/design/bad.json",
      ".forward/design/renamed.json",
    ]);
    expect(issues.find((i) => i.level === "warning")?.message).toMatch(/parentId "ghost"/);
  });
});
