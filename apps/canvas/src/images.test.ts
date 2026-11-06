import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "forward-core";
import type { ProjectBundle } from "forward-core/repo";
import { blobUrlFromAsset, firstImageFile, preserveAspectRatio, scaleToFit } from "./images.js";
import { StaticSource } from "./static-source.js";

describe("image fills", () => {
  it("maps each fit to SVG preserveAspectRatio", () => {
    expect(preserveAspectRatio("cover")).toBe("xMidYMid slice");
    expect(preserveAspectRatio("contain")).toBe("xMidYMid meet");
    expect(preserveAspectRatio("fill")).toBe("none");
  });

  it("scales down to the longer side and never up", () => {
    expect(scaleToFit(4000, 2000, 480)).toEqual({ width: 480, height: 240 });
    expect(scaleToFit(100, 300, 480)).toEqual({ width: 100, height: 300 });
    expect(scaleToFit(10000, 1, 480)).toEqual({ width: 480, height: 1 });
  });

  it("picks the first image from a drop or paste, from files or items", () => {
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    expect(firstImageFile({ files: [txt, png], items: [] } as unknown as DataTransfer)).toBe(png);
    const item = { kind: "file", type: "image/webp", getAsFile: () => png };
    expect(firstImageFile({ files: [], items: [item] } as unknown as DataTransfer)).toBe(png);
    expect(firstImageFile({ files: [txt], items: [] } as unknown as DataTransfer)).toBeUndefined();
    expect(firstImageFile(null)).toBeUndefined();
  });

  it("turns a fetched asset into a typed blob URL", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const url = blobUrlFromAsset({ name: `${"a".repeat(64)}.png`, mime: "image/png", bytes: 4, data: bytesToBase64(bytes) });
    expect(url).toMatch(/^blob:/);
    const blob = await (await fetch(url)).blob();
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    URL.revokeObjectURL(url);
  });

  it("resolves an exported image next to the bundle", async () => {
    const source = new StaticSource({} as ProjectBundle, "https://team.github.io/app/forward.json");
    const name = `${"b".repeat(64)}.webp`;
    expect(await source.assetUrl(name)).toBe(`https://team.github.io/app/images/${name}`);
  });
});

describe("rotatedBox", () => {
  it("leaves an unrotated box alone and grows a rotated one about its centre", async () => {
    const { rotatedBox } = await import("./timeline-view.js");
    const box = { x: 0, y: 0, width: 200, height: 100 };
    expect(rotatedBox(box, 0)).toBe(box);
    const quarter = rotatedBox(box, 90);
    expect(quarter.width).toBeCloseTo(100);
    expect(quarter.height).toBeCloseTo(200);
    expect(quarter.x).toBeCloseTo(50);
    expect(quarter.y).toBeCloseTo(-50);
    const tilted = rotatedBox({ x: 0, y: 0, width: 100, height: 100 }, 45);
    expect(tilted.width).toBeCloseTo(100 * Math.SQRT2);
  });
});
