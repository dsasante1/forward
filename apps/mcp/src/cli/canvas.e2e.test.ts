import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoStore, initRepo, prepareAsset } from "forward-core/repo";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { findBrowsers } from "../browser/find.js";
import { serve } from "./serve.js";

/**
 * The canvas in a real browser against `forward serve`: what unit tests can't
 * see, such as a rail label that doesn't fit, or the Contributors view reacting
 * to a commit. `scripts/fresh-ui.mjs` rebuilds the UI first if it's out of date.
 * Needs a Chromium-based browser; CI has one, so there a missing one fails
 * rather than skips.
 */
const browserPath = findBrowsers()[0]?.path;

// CI sets GIT_AUTHOR_* / GIT_COMMITTER_*, which beat the identities set here.
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(k)),
);

describe.skipIf(!browserPath && !process.env.CI)("the canvas in a browser", () => {
  let browser: Browser;
  const dirs: string[] = [];
  const stops: Array<() => void> = [];
  let consoleErrors: string[] = [];

  function git(root: string, ...args: string[]) {
    execFileSync("git", args, { cwd: root, stdio: "ignore", env: gitEnv });
  }

  function project(): { root: string; commitAs: (name: string, email: string) => void } {
    const root = mkdtempSync(join(tmpdir(), "forward-canvas-e2e-"));
    dirs.push(root);
    initRepo(root, { name: "Demo" });
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "commit.gpgsign", "false");
    const store = new RepoStore(root, { author: "e2e" });
    let n = 0;
    return {
      root,
      commitAs(name, email) {
        store.saveElement({ id: `el${++n}`, type: "rectangle", name: `El ${n}`, x: 0, y: 0, width: 10, height: 10, updatedAt: new Date().toISOString() });
        git(root, "add", "-A");
        git(root, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-qm", "x");
      },
    };
  }

  async function open(root: string): Promise<Page> {
    const { url, close } = await serve({ root, port: 0, host: "127.0.0.1" });
    stops.push(close);
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    await page.goto(url);
    await page.locator('[data-toggle="member"]').waitFor();
    return page;
  }

  const names = (page: Page) => page.locator(".mb-name").allTextContents();

  beforeAll(async () => {
    const buildError = inject("uiBuildError");
    if (buildError) throw new Error(`The canvas UI didn't build:\n${buildError}`);
    browser = await chromium.launch({ executablePath: browserPath, args: ["--no-sandbox"] });
  }, 90_000);

  afterAll(async () => {
    for (const stop of stops) stop();
    await browser?.close();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("loads with no console errors, including a missing favicon", async () => {
    consoleErrors = [];
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    const page = await open(root);
    await page.waitForTimeout(1500); // the favicon is fetched after load
    expect(consoleErrors).toEqual([]);
  }, 60_000);

  it("fits every rail label inside its button", async () => {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    const page = await open(root);
    const spilled = await page.locator("#toolbar .icon-btn").evaluateAll((btns) =>
      btns
        .filter((b) => {
          const label = b.querySelector("span");
          return label && label.scrollWidth > (b as HTMLElement).clientWidth;
        })
        .map((b) => b.textContent),
    );
    expect(spilled).toEqual([]);
  }, 60_000);

  it("opens the Contributors view as the only active tool", async () => {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    commitAs("github-actions[bot]", "bot@users.noreply.github.com");
    const page = await open(root);

    const button = page.locator('[data-toggle="member"]');
    expect(await button.getAttribute("title")).toBe("Contributors");
    await button.click();
    await page.locator(".mb-row").first().waitFor();

    expect(await page.locator("#member h2").textContent()).toBe("Contributors");
    expect(await names(page)).toEqual(["Ada", "github-actions[bot]"]);
    expect(await page.locator(".mb-badge").allTextContents()).toEqual(["bot"]);
    expect(await page.locator(".mb-warn").count()).toBe(0);
    const active = await page.locator("#toolbar [data-toggle].active").evaluateAll((btns) =>
      btns.map((b) => (b as HTMLElement).dataset.toggle),
    );
    expect(active).toEqual(["member"]);

    await page.locator(".mb-close").click();
    await page.locator("#member").waitFor({ state: "hidden" });
  }, 60_000);

  it("shows a new contributor while the view is open, with no loading flash", async () => {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    const page = await open(root);
    await page.locator('[data-toggle="member"]').click();
    await page.locator(".mb-row").first().waitFor();

    await page.locator("#member").evaluate((host) => {
      const flags = window as unknown as { rosterFlashed: boolean };
      flags.rosterFlashed = false;
      new MutationObserver(() => {
        if (host.textContent?.includes("Loading")) flags.rosterFlashed = true;
      }).observe(host, { childList: true, subtree: true });
    });
    commitAs("Grace", "grace@example.com");

    await page.locator(".mb-name", { hasText: "Grace" }).waitFor({ timeout: 20_000 });
    expect(await names(page)).toEqual(["Ada", "Grace"]);
    expect(await page.evaluate(() => (window as unknown as { rosterFlashed: boolean }).rosterFlashed)).toBe(false);
  }, 60_000);

  it("credits a task filed on the canvas to the git author, not the canvas", async () => {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    git(root, "config", "user.name", "Ada");
    const page = await open(root);
    await page.locator('[data-toggle="tasks"]').click();
    await page.locator(".tk-input").fill("Ship it");
    await page.locator(".tk-add").click();
    await page.locator("text=Ship it").first().waitFor();

    const [task] = new RepoStore(root, { author: "e2e" }).listTasks();
    expect(task?.reporter).toBe("Ada");
    expect(task?.activity.map((a) => a.actor)).toEqual(["Ada"]);
  }, 60_000);

  it("warns in a shallow clone", async () => {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    commitAs("Grace", "grace@example.com");
    const clone = mkdtempSync(join(tmpdir(), "forward-canvas-e2e-"));
    dirs.push(clone);
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${root}`, clone], { stdio: "ignore", env: gitEnv });

    const page = await open(clone);
    await page.locator('[data-toggle="member"]').click();
    await page.locator(".mb-warn").waitFor();
    expect(await names(page)).toEqual(["Grace"]);
  }, 60_000);

  // A 4×2 PNG, so the aspect ratio of a dropped image is checkable.
  const PNG_4X2 =
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC";

  it("paints an image fill clipped to its shape, under its stroke", async () => {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    const store = new RepoStore(root, { author: "e2e" });
    const { name } = store.saveAsset({ data: PNG_4X2 });
    store.saveElement({
      id: "hero",
      type: "rectangle",
      name: "Hero",
      x: 40,
      y: 40,
      width: 200,
      height: 100,
      style: { radius: 12, stroke: "#ff0000", strokeWidth: 2, image: { asset: name, fit: "cover", naturalWidth: 4, naturalHeight: 2, alt: "Hero shot" } },
      updatedAt: new Date().toISOString(),
    });
    consoleErrors = [];
    const page = await open(root);
    const image = page.locator('#canvas g[data-id="hero"] image');
    await image.waitFor({ state: "attached" });
    expect(await image.getAttribute("href")).toMatch(/^blob:/);
    expect(await image.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
    expect(await image.getAttribute("aria-label")).toBe("Hero shot");
    const clip = await image.getAttribute("clip-path");
    expect(clip).toMatch(/^url\(#fwd-img-clip-\d+\)$/);
    // The image decodes, and the outline drawn after it keeps the stroke on top.
    const decoded = await image.evaluate(async (el) => {
      const img = new Image();
      img.src = el.getAttribute("href")!;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
    expect(decoded).toEqual([4, 2]);
    const after = await image.evaluate((el) => {
      const next = el.nextElementSibling as SVGElement | null;
      return next ? { fill: next.style.fill, stroke: getComputedStyle(next).stroke } : null;
    });
    expect(after).toEqual({ fill: "none", stroke: "rgb(255, 0, 0)" });
    expect(consoleErrors).toEqual([]);
  }, 60_000);

  it("turns a dropped image file into an image element stored as an asset", async () => {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    const page = await open(root);
    await page.locator("#canvas").evaluate((svg, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "team-photo.png", { type: "image/png" }));
      const box = svg.getBoundingClientRect();
      const at = { clientX: box.left + 400, clientY: box.top + 300, dataTransfer: dt, bubbles: true, cancelable: true };
      svg.dispatchEvent(new DragEvent("dragover", at));
      svg.dispatchEvent(new DragEvent("drop", at));
    }, PNG_4X2);
    const image = page.locator("#canvas image");
    await image.waitFor({ state: "attached", timeout: 15_000 });

    const store = new RepoStore(root);
    const el = store.listElements().find((e) => e.style?.image);
    expect(el).toMatchObject({ type: "rectangle", name: "image team photo", width: 4, height: 2 });
    expect(el!.style!.image).toMatchObject({ fit: "cover", naturalWidth: 4, naturalHeight: 2, alt: "team photo" });
    // Re-encoded by the canvas (WebP where the browser can), then stored by hash.
    expect(store.listAssets().map((a) => a.name)).toEqual([el!.style!.image!.asset]);
  }, 60_000);

  function imageProject() {
    const { root, commitAs } = project();
    commitAs("Ada", "ada@example.com");
    const store = new RepoStore(root, { author: "e2e" });
    const name = prepareAsset(Uint8Array.from(Buffer.from(PNG_4X2, "base64"))).name;
    const fill = { asset: name, fit: "cover" as const, naturalWidth: 4, naturalHeight: 2, alt: "" };
    store.saveElement({ id: "pic", type: "rectangle", name: "Pic", x: 40, y: 40, width: 200, height: 100, style: { image: fill }, updatedAt: new Date().toISOString() });
    return { root, store, name };
  }

  it("marks image elements with a picture icon in the Layers tree", async () => {
    const { root, store } = imageProject();
    store.saveAsset({ data: PNG_4X2 });
    const page = await open(root);
    const rows = page.locator(".fwd-layer-row");
    await rows.filter({ hasText: "Pic" }).waitFor();
    // The type icon is the row's first svg; only the picture icon has a sun (circle).
    const typeIcon = (name: string) => rows.filter({ hasText: name }).locator("svg").first();
    expect(await typeIcon("Pic").locator("circle").count()).toBe(1);
    expect(await typeIcon("El 1").locator("circle").count()).toBe(0);
  }, 60_000);

  it("retries an image that wasn't there yet and shows it once it arrives, without a reload", async () => {
    const { root, store } = imageProject();
    const page = await open(root);
    await page.locator("#canvas .el-image-missing").waitFor();
    store.saveAsset({ data: PNG_4X2 }); // e.g. arrives with a git pull
    await page.locator('#canvas g[data-id="pic"] image').waitFor({ state: "attached", timeout: 20_000 });
    expect(await page.locator("#canvas .el-image-missing").count()).toBe(0);
  }, 60_000);

  it("draws image fills in the History checkpoint preview, rotated like the canvas", async () => {
    const { root, store } = imageProject();
    store.saveAsset({ data: PNG_4X2 });
    store.patchElement("pic", { rotation: 30 });
    store.createCheckpoint({ title: "With picture" });
    const page = await open(root);
    await page.locator('[data-toggle="timeline"]').click();
    await page.locator(".tl2-card", { hasText: "With picture" }).click();
    const image = page.locator(".tl2-preview-svg image");
    await image.waitFor({ state: "attached" });
    expect(await image.getAttribute("href")).toMatch(/^blob:/);
    expect(await image.getAttribute("clip-path")).toMatch(/^url\(#tl2-img-clip-\d+\)$/);
    // Shape and image share one rotated group about the element's centre (40+100, 40+50).
    expect(await image.evaluate((el) => el.parentElement?.getAttribute("transform"))).toBe("rotate(30 140 90)");
  }, 60_000);
});
