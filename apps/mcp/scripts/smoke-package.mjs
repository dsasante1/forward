#!/usr/bin/env node
// Proves the *artifact* works, not the source tree.
//
// `npm test` runs through workspace symlinks with every devDependency present.
// None of that says whether `npx forward-mcp` works on a machine that has
// nothing but Node and git. This does: it packs ./pkg exactly as `npm publish`
// would, installs the tarball into an empty project with production
// dependencies only, and drives the two binaries that install produced —
// `forward --version`, `init`, a tool call, `validate`, `export`, `serve` (with
// its session token) and an MCP stdio handshake.
//
// Run after `npm run pack -w apps/mcp`.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "pkg");
if (!existsSync(path.join(pkgDir, "package.json"))) {
  console.error("smoke: apps/mcp/pkg is missing — run `npm run pack -w apps/mcp` first");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const work = mkdtempSync(path.join(tmpdir(), "forward-smoke-"));
const step = (label) => console.log(`smoke: ${label}`);
let server;

try {
  step("packing apps/mcp/pkg");
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", pkgDir, "--pack-destination", work, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const tarball = path.join(work, packed.filename);
  // `npm install <tarball>` is lenient, but `npm publish` normalizes package.json
  // and silently drops fields it rejects (a `./`-prefixed bin vanished this
  // way). Publish in dry-run mode and refuse any auto-correction.
  step("npm publish --dry-run");
  const dry = spawnSyncText("npm", ["publish", pkgDir, "--dry-run", "--access", "public"]);
  if (/errors corrected|was invalid and removed/.test(dry)) {
    throw new Error(`npm would rewrite package.json on publish:\n${dry}`);
  }

  const deps = Object.keys(manifest.dependencies ?? {});
  if (deps.length) throw new Error(`the bundle must have no dependencies, found: ${deps.join(", ")}`);

  step(`installing ${packed.filename} into an empty project`);
  const install = path.join(work, "install");
  mkdirSync(install);
  writeFileSync(path.join(install, "package.json"), JSON.stringify({ name: "forward-smoke", private: true }));
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", tarball], {
    cwd: install,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const forward = path.join(install, "node_modules", ".bin", "forward");
  const forwardMcp = path.join(install, "node_modules", ".bin", "forward-mcp");

  // A throwaway repository with its own git identity.
  const repo = path.join(work, "repo");
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.name", "Smoke Test");
  git("config", "user.email", "smoke@example.com");
  const run = (...args) => execFileSync(forward, args, { cwd: repo, encoding: "utf8" });

  step("forward --version");
  const version = run("--version").trim();
  if (version !== manifest.version) {
    throw new Error(`--version printed "${version}", package.json says "${manifest.version}"`);
  }

  step("forward init");
  run("init", "--name", "Smoke", "--no-github");
  for (const f of [".forward/forward.json", "AGENTS.md", "CLAUDE.md", ".mcp.json"]) {
    if (!existsSync(path.join(repo, f))) throw new Error(`init did not write ${f}`);
  }

  step("forward create_element + write_documentation");
  const { id } = JSON.parse(
    run("create_element", "--type", "frame", "--name", "Login", "--x", "0", "--y", "0", "--width", "100", "--height", "100"),
  );
  run("write_documentation", "--element-id", id, "--title", "POST /login", "--description", "Smoke");

  step("forward validate");
  run("validate");

  step("forward export");
  run("export", "--out", path.join(work, "site"));
  for (const f of ["index.html", "forward.json"]) {
    if (!existsSync(path.join(work, "site", f))) throw new Error(`export did not write ${f}`);
  }

  step("forward serve");
  server = spawn(forward, ["serve", "--port", "0"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`serve did not start: ${out}`)), 15_000);
    server.stdout.on("data", (c) => {
      out += c;
      const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    server.on("exit", (code) => reject(new Error(`serve exited ${code}: ${out}`)));
  });
  const html = await (await fetch(url)).text();
  const token = /"token":"([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error("serve did not inject a session token");
  const denied = await fetch(`${url}projects/smoke/elements`);
  if (denied.status !== 401) throw new Error(`API without a token answered ${denied.status}, want 401`);
  const ok = await fetch(`${url}projects/smoke/elements`, { headers: { authorization: `Bearer ${token}` } });
  const elements = await ok.json();
  if (!ok.ok || elements[0]?.apiBinding?.title !== "POST /login") {
    throw new Error(`API read failed: ${ok.status} ${JSON.stringify(elements).slice(0, 200)}`);
  }
  server.kill();
  server = undefined;

  step("forward-mcp over stdio");
  const tools = await mcpToolCount(forwardMcp, repo);
  if (tools < 30) throw new Error(`MCP listed ${tools} tools`);

  console.log(`smoke: ok — forward-mcp@${manifest.version} (${tools} tools)`);
} catch (err) {
  console.error(`smoke: FAILED — ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  server?.kill();
  rmSync(work, { recursive: true, force: true });
}

function spawnSyncText(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${res.stderr}`);
  return `${res.stdout}\n${res.stderr}`;
}

function mcpToolCount(bin, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [], { cwd, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP server did not answer tools/list"));
    }, 15_000);
    let buf = "";
    child.stdout.on("data", (c) => {
      buf += c;
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2) {
            clearTimeout(timer);
            child.kill();
            resolve(msg.result.tools.length);
          }
        } catch {
          /* partial line */
        }
      }
    });
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}
