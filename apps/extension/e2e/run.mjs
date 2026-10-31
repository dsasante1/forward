import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { chromium } from "playwright-core";

/**
 * The built extension in a real VS Code, driven over the DevTools protocol: the
 * webview bridge, the Problems panel and file-driven refresh, which no unit test
 * reaches. Needs a display: `xvfb-run -a npm run test:e2e -w apps/extension`.
 */
const VSCODE_VERSION = "1.144.0";
const here = fileURLToPath(new URL(".", import.meta.url));
const extension = join(here, "..");
const repoRoot = join(extension, "..", "..");
const out = join(here, "out");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function poll(what, find, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await find();
    if (found) return found;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

for (const workspace of ["packages/shared", "apps/canvas", "apps/extension"]) {
  execFileSync("npm", ["run", "build", "-w", workspace], { cwd: repoRoot, stdio: "inherit" });
}
const { RepoStore, initRepo } = await import("forward-core/repo");
const vscode = await downloadAndUnzipVSCode({ version: VSCODE_VERSION, cachePath: join(extension, ".vscode-test") });

const base = mkdtempSync(join(tmpdir(), "forward-ext-"));
const home = join(base, "home");
const repo = join(base, "repo");
mkdirSync(home);
mkdirSync(repo);
// A clean identity, and nothing inherited from a surrounding VS Code terminal.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|FORWARD_|VSCODE_|ELECTRON_)/.test(k))),
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "ignore" });

initRepo(repo, { name: "Demo" });
git("init", "-q", "-b", "main");
git("config", "user.name", "Ada");
git("config", "user.email", "ada@example.com");
git("config", "commit.gpgsign", "false");
const store = new RepoStore(repo, { author: "e2e" });
let n = 0;
function commitAs(name, email) {
  const updatedAt = new Date().toISOString();
  store.saveElement({ id: `el${++n}`, type: "rectangle", name: `El ${n}`, x: 0, y: 0, width: 10, height: 10, updatedAt });
  git("add", "-A");
  git("-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-qm", "x");
}
commitAs("Ada", "ada@example.com");
commitAs("github-actions[bot]", "bot@users.noreply.github.com");
const now = new Date().toISOString();
store.saveTask({ id: "t1", key: "FWD-1", title: "Seeded", assignees: ["nobody"], createdAt: now, updatedAt: now });

const port = await freePort();
const code = spawn(
  vscode,
  [
    `--remote-debugging-port=${port}`,
    `--extensionDevelopmentPath=${extension}`,
    `--user-data-dir=${join(base, "user")}`,
    `--extensions-dir=${join(base, "extensions")}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-workspace-trust",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--password-store=basic",
    "--new-window",
    repo,
  ],
  { env, stdio: "ignore" },
);

let workbench;
let browser;
let failed = false;
try {
  browser = await poll("VS Code to accept a debugger", () =>
    chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined),
  );
  const pages = () => browser.contexts().flatMap((c) => c.pages());
  workbench = await poll("the workbench window", () => pages().find((p) => p.url().includes("workbench")));
  await workbench.locator(".monaco-workbench").waitFor({ timeout: 60_000 });
  await wait(5000); // the extension activates after the window is ready

  const run = async (command) => {
    await workbench.keyboard.press("F1");
    await workbench.locator(".quick-input-box input").waitFor();
    await workbench.keyboard.insertText(`>${command}`);
    await wait(1200);
    await workbench.keyboard.press("Enter");
  };

  // `forward validate` reaches the Problems panel.
  await run("Forward: Validate Project");
  await wait(1500);
  await run("View: Focus Problems");
  await workbench
    .locator(".markers-panel .monaco-tl-contents", { hasText: 'Assignee "nobody"' })
    .first()
    .waitFor({ timeout: 30_000 });

  // The canvas, over the postMessage bridge.
  await run("Forward: Open Design Canvas");
  const canvas = await poll("the canvas webview", async () => {
    for (const page of pages()) {
      for (const frame of page.frames()) {
        if (await frame.locator('[data-toggle="member"]').count().catch(() => 0)) return frame;
      }
    }
    return undefined;
  });
  const people = canvas.locator('[data-toggle="member"]');
  assert.equal(await people.getAttribute("title"), "Contributors");
  await people.click();
  await canvas.locator(".mb-row").first().waitFor({ timeout: 30_000 });
  assert.deepEqual(await canvas.locator(".mb-name").allTextContents(), ["Ada", "github-actions[bot]"]);
  assert.deepEqual(await canvas.locator(".mb-badge").allTextContents(), ["bot"]);

  // File events refresh the open view.
  commitAs("Grace", "grace@example.com");
  await canvas.locator(".mb-name", { hasText: "Grace" }).waitFor({ timeout: 30_000 });

  // The store, not the webview, says who filed a task.
  await canvas.locator('[data-toggle="tasks"]').click();
  await canvas.locator(".tk-input").fill("From the webview");
  await canvas.locator(".tk-add").click();
  const filed = await poll(
    "the task on disk",
    () => new RepoStore(repo, { author: "e2e" }).listTasks().find((t) => t.title === "From the webview"),
    30_000,
  );
  assert.equal(filed.reporter, "Ada");
  assert.deepEqual(filed.activity.map((a) => a.actor), ["Ada"]);

  console.log("extension e2e: ok");
} catch (err) {
  failed = true;
  console.error(err);
  mkdirSync(out, { recursive: true });
  await workbench?.screenshot({ path: join(out, "failure.png") }).catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  code.kill("SIGKILL");
  rmSync(base, { recursive: true, force: true, maxRetries: 3 });
}
process.exit(failed ? 1 : 0);
