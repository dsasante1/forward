import { describe, expect, it, vi } from "vitest";
import { CaptureSnapshot, type CaptureNode } from "forward-core";
import { resolveCaptureImages, type StoreImage } from "./capture-images.js";

// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const img = (src: string): CaptureNode => ({ tag: "img", rect: { x: 0, y: 0, w: 10, h: 10 }, attrs: { src } });
const snapshot = (children: CaptureNode[]) =>
  CaptureSnapshot.parse({
    version: 1,
    route: "/",
    viewport: { width: 100, height: 100 },
    root: { tag: "body", rect: { x: 0, y: 0, w: 100, h: 100 }, children },
  });

describe("resolveCaptureImages", () => {
  it("fetches each distinct src once, stores it and fills node.image", async () => {
    const fetch = vi.fn(async () => new Response(Buffer.from(PNG, "base64")));
    const store = vi.fn<StoreImage>(async () => ({ name: `${"d".repeat(64)}.png`, width: 1, height: 1 }));
    const snap = snapshot([img("http://localhost:5173/a.png"), img("http://localhost:5173/a.png")]);
    const report = await resolveCaptureImages([snap], { store, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(report).toEqual({ stored: 1, skipped: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const n of snap.root.children!) expect(n.image).toEqual({ asset: `${"d".repeat(64)}.png`, naturalWidth: 1, naturalHeight: 1 });
  });

  it("decodes data: URLs without fetching, and skips what it may not or cannot load", async () => {
    const fetch = vi.fn(async (url: URL) =>
      url.pathname === "/missing.png" ? new Response("no", { status: 404 }) : new Response(Buffer.from(PNG, "base64")),
    );
    const store = vi.fn<StoreImage>(async (bytes) => {
      if (bytes[0] !== 0x89) throw new Error("Unsupported image type.");
      return { name: `${"e".repeat(64)}.png` };
    });
    const snap = snapshot([
      img(`data:image/png;base64,${PNG}`),
      img("file:///etc/passwd"),
      img("http://x/missing.png"),
      img("data:image/svg+xml,%3Csvg%2F%3E"),
    ]);
    const report = await resolveCaptureImages([snap], { store, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(report.stored).toBe(1);
    expect(report.skipped.map((s) => s.reason)).toEqual(["file: URLs aren't fetched", "HTTP 404", "Unsupported image type."]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Size read from the header when the store doesn't report one.
    expect(snap.root.children![0]!.image).toEqual({ asset: `${"e".repeat(64)}.png`, naturalWidth: 1, naturalHeight: 1 });
    expect(snap.root.children![1]!.image).toBeUndefined();
  });

  it("stops at the image limit", async () => {
    const fetch = vi.fn(async () => new Response(Buffer.from(PNG, "base64")));
    const store: StoreImage = async () => ({ name: `${"f".repeat(64)}.png`, width: 1, height: 1 });
    const snap = snapshot([img("http://x/1.png"), img("http://x/2.png")]);
    const report = await resolveCaptureImages([snap], { store, fetch: fetch as unknown as typeof globalThis.fetch, maxImages: 1 });
    expect(report.stored).toBe(1);
    expect(report.skipped).toEqual([{ src: "http://x/2.png", reason: "over the 1-image limit" }]);
  });
});
