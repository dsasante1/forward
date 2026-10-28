// Builds the site's live demo at /demo/: a small fictional project ("Pantry", a
// shared grocery-list app) seeded through the real `forward` CLI tools over a
// few commits, then exported with `forward export` — exactly what a team gets
// from the GitHub Action's Pages export.
//
// The project is built in a throwaway git repository with its own HOME and an
// empty git config, and every write and commit names a fictional author, so
// nothing about the machine that builds the site (git identity, FORWARD_* or
// GIT_* settings) can reach the published demo.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const site = resolve(import.meta.dirname, "..");
const repo = resolve(site, "../..");
const CLI = join(repo, "apps/mcp/dist/cli.js");
const HOST = join(repo, "apps/canvas/dist-host/index.html");

/** The demo's cast. Emails use a reserved domain that can never resolve. */
const MAYA = { name: "Maya Okafor", email: "maya@pantry.example" };
const SAM = { name: "Sam Reyes", email: "sam@pantry.example" };

/** A copy of `env` with nothing that could steer git or forward towards the builder. */
export function isolatedEnv(env, home) {
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^(FORWARD_|GIT_|ADC_)/i.test(k)));
  const gitconfig = join(home, ".gitconfig");
  writeFileSync(gitconfig, "");
  return {
    ...clean,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/**
 * Seed the Pantry project in a temporary repository and export it to `out`.
 * `env` is the environment to start from (the builder's, by default); see isolatedEnv.
 */
export function buildDemo(out, env = process.env) {
  for (const [path, build] of [
    [CLI, "npm run build -w packages/shared && npm run build -w apps/mcp"],
    [HOST, "npm run build -w apps/canvas"],
  ]) {
    if (!existsSync(path)) throw new Error(`The demo needs ${path}; run \`${build}\` from the repository root first.`);
  }
  const work = mkdtempSync(join(tmpdir(), "forward-demo-"));
  try {
    const home = join(work, "home");
    const dir = join(work, "pantry");
    mkdirSync(home);
    mkdirSync(dir);
    const base = isolatedEnv(env, home);
    let who = MAYA;
    let agent;
    const envFor = () => ({
      ...base,
      FORWARD_AUTHOR: who.name,
      ...(agent ? { FORWARD_AGENT: agent } : {}),
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: who.email,
    });
    const sh = (file, args) => execFileSync(file, args, { cwd: dir, env: envFor(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const forward = (...args) => sh(process.execPath, [CLI, ...args]);
    const call = (tool, args) => JSON.parse(forward("call", tool, JSON.stringify(args)));
    const id = (tool, args) => call(tool, args).id;
    const commit = (message) => {
      sh("git", ["add", "-A"]);
      sh("git", ["commit", "-q", "-m", message]);
    };

    sh("git", ["init", "-q", "-b", "main"]);
    forward("init", "--name", "Pantry", "--id", "pantry", "--no-agents", "--no-github");

    // 1. Maya draws the first two screens.
    const text = (parentId, x, y, t, size = 15, weight = 400, width = 300) =>
      id("create_element", { type: "text", name: t, text: t, x, y, width, height: size + 10, parentId, style: { fontSize: size, fontWeight: weight, color: "#1f1b16" } });
    const box = (parentId, name, x, y, width, height, fill, extra = {}) =>
      id("create_element", { type: "rectangle", name, x, y, width, height, parentId, style: { fill, radius: 12, ...extra } });

    const lists = id("create_element", { type: "frame", name: "Lists", x: 0, y: 0, width: 390, height: 844, style: { fill: "#fbf7f0" } });
    text(lists, 24, 56, "My lists", 28, 700);
    const card = id("create_element", { type: "component", name: "List card", x: 24, y: 120, width: 342, height: 88, parentId: lists, style: { fill: "#ffffff", stroke: "#e6ddd0", radius: 14 } });
    text(card, 40, 136, "Weekly shop", 17, 600);
    text(card, 40, 166, "12 items · shared with Sam", 13);
    // Instances share the card's look; their text is their own.
    for (const [i, [title, meta]] of [["BBQ Saturday", "9 items"], ["Pharmacy", "2 items · shared with Maya"]].entries()) {
      const y = 224 + i * 104;
      id("create_element", { type: "instance", name: "List card", componentId: card, x: 24, y, width: 342, height: 88, parentId: lists });
      text(lists, 40, y + 16, title, 17, 600);
      text(lists, 40, y + 46, meta, 13);
    }
    const newList = box(lists, "New list button", 24, 760, 342, 52, "#bf5a36");
    text(lists, 150, 776, "New list", 16, 600, 120);

    const detail = id("create_element", { type: "frame", name: "List detail", x: 460, y: 0, width: 390, height: 844, style: { fill: "#fbf7f0" } });
    text(detail, 484, 56, "Weekly shop", 28, 700);
    for (const [i, item] of ["Oat milk", "Sourdough", "Tomatoes", "Coffee beans"].entries()) {
      box(detail, `Item row: ${item}`, 484, 120 + i * 64, 342, 52, "#ffffff", { stroke: "#e6ddd0" });
      text(detail, 524, 136 + i * 64, item, 16);
    }
    const addItem = box(detail, "Add item field", 484, 392, 342, 52, "#ffffff", { stroke: "#bf5a36", strokeWidth: 2 });
    text(detail, 500, 408, "Add an item…", 15, 400, 200);
    const checkout = box(detail, "Order groceries button", 484, 760, 342, 52, "#1f1b16");
    id("create_element", { type: "text", name: "Order groceries", text: "Order groceries", x: 590, y: 776, width: 160, height: 26, parentId: detail, style: { fontSize: 16, fontWeight: 600, color: "#ffffff" } });
    commit("Design: lists and list detail screens");

    // 2. Sam documents the endpoints behind them and draws the architecture.
    who = SAM;
    call("write_documentation", {
      elementId: newList,
      title: "POST /lists",
      description: "Create a list for the current user.\n\n**Body**\n```json\n{ \"name\": \"Weekly shop\" }\n```\n\n**201** the new list: `{ id, name, items: [], members: [userId] }`.",
    });
    call("write_documentation", {
      elementId: addItem,
      title: "POST /lists/{id}/items",
      description: "Add an item to a list.\n\n**Body**\n```json\n{ \"name\": \"Oat milk\" }\n```\n\n**201** the item. **404** if the list doesn't exist or isn't shared with you.",
    });
    const app = id("write_infra_node", { kind: "frontend", label: "Pantry app", tech: "React Native", x: 40, y: 160 });
    const api = id("write_infra_node", { kind: "backend", label: "Lists API", tech: "Node 22", env: "prod", x: 300, y: 160 });
    const db = id("write_infra_node", { kind: "database", label: "PostgreSQL", tech: "v17", x: 560, y: 80 });
    const cache = id("write_infra_node", { kind: "cache", label: "Redis", tech: "v8", x: 560, y: 240 });
    call("connect_infra", { from: app, to: api, label: "HTTPS" });
    call("connect_infra", { from: api, to: db, label: "reads/writes" });
    call("connect_infra", { from: api, to: cache, label: "list cache" });
    commit("Document the list endpoints and the architecture");

    // 3. The data model and how adding an item flows through the system.
    const user = id("write_entity", { name: "User", x: 40, y: 60, fields: [{ name: "id", type: "uuid", keys: ["PK"] }, { name: "email", type: "text", keys: ["UK"] }, { name: "name", type: "text" }] });
    const list = id("write_entity", { name: "List", x: 320, y: 60, fields: [{ name: "id", type: "uuid", keys: ["PK"] }, { name: "owner_id", type: "uuid", keys: ["FK"] }, { name: "name", type: "text" }] });
    const item = id("write_entity", { name: "Item", x: 600, y: 60, fields: [{ name: "id", type: "uuid", keys: ["PK"] }, { name: "list_id", type: "uuid", keys: ["FK"] }, { name: "name", type: "text" }, { name: "quantity", type: "int" }, { name: "checked", type: "bool" }] });
    call("relate_entities", { from: user, to: list, fromCardinality: "exactly-one", toCardinality: "zero-or-many", label: "owns", identifying: false });
    call("relate_entities", { from: list, to: item, fromCardinality: "exactly-one", toCardinality: "zero-or-many", label: "contains", identifying: true });
    id("write_flow", {
      name: "Add an item",
      description: "What happens when someone adds an item to a shared list.",
      steps: [
        { from: app, to: api, label: "POST /lists/{id}/items", kind: "sync", endpointId: addItem },
        { from: api, to: db, label: "insert item", kind: "sync" },
        { from: api, to: cache, label: "drop cached list", kind: "async" },
        { from: api, to: app, label: "201 item", kind: "reply" },
      ],
    });
    commit("Data model and the add-item flow");

    // 4. An agent extends the add-item endpoint. (No tasks: the read-only
    // canvas only shows the tracker where tasks can be saved.)
    agent = "claude";
    call("write_documentation", {
      elementId: addItem,
      title: "POST /lists/{id}/items",
      description: "Add an item to a list.\n\n**Body**\n```json\n{ \"name\": \"Oat milk\", \"quantity\": 2 }\n```\n\n`quantity` is optional (default 1).\n\n**201** the item. **404** if the list doesn't exist or isn't shared with you. **422** if `quantity` is below 1.",
      changeLog: "Accept an optional quantity",
    });
    agent = undefined;
    commit("Item quantities");

    // 5. Maya designs sharing; Sam documents it and checkout.
    who = MAYA;
    const share = id("create_element", { type: "frame", name: "Share list", x: 920, y: 0, width: 390, height: 844, style: { fill: "#fbf7f0" } });
    text(share, 944, 56, "Share “Weekly shop”", 24, 700, 340);
    box(share, "Email field", 944, 120, 342, 52, "#ffffff", { stroke: "#e6ddd0" });
    const shareButton = box(share, "Share button", 944, 188, 342, 52, "#bf5a36");
    text(share, 1080, 204, "Share", 16, 600, 80);
    commit("Design: share screen");

    who = SAM;
    call("write_documentation", {
      elementId: shareButton,
      title: "POST /lists/{id}/members",
      description: "Share a list.\n\n**Body**\n```json\n{ \"email\": \"sam@example.com\" }\n```\n\n**201** the member. The new member is sent an email with a link to the list.",
    });
    call("write_documentation", {
      elementId: checkout,
      title: "POST /lists/{id}/order",
      description: "Send the unchecked items to the grocery partner as one order.\n\n**202** `{ orderId }`: the order is placed in the background.",
    });
    const partner = id("write_infra_node", { kind: "external", label: "Grocery partner API", x: 300, y: 360 });
    call("connect_infra", { from: api, to: partner, label: "place order" });
    commit("Document sharing and ordering");

    forward("validate");
    rmSync(out, { recursive: true, force: true });
    forward("export", "--out", out);
    console.log(`demo exported to ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  buildDemo(join(site, "dist/demo"));
}
