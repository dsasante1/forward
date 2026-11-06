import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, imageSize, sniffImage, stripImageMetadata } from "./assets.js";
import { DesignElement } from "./schema.js";

const bytes = (...parts: Array<string | number[]>) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];

describe("image assets", () => {
  it("sniffs allowed types from their magic bytes and nothing else", () => {
    expect(sniffImage(bytes([0x89], "PNG\r\n", [0x1a, 0x0a]))).toBe("png");
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(bytes("GIF89a"))).toBe("gif");
    expect(sniffImage(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("webp");
    expect(sniffImage(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBe("avif");
    expect(sniffImage(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeUndefined();
    expect(sniffImage(new Uint8Array())).toBeUndefined();
  });

  it("reads pixel size from PNG, GIF, JPEG and WebP headers", () => {
    const png = bytes([0x89], "PNG\r\n", [0x1a, 0x0a], u32be(13), "IHDR", u32be(640), u32be(480));
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
    expect(imageSize(bytes("GIF89a", u16le(32), u16le(16)))).toEqual({ width: 32, height: 16 });
    // SOI, an APP0 segment (length 4), then SOF0: length, precision, height, width.
    const jpg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 44, 3]);
    expect(imageSize(jpg)).toEqual({ width: 300, height: 200 });
    const vp8x = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X", [10, 0, 0, 0], [0, 0, 0, 0], [99, 0, 0], [49, 0, 0]);
    expect(imageSize(vp8x)).toEqual({ width: 100, height: 50 });
    expect(imageSize(bytes("not an image"))).toBeUndefined();
  });

  it("round-trips base64 for large buffers", () => {
    const big = Uint8Array.from({ length: 200_000 }, (_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  it("accepts an image fill on an element and rejects a non-asset name", () => {
    const base = { id: "a", type: "rectangle", x: 0, y: 0, width: 1, height: 1, updatedAt: "2026-01-01T00:00:00.000Z" };
    const asset = `${"f".repeat(64)}.webp`;
    const ok = DesignElement.parse({ ...base, style: { image: { asset, naturalWidth: 2, naturalHeight: 1 } } });
    expect(ok.style?.image).toEqual({ asset, fit: "cover", naturalWidth: 2, naturalHeight: 1, alt: "" });
    const bad = DesignElement.safeParse({ ...base, style: { image: { asset: "../x.png", naturalWidth: 1, naturalHeight: 1 } } });
    expect(bad.success).toBe(false);
  });
});

describe("stripImageMetadata", () => {
  it("drops EXIF/XMP (APP1) and IPTC (APP13) from a JPEG but keeps the ICC profile and scan", () => {
    const seg = (marker: number, body: number[]) => [0xff, marker, 0, body.length + 2, ...body];
    const jpg = bytes(
      [0xff, 0xd8],
      seg(0xe0, [1, 2]),
      seg(0xe1, [...[..."Exif"].map((c) => c.charCodeAt(0)), 0, 0, 9, 9]),
      seg(0xe2, [7]),
      seg(0xed, [5]),
      [0xff, 0xda, 0, 2, 0xaa, 0xbb, 0xff, 0xd9],
    );
    const out = stripImageMetadata(jpg);
    expect(Array.from(out)).toEqual([0xff, 0xd8, ...seg(0xe0, [1, 2]), ...seg(0xe2, [7]), 0xff, 0xda, 0, 2, 0xaa, 0xbb, 0xff, 0xd9]);
  });

  it("drops text and eXIf chunks from a PNG", () => {
    const chunk = (type: string, body: number[]) => [...u32be(body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0];
    const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = chunk("IHDR", Array(13).fill(1));
    const png = Uint8Array.from([...head, ...ihdr, ...chunk("eXIf", [1, 2]), ...chunk("tEXt", [3]), ...chunk("IDAT", [4]), ...chunk("IEND", [])]);
    expect(Array.from(stripImageMetadata(png))).toEqual([...head, ...ihdr, ...chunk("IDAT", [4]), ...chunk("IEND", [])]);
  });

  it("leaves other formats and malformed files alone", () => {
    const gif = bytes("GIF89a", [1, 0, 1, 0]);
    expect(stripImageMetadata(gif)).toBe(gif);
    const broken = bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]);
    expect(stripImageMetadata(broken)).toBe(broken);
  });
});
