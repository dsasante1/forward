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
// Then the companion, ./pkg-capture (forward-capture): exactly one, exactly
// pinned dependency (playwright-core); installed next to forward-mcp, where
// `forward capture --browser playwright` must find and run it.
//
// Run after `npm run pack -w apps/mcp`.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  // way). Publish in dry-run mode and refuse any auto-correction. npm refuses
  // even a dry run over a version already on the registry, so dry-run a copy
  // under a pre-release version that can never have been published.
  step("npm publish --dry-run");
  const publishCheck = path.join(work, "publish-check");
  cpSync(pkgDir, publishCheck, { recursive: true });
  writeFileSync(
    path.join(publishCheck, "package.json"),
    `${JSON.stringify({ ...manifest, version: `${manifest.version}-smoke.${Date.now()}` }, null, 2)}\n`,
  );
  const dry = spawnSyncText("npm", ["publish", publishCheck, "--dry-run", "--access", "public", "--tag", "smoke"]);
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

  step("forward capture --browsers");
  // Exercises the bundled browser finder; any machine may have none.
  if (!/Live capture can use|No Chromium-based browser found/.test(run("capture", "--browsers"))) {
    throw new Error("capture --browsers printed neither a browser list nor the none-found note");
  }

  step("forward export");
  run("export", "--out", path.join(work, "site"));
  for (const f of ["index.html", "forward.json", "THIRD_PARTY_NOTICES.txt"]) {
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

  // --- forward-capture ----------------------------------------------------
  const capDir = path.resolve(pkgDir, "..", "pkg-capture");
  const capManifest = JSON.parse(readFileSync(path.join(capDir, "package.json"), "utf8"));
  if (capManifest.name !== "forward-capture" || capManifest.version !== manifest.version) {
    throw new Error(`pkg-capture must be forward-capture@${manifest.version}, is ${capManifest.name}@${capManifest.version}`);
  }
  const capDeps = Object.entries(capManifest.dependencies ?? {});
  if (capDeps.length !== 1 || capDeps[0][0] !== "playwright-core" || !/^\d+\.\d+\.\d+$/.test(capDeps[0][1])) {
    throw new Error(`forward-capture must depend on exactly playwright-core at an exact version, found ${JSON.stringify(capManifest.dependencies)}`);
  }
  step("packing apps/mcp/pkg-capture");
  const [capPacked] = JSON.parse(
    execFileSync("npm", ["pack", capDir, "--pack-destination", work, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
  );
  step("npm publish --dry-run (forward-capture)");
  const capCheck = path.join(work, "publish-check-capture");
  cpSync(capDir, capCheck, { recursive: true });
  writeFileSync(path.join(capCheck, "package.json"), `${JSON.stringify({ ...capManifest, version: `${capManifest.version}-smoke.${Date.now()}` }, null, 2)}\n`);
  const capDry = spawnSyncText("npm", ["publish", capCheck, "--dry-run", "--access", "public", "--tag", "smoke"]);
  if (/errors corrected|was invalid and removed/.test(capDry)) throw new Error(`npm would rewrite forward-capture's package.json:\n${capDry}`);

  // Into the project being captured, which is where forward looks for it.
  step(`installing ${capPacked.filename} into the project`);
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", path.join(work, capPacked.filename)], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const capBin = path.join(repo, "node_modules", ".bin", "forward-capture");
  const capVersion = execFileSync(capBin, ["--version"], { encoding: "utf8" }).trim();
  if (capVersion !== manifest.version) throw new Error(`forward-capture --version printed "${capVersion}"`);

  // The whole path, without downloading a browser: forward finds the
  // companion in the project, the companion loads playwright-core, and the
  // capture fails cleanly (no browser allowed, or nothing listening on port 1).
  step("forward capture --browser playwright → forward-capture");
  const viaCompanion = spawnSync(forward, ["capture", "http://127.0.0.1:1", "/", "--browser", "playwright", "--dry-run"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, FORWARD_NO_DOWNLOAD: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(work, "no-browsers") },
    timeout: 120_000,
  });
  const said = `${viaCompanion.stdout}\n${viaCompanion.stderr}`;
  if (viaCompanion.status === 0 || !/FORWARD_NO_DOWNLOAD is set/.test(said)) {
    throw new Error(`forward capture via forward-capture did not end as expected (exit ${viaCompanion.status}):\n${said.slice(-800)}`);
  }

  console.log(`smoke: ok — forward-mcp@${manifest.version} (${tools} tools), forward-capture@${capManifest.version}`);
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
