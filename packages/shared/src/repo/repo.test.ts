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
  RepoStore,
  validateRepo,
} from "./index.js";

const T = "2026-01-01T00:00:00.000Z";
const el = (id: string, extra: Partial<DesignElement> = {}) =>
  ({ id, type: "rectangle", name: id, x: 0, y: 0, width: 10, height: 10, updatedAt: T, ...extra }) as DesignElement;
const node = (id: string): InfraNode =>
  ({ id, kind: "backend", label: id, x: 0, y: 0, updatedAt: T }) as InfraNode;

let root: string;
let cfg: api.ApiConfig;

// CI sets GIT_AUTHOR_* / GIT_COMMITTER_*, which beat the repo's user.name; drop
// them so commits are authored by the identity each test configures.
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(k)),
);

function git(...args: string[]) {
  execFileSync("git", args, { cwd: root, stdio: "ignore", env: gitEnv });
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

  it("keeps history in write order when entries share a millisecond", () => {
    const store = new RepoStore(root, { author: "tester", now: () => new Date(T) });
    store.saveElement(el("btn"));
    store.bind("btn", { binding: { title: "GET /a", description: "one" }, action: "created" });
    store.bind("btn", { binding: { title: "GET /a", description: "two" } });
    store.unbind("btn", {});
    store.bind("btn", { binding: { title: "GET /a", description: "back" }, action: "created" });
    const entries = store.timelines().btn ?? [];
    expect(entries.map((e) => e.action)).toEqual(["created", "modified", "deleted", "created"]);
    const stamps = entries.map((e) => e.timestamp);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(4);
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

describe("importDesign (generated from frontend code)", () => {
  const origin = (key: string, route = "/login") => ({ kind: "code" as const, route, viewport: "1440x900", key });
  const imported = (id: string, key: string, extra: Partial<DesignElement> = {}) => {
    const { updatedAt: _u, ...rest } = el(id, extra);
    return { ...rest, parentId: null, z: 0, rotation: 0, origin: origin(key) };
  };
  const run = (elements: unknown[], opts: { prune?: boolean; dryRun?: boolean } = {}) =>
    api.importDesign(cfg, { elements: elements as never, ...opts });

  it("creates on first import and writes nothing when the code is unchanged", async () => {
    const first = await run([imported("a", "ka"), imported("b", "kb")]);
    expect(first.created).toEqual(["a", "b"]);
    const stored = (await api.fetchElements(cfg)).find((e) => e.id === "a");
    expect(stored?.origin?.hash).toMatch(/^[0-9a-f]{14}$/);
    const before = readFileSync(join(root, ".forward/design/a.json"), "utf8");
    const second = await run([imported("a", "ka"), imported("b", "kb")]);
    expect(second.unchanged).toEqual(["a", "b"]);
    expect(second.created.length + second.updated.length).toBe(0);
    expect(readFileSync(join(root, ".forward/design/a.json"), "utf8")).toBe(before);
  });

  it("updates an untouched import and keeps its API docs", async () => {
    await run([imported("a", "ka")]);
    await api.bindApiToElement(cfg, "a", { title: "POST /login", description: "" }, { version: "v1", changeLog: "", action: "created" });
    const res = await run([imported("a", "ka", { x: 40 })]);
    expect(res.updated).toEqual(["a"]);
    const a = (await api.fetchElements(cfg)).find((e) => e.id === "a");
    expect(a?.x).toBe(40);
    expect(a?.apiBinding?.title).toBe("POST /login");
  });

  it("reports an edited import as a conflict and leaves the edit alone", async () => {
    await run([imported("a", "ka")]);
    await api.patchElement(cfg, "a", { x: 99 });
    const res = await run([imported("a", "ka", { x: 40 })]);
    expect(res.conflicts).toEqual([{ id: "a", name: "a" }]);
    expect((await api.fetchElements(cfg)).find((e) => e.id === "a")?.x).toBe(99);
  });

  it("treats a page dragged elsewhere (frame plus contents) as untouched", async () => {
    const { importedElementId } = await import("../design-import.js");
    const frameId = importedElementId("/login", "1440x900", "page");
    const page = (dx: number, extra: Partial<DesignElement> = {}) => [
      imported(frameId, "page", { type: "frame", x: dx, width: 500, height: 500 }),
      imported("child", "kc", { x: dx + 10, y: 10, parentId: frameId, ...extra }),
    ];
    await run(page(0));
    // The canvas moves a frame's whole subtree together.
    await api.patchElement(cfg, frameId, { x: 300, y: 40 });
    await api.patchElement(cfg, "child", { x: 310, y: 50 });
    // Placement puts the re-capture at the frame's current position.
    const same = await run(page(300).map((e) => ({ ...e, y: e.y + 40 })));
    expect(same.conflicts).toEqual([]);
    expect(same.unchanged.sort()).toEqual(["child", frameId].sort());
    // A real change to the code still flows through.
    const changed = await run(page(300, { width: 99 }).map((e) => ({ ...e, y: e.y + 40 })));
    expect(changed.updated).toEqual(["child"]);
    // Moving only the child is an edit.
    await api.patchElement(cfg, "child", { x: 0 });
    expect((await run(page(300).map((e) => ({ ...e, y: e.y + 40 })))).conflicts).toEqual([{ id: "child", name: "child" }]);
  });

  it("treats a fractional canvas drag (float noise) as untouched", async () => {
    const { importedElementId } = await import("../design-import.js");
    const frameId = importedElementId("/login", "1440x900", "page");
    const at = (fx: number, fy: number) => [
      imported(frameId, "page", { type: "frame", x: fx, y: fy, width: 500, height: 500 }),
      imported("child", "kc", { x: fx + 100, y: fy + 30, parentId: frameId }),
    ];
    await run(at(0, 0));
    // A drag at zoom 0.75 in seven pointermoves, applied as the canvas does (x += dx).
    const els = await api.fetchElements(cfg);
    for (const e of els) {
      let { x, y } = e;
      for (let i = 0; i < 7; i++) {
        x += 13.7 / 0.75;
        y += 9.1 / 0.75;
      }
      await api.patchElement(cfg, e.id, { x, y });
    }
    const frame = (await api.fetchElements(cfg)).find((e) => e.id === frameId) as DesignElement;
    expect(Number.isInteger(frame.x)).toBe(false);
    const res = await run(at(frame.x, frame.y));
    expect(res.conflicts).toEqual([]);
    // A code change on a page sitting at a fractional position imports cleanly, twice.
    const moved = (await run(at(frame.x, frame.y).map((e) => (e.id === "child" ? { ...e, width: 42 } : e)))).updated;
    expect(moved).toEqual(["child"]);
    const again = await run(at(frame.x, frame.y).map((e) => (e.id === "child" ? { ...e, width: 42 } : e)));
    expect(again.conflicts).toEqual([]);
    expect(again.unchanged.sort()).toEqual(["child", frameId].sort());
  });

  it("never touches an adopted or hand-drawn element with the same id", async () => {
    await run([imported("a", "ka")]);
    const a = (await api.fetchElements(cfg)).find((e) => e.id === "a");
    const { origin: _o, apiBinding: _b, ...adopted } = a as DesignElement;
    await api.saveElement(cfg, adopted);
    await api.saveElement(cfg, el("drawn"));
    const res = await run([imported("a", "ka", { x: 40 }), imported("drawn", "kd", { x: 40 })]);
    expect(res.skipped).toEqual(["a", "drawn"]);
    const after = await api.fetchElements(cfg);
    expect(after.find((e) => e.id === "a")?.x).toBe(0);
    expect(after.find((e) => e.id === "drawn")?.origin).toBeUndefined();
  });

  it("lets a save keep or drop origin but never set or forge one", async () => {
    await run([imported("a", "ka")]);
    const a = (await api.fetchElements(cfg)).find((e) => e.id === "a") as DesignElement;
    // Keeping: a canvas edit sends origin back unchanged → kept with the import's hash.
    const { apiBinding: _b, ...rest } = a;
    await api.saveElement(cfg, { ...rest, x: 5, origin: { ...a.origin!, hash: "forged" } });
    const kept = (await api.fetchElements(cfg)).find((e) => e.id === "a");
    expect(kept?.origin?.hash).toBe(a.origin?.hash);
    // Setting: a hand-drawn element can't claim to be imported.
    await api.saveElement(cfg, { ...el("drawn"), origin: a.origin } as never);
    await api.patchElement(cfg, "drawn", { origin: a.origin } as never);
    expect((await api.fetchElements(cfg)).find((e) => e.id === "drawn")?.origin).toBeUndefined();
  });

  it("validates every element before writing any", async () => {
    await expect(run([imported("a", "ka"), { ...imported("b", "kb"), width: -1 }])).rejects.toThrow(/elements\.1/);
    await expect(run([imported("a", "ka"), { ...imported("c", "kc"), origin: undefined }])).rejects.toThrow(/missing origin/);
    await expect(run([imported("a", "ka"), imported("a", "ka2")])).rejects.toThrow(/duplicate/);
    expect(await api.fetchElements(cfg)).toEqual([]);
  });

  it("reports without writing on a dry run", async () => {
    const res = await run([imported("a", "ka")], { dryRun: true });
    expect(res).toMatchObject({ dryRun: true, created: ["a"] });
    expect(await api.fetchElements(cfg)).toEqual([]);
  });

  it("prunes only untouched, undocumented imports of the same route, never cascading", async () => {
    await run([
      imported("frame", "page", { type: "frame", width: 500, height: 500 }),
      imported("gone", "kg", { parentId: "frame" }),
      imported("edited", "ke"),
      imported("documented", "kdoc"),
      imported("holder", "kh", { type: "frame", width: 100, height: 100 }),
    ]);
    await api.importDesign(cfg, { elements: [{ ...imported("other", "ko"), origin: origin("ko", "/settings") }] as never });
    await api.patchElement(cfg, "edited", { x: 3 });
    await api.bindApiToElement(cfg, "documented", { title: "GET /x", description: "" }, { version: "v1", changeLog: "", action: "created" });
    await api.saveElement(cfg, el("mine", { parentId: "holder" })); // a designer nested their own element
    const res = await run([imported("frame", "page", { type: "frame", width: 500, height: 500 })], { prune: true });
    expect(res.removed.sort()).toEqual(["gone"]);
    expect(res.kept).toEqual(
      expect.arrayContaining([
        { id: "edited", reason: "edited" },
        { id: "documented", reason: "documented" },
        { id: "holder", reason: "has-kept-children" },
      ]),
    );
    const ids = (await api.fetchElements(cfg)).map((e) => e.id).sort();
    expect(ids).toEqual(["documented", "edited", "frame", "holder", "mine", "other"]);
  });

  it("caps the number of elements per import", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => imported(`e${i}`, `k${i}`));
    await expect(run(many)).rejects.toThrow(/limit is 5000/);
  });

  it("leaves origin out of the PR digest's design changes", async () => {
    await run([imported("a", "ka")]);
    const before = loadBundle(root);
    const a = (await api.fetchElements(cfg)).find((e) => e.id === "a") as DesignElement;
    const { origin: _o, apiBinding: _b, ...adopted } = a;
    await api.saveElement(cfg, adopted);
    const digest = diffProjects(before, loadBundle(root));
    expect(digest.layers.find((l) => l.layer === "Design elements")).toBeUndefined();
    // …but it is summarised on its own line.
    expect(digest.adopted).toEqual(["a (a)"]);
    expect(renderDiffMarkdown(digest)).toMatch(/\*\*Adopted from code:\*\* 1 element — `a \(a\)`/);
    expect(renderDiffMarkdown({ ...digest, adopted: [] })).toMatch(/No changes/);
  });
});

describe("importDesign identity and dismissed drafts (through the real mapper)", () => {
  type N = { tag: string; rect: { x: number; y: number; w: number; h: number }; text?: string; style?: Record<string, string>; children?: N[] };
  const card = (y: number, text: string, w = 300): N => ({
    tag: "div",
    rect: { x: 0, y, w, h: 80 },
    style: { background: "#ffffff" },
    text,
  });
  const page = (children: N[]) => ({
    version: 1 as const,
    route: "/feed",
    viewport: { width: 1000, height: 800 },
    root: { tag: "body", rect: { x: 0, y: 0, w: 1000, h: 800 }, children },
  });
  const capture = async (children: N[], opts: { prune?: boolean; restoreDismissed?: boolean; dryRun?: boolean } = {}) => {
    const { mapSnapshot, placeSnapshots, CaptureSnapshot } = await import("../design-import.js");
    const snap = CaptureSnapshot.parse(page(children));
    const [at] = placeSnapshots([snap], await api.fetchElements(cfg));
    const { elements } = mapSnapshot(snap, { x: at?.x ?? 0, y: at?.y ?? 0 });
    return api.importDesign(cfg, { elements, ...opts });
  };
  const byText = async (text: string) => (await api.fetchElements(cfg)).filter((e) => e.text === text);

  it("keeps ids and API docs when a sibling is inserted before them", async () => {
    await capture([card(0, "Alpha"), card(100, "Beta")]);
    const [beta] = await byText("Beta");
    await api.bindApiToElement(cfg, beta!.id, { title: "GET /beta", description: "" }, { version: "v1", changeLog: "", action: "created" });

    const res = await capture([card(0, "Banner", 900), card(100, "Alpha"), card(200, "Beta")]);
    expect(res.created).toHaveLength(1); // only the banner
    expect(res.rematched.length).toBeGreaterThanOrEqual(1);
    expect(res.stale).toEqual([]);
    const after = await byText("Beta");
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(beta!.id);
    expect(after[0]?.apiBinding?.title).toBe("GET /beta");
    expect(after[0]?.y).toBe(200);
    // And it stays put on the next run.
    const again = await capture([card(0, "Banner", 900), card(100, "Alpha"), card(200, "Beta")]);
    expect(again.created.length + again.updated.length + again.rematched.length).toBe(0);
  });

  it("updates a draft in place when only its content changed", async () => {
    await capture([card(0, "Alpha"), card(100, "Beta")]);
    const [beta] = await byText("Beta");
    const res = await capture([card(0, "Alpha"), card(100, "Beta, renamed")]);
    expect(res.created).toEqual([]);
    expect(res.updated).toEqual([beta!.id]);
  });

  it("falls back to position for identical-looking siblings, without duplicate ids", async () => {
    await capture([card(0, "Same"), card(100, "Same")]);
    const res = await capture([card(0, "New", 500), card(100, "Same"), card(200, "Same")]);
    const ids = (await api.fetchElements(cfg)).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(await byText("Same")).toHaveLength(2);
    expect(res.stale).toEqual([]);
  });

  it("remembers a deleted draft and doesn't recreate it, even after its key shifts", async () => {
    await capture([card(0, "Alpha"), card(100, "Noise")]);
    const [noise] = await byText("Noise");
    await api.deleteElement(cfg, noise!.id);
    expect(existsSync(join(root, `.forward/dismissed/${noise!.id}.json`))).toBe(true);
    const plain = await capture([card(0, "Alpha"), card(100, "Noise")]);
    expect(plain.dismissed).toEqual([noise!.id]);
    expect(await byText("Noise")).toHaveLength(0);
    // A sibling inserted before it shifts its positional key; it is still recognised.
    const shifted = await capture([card(0, "Banner", 900), card(100, "Alpha"), card(200, "Noise")]);
    expect(shifted.dismissed).toEqual([noise!.id]);
    expect(await byText("Noise")).toHaveLength(0);
    expect(validateRepo(root).filter((i) => i.level === "error")).toEqual([]);
  });

  it("brings dismissed drafts back on request, and prune forgets ones the code dropped", async () => {
    await capture([card(0, "Alpha"), card(100, "Gone soon"), card(200, "Back")]);
    for (const t of ["Gone soon", "Back"]) await api.deleteElement(cfg, (await byText(t))[0]!.id);
    // Restore brings back what the code still renders and clears its record.
    const restored = await capture([card(0, "Alpha"), card(100, "Gone soon"), card(200, "Back")], { restoreDismissed: true });
    expect(restored.restored).toHaveLength(2);
    expect(readdirSync(join(root, ".forward/dismissed"))).toEqual([]);
    // Also when the deleted draft's key shifted since (a banner above it).
    await api.deleteElement(cfg, (await byText("Back"))[0]!.id);
    const shifted = await capture([card(0, "Banner", 900), card(100, "Alpha"), card(200, "Gone soon"), card(300, "Back")], { restoreDismissed: true });
    expect(shifted.restored).toHaveLength(1);
    expect(readdirSync(join(root, ".forward/dismissed"))).toEqual([]);
    await capture([card(0, "Alpha"), card(100, "Gone soon"), card(200, "Back")], { prune: true });
    await api.deleteElement(cfg, (await byText("Gone soon"))[0]!.id);
    // Without `prune` a record the code no longer matches is kept; with it, forgotten.
    const kept = await capture([card(0, "Alpha"), card(200, "Back")]);
    expect(kept.forgotten).toEqual([]);
    const pruned = await capture([card(0, "Alpha"), card(200, "Back")], { prune: true });
    expect(pruned.forgotten).toHaveLength(1);
    expect(readdirSync(join(root, ".forward/dismissed"))).toEqual([]);
  });

  it("reports stale drafts without removing them unless asked", async () => {
    await capture([card(0, "Alpha"), card(100, "Beta")]);
    const res = await capture([card(0, "Alpha")]);
    expect(res.stale).toHaveLength(1);
    expect(res.removed).toEqual([]);
    expect(await byText("Beta")).toHaveLength(1);
  });

  it("does not remember deletions of hand-drawn or adopted elements", async () => {
    await api.saveElement(cfg, el("drawn"));
    await api.deleteElement(cfg, "drawn");
    expect(existsSync(join(root, ".forward/dismissed"))).toBe(false);
  });

  it("re-parents children of a dismissed container to the nearest ancestor that stays", async () => {
    const box = (children: N[]): N => ({ tag: "section", rect: { x: 0, y: 0, w: 600, h: 400 }, style: { background: "#eee" }, text: "Panel", children });
    await capture([box([card(10, "Inner")])]);
    const panel = (await api.fetchElements(cfg)).find((e) => e.name === "Panel");
    // Delete only the panel itself (no cascade), as an agent might.
    await api.deleteElement(cfg, panel!.id, { cascade: false });
    await capture([box([card(10, "Inner")])]);
    const [inner] = await byText("Inner");
    const parent = (await api.fetchElements(cfg)).find((e) => e.id === inner?.parentId);
    expect(parent?.type).toBe("frame");
    expect(parent?.origin?.key).toBe("page");
  });
});

describe("importDesign never moves API docs onto a different element", () => {
  type N = {
    tag: string;
    rect: { x: number; y: number; w: number; h: number };
    text?: string;
    style?: Record<string, string>;
    attrs?: Record<string, string>;
    source?: string;
    component?: string;
    componentRoot?: boolean;
    children?: N[];
  };
  const box = (y: number, text: string, extra: Partial<N> = {}): N => ({
    tag: "button",
    rect: { x: 0, y, w: 120, h: 30 },
    style: { background: "#00f" },
    text,
    ...extra,
  });
  const capture = async (children: N[], opts: { prune?: boolean } = {}) => {
    const { mapSnapshot, placeSnapshots, CaptureSnapshot } = await import("../design-import.js");
    const snap = CaptureSnapshot.parse({
      version: 1,
      route: "/docs",
      viewport: { width: 1000, height: 800 },
      root: { tag: "body", rect: { x: 0, y: 0, w: 1000, h: 800 }, children },
    });
    const [at] = placeSnapshots([snap], await api.fetchElements(cfg));
    return api.importDesign(cfg, { elements: mapSnapshot(snap, { x: at?.x ?? 0, y: at?.y ?? 0 }).elements, ...opts });
  };
  const all = () => api.fetchElements(cfg);
  const doc = (id: string, title: string) =>
    api.bindApiToElement(cfg, id, { title, description: "" }, { version: "v1", changeLog: "", action: "created" });
  const docsOn = async (text: string) => (await all()).filter((e) => e.text === text).map((e) => e.apiBinding?.title ?? "-");

  it("list rows sharing one test id keep their own docs when a row is added on top", async () => {
    const row = (y: number, t: string) => box(y, t, { attrs: { testid: "row" } });
    await capture([row(0, "Alpha"), row(40, "Beta")]);
    await doc((await all()).find((e) => e.text === "Alpha")!.id, "GET /alpha");
    await capture([row(0, "Zeta"), row(40, "Alpha"), row(80, "Beta")]);
    expect(await docsOn("Alpha")).toEqual(["GET /alpha"]);
    expect(await docsOn("Zeta")).toEqual(["-"]);
  });

  it("JSX source lines that move (an edit above them) don't swap identities", async () => {
    const at = (line: number, t: string) => box(line, t, { source: `src/Form.tsx:${line}` });
    await capture([at(42, "Save"), at(45, "Cancel")]);
    await doc((await all()).find((e) => e.text === "Cancel")!.id, "POST /cancel");
    const ids = new Map((await all()).map((e) => [e.text, e.id]));
    // Three lines added at the top of the file: Save is now at 45, Cancel at 48.
    await capture([{ ...at(42, "Save"), source: "src/Form.tsx:45" }, { ...at(45, "Cancel"), source: "src/Form.tsx:48" }], { prune: true });
    expect(await docsOn("Cancel")).toEqual(["POST /cancel"]);
    expect(await docsOn("Save")).toEqual(["-"]);
    const after = new Map((await all()).map((e) => [e.text, e.id]));
    expect(after.get("Save")).toBe(ids.get("Save"));
    expect(after.get("Cancel")).toBe(ids.get("Cancel"));
  });

  it("look-alike buttons in different cards stay with their card", async () => {
    const card = (y: number, title: string): N => ({
      tag: "section",
      rect: { x: 0, y, w: 400, h: 90 },
      style: { background: "#eee" },
      attrs: { label: title },
      children: [box(y + 50, "Edit")],
    });
    await capture([card(0, "Users"), card(100, "Orgs")]);
    const edits = (await all()).filter((e) => e.text === "Edit").sort((a, b) => a.y - b.y);
    await doc(edits[0]!.id, "PATCH /users");
    await doc(edits[1]!.id, "PATCH /orgs");
    await capture([{ tag: "section", rect: { x: 0, y: 0, w: 900, h: 60 }, style: { background: "#f00" }, text: "Banner" }, card(100, "Users"), card(200, "Orgs")]);
    const after = await all();
    const parentName = (id: string | null) => after.find((e) => e.id === id)?.name;
    const byCard = Object.fromEntries(after.filter((e) => e.text === "Edit").map((e) => [parentName(e.parentId), e.apiBinding?.title]));
    expect(byCard).toEqual({ Users: "PATCH /users", Orgs: "PATCH /orgs" });
  });

  it("buttons in untagged cards follow their card when a card is added or removed", async () => {
    // No test ids anywhere: every key is positional.
    const card = (y: number, title: string): N => ({
      tag: "section",
      rect: { x: 0, y, w: 400, h: 90 },
      style: { background: "#eee" },
      children: [box(y + 10, title, { tag: "h3", rect: { x: 0, y: y + 10, w: 200, h: 30 } }), box(y + 50, "Edit")],
    });
    await capture([card(0, "Users"), card(100, "Orgs"), card(200, "Groups")]);
    const edits = (await all()).filter((e) => e.text === "Edit").sort((a, b) => a.y - b.y);
    await doc(edits[0]!.id, "PATCH /users");
    await doc(edits[1]!.id, "PATCH /orgs");
    await doc(edits[2]!.id, "PATCH /groups");
    const docsByCard = async () => {
      const els = await all();
      const title = (cardId: string | null) => els.find((e) => e.parentId === cardId && e.type !== "rectangle")?.text ?? els.find((e) => e.parentId === cardId && e.text !== "Edit")?.text;
      return Object.fromEntries(els.filter((e) => e.text === "Edit").map((e) => [title(e.parentId), e.apiBinding?.title ?? "-"]));
    };
    // Insert a card on top.
    await capture([card(0, "Zeta"), card(100, "Users"), card(200, "Orgs"), card(300, "Groups")]);
    expect(await docsByCard()).toEqual({ Zeta: "-", Users: "PATCH /users", Orgs: "PATCH /orgs", Groups: "PATCH /groups" });
    // Remove the middle card: its button's docs stay with the (now stale) draft.
    const res = await capture([card(0, "Zeta"), card(100, "Users"), card(200, "Groups")]);
    expect(res.stale.length).toBeGreaterThan(0);
    const groups = (await all()).filter((e) => e.text === "Edit" && e.apiBinding?.title === "PATCH /groups");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.y).toBe(250);
  });

  it("component occurrences keep their docs when an occurrence is inserted before them", async () => {
    const product = (y: number, name: string): N => ({
      tag: "article",
      rect: { x: 0, y, w: 300, h: 90 },
      style: { background: "#fff" },
      component: "ProductCard",
      componentRoot: true,
      children: [{ tag: "h3", rect: { x: 10, y: y + 10, w: 200, h: 24 }, text: name }],
    });
    await capture([product(0, "Apple"), product(100, "Pear")]);
    const holder = async (name: string) => {
      const els = await all();
      const title = els.find((e) => e.text === name);
      return els.find((e) => e.id === title?.parentId);
    };
    await doc((await holder("Apple"))!.id, "GET /products/apple");
    await doc((await holder("Pear"))!.id, "GET /products/pear");
    await capture([product(0, "Kiwi"), product(100, "Apple"), product(200, "Pear")]);
    expect((await holder("Apple"))?.apiBinding?.title).toBe("GET /products/apple");
    expect((await holder("Pear"))?.apiBinding?.title).toBe("GET /products/pear");
    expect((await holder("Kiwi"))?.apiBinding).toBeUndefined();
  });

  it("identical siblings, one deleted and one documented, pair up in order after an insert", async () => {
    await capture([box(0, "Users", { rect: { x: 0, y: 0, w: 200, h: 30 } }), box(40, "Edit"), box(80, "Orgs", { rect: { x: 0, y: 80, w: 200, h: 30 } }), box(120, "Edit")]);
    const [usersEdit, orgsEdit] = (await all()).filter((e) => e.text === "Edit").sort((a, b) => a.y - b.y);
    await api.deleteElement(cfg, usersEdit!.id);
    await doc(orgsEdit!.id, "PATCH /orgs");
    const res = await capture(
      [box(0, "New", { rect: { x: 0, y: 0, w: 200, h: 30 } }), box(40, "Users", { rect: { x: 0, y: 40, w: 200, h: 30 } }), box(80, "Edit"), box(120, "Orgs", { rect: { x: 0, y: 120, w: 200, h: 30 } }), box(160, "Edit")],
      { prune: true },
    );
    expect(res.dismissed).toEqual([usersEdit!.id]);
    const edits = (await all()).filter((e) => e.text === "Edit");
    expect(edits.map((e) => [e.id, e.y, e.apiBinding?.title])).toEqual([[orgsEdit!.id, 160, "PATCH /orgs"]]);
  });

  it("a deleted page stays deleted, and is reported as one page", async () => {
    await capture([box(0, "A"), box(40, "B")]);
    const frame = (await all()).find((e) => e.origin?.key === "page");
    await api.deleteElement(cfg, frame!.id); // cascades to the whole page
    const res = await capture([box(0, "A"), box(40, "B"), box(80, "New")]);
    expect(res.dismissedPages).toEqual(["/docs · 1000x800"]);
    expect(res.created).toEqual([]);
    expect(await all()).toEqual([]);
  });

  it("ignores a dismissal that a live element contradicts (restored by git or a checkpoint)", async () => {
    await capture([box(0, "Alpha"), box(40, "Beta")]);
    const beta = (await all()).find((e) => e.text === "Beta")!;
    await doc(beta.id, "GET /beta");
    const file = readFileSync(join(root, `.forward/design/${beta.id}.json`), "utf8");
    await api.deleteElement(cfg, beta.id);
    writeFileSync(join(root, `.forward/design/${beta.id}.json`), file); // `git checkout -- …`
    const res = await capture([box(0, "Banner", { rect: { x: 0, y: 0, w: 900, h: 30 } }), box(40, "Alpha"), box(80, "Beta")]);
    expect(res.dismissed).toEqual([]);
    expect(await docsOn("Beta")).toEqual(["GET /beta"]);
    expect(existsSync(join(root, `.forward/dismissed/${beta.id}.json`))).toBe(false);
  });

  it("restoring a checkpoint clears the dismissals of what it brings back", async () => {
    await capture([box(0, "Alpha")]);
    const alpha = (await all()).find((e) => e.text === "Alpha")!;
    const cp = await api.createCheckpoint(cfg, { title: "before" } as never);
    await api.deleteElement(cfg, alpha.id);
    expect(existsSync(join(root, `.forward/dismissed/${alpha.id}.json`))).toBe(true);
    await api.restoreCheckpoint(cfg, (cp as { id: string }).id);
    expect(existsSync(join(root, `.forward/dismissed/${alpha.id}.json`))).toBe(false);
  });

  it("an adopted draft is left alone, not duplicated, after the page shifts", async () => {
    await capture([box(0, "Alpha"), box(40, "Beta")]);
    const beta = (await all()).find((e) => e.text === "Beta")!;
    const { origin: _o, apiBinding: _b, ...adopted } = beta;
    await api.saveElement(cfg, adopted);
    const res = await capture([box(0, "Banner", { rect: { x: 0, y: 0, w: 900, h: 30 } }), box(40, "Alpha"), box(80, "Beta")]);
    expect(res.skipped).toEqual([beta.id]);
    expect((await all()).filter((e) => e.text === "Beta")).toHaveLength(1);
  });

  it("an instance whose master was deleted becomes a plain box", async () => {
    const tile = (y: number, t: string) => box(y, t, { component: "Tile", componentRoot: true });
    await capture([tile(0, "A"), tile(40, "B")]);
    const master = (await all()).find((e) => e.type === "component")!;
    await api.deleteElement(cfg, master.id);
    await capture([tile(0, "A"), tile(40, "B")]);
    const b = (await all()).find((e) => e.text === "B");
    expect(b?.type).toBe("rectangle");
    expect(b?.componentId).toBeUndefined();
  });
});
