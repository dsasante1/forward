import type { AssetName, DesignElement } from "./schema.js";

/**
 * Image assets: the browser-safe half (type sniffing, limits, base64, refs).
 * The bytes live in `.forward/assets/<sha256>.<ext>`; the store in `repo/`
 * hashes and writes them.
 */

/** The largest image the store accepts. The canvas downscales before upload. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

/** The longest side the canvas re-encodes an uploaded image to. */
export const MAX_IMAGE_SIDE = 4096;

/** Allowed image types, keyed by file extension. SVG is excluded: it can carry script. */
export const ASSET_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
} as const;

export type AssetExt = keyof typeof ASSET_TYPES;

/** The MIME type for an asset name, from its extension. */
export function assetMime(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return (ASSET_TYPES as Record<string, string>)[ext];
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The type of an image from its first bytes, never from what a client claims.
 * Returns undefined for anything outside {@link ASSET_TYPES}.
 */
export function sniffImage(bytes: Uint8Array): AssetExt | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  if (startsWith(bytes, ascii("ftyp"), 4) && (startsWith(bytes, ascii("avif"), 8) || startsWith(bytes, ascii("avis"), 8))) {
    return "avif";
  }
  return undefined;
}

/**
 * An image's pixel size from its header, without decoding it (so the store and
 * the MCP tool can size an element from a file). Undefined when unreadable.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const ext = sniffImage(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : undefined);
  try {
    switch (ext) {
      case "png":
        return ok(dv.getUint32(16), dv.getUint32(20));
      case "gif":
        return ok(dv.getUint16(6, true), dv.getUint16(8, true));
      case "jpg": {
        let i = 2;
        while (i + 9 < bytes.length) {
          if (bytes[i] !== 0xff) return undefined;
          const marker = bytes[i + 1]!;
          // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return ok(dv.getUint16(i + 7), dv.getUint16(i + 5));
          }
          i += 2 + dv.getUint16(i + 2);
        }
        return undefined;
      }
      case "webp": {
        const chunk = String.fromCharCode(...bytes.subarray(12, 16));
        if (chunk === "VP8 ") return ok(dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff);
        if (chunk === "VP8L") {
          const b = dv.getUint32(21, true);
          return ok((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
        }
        if (chunk === "VP8X") {
          const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
          const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
          return ok(w + 1, h + 1);
        }
        return undefined;
      }
      case "avif": {
        // The first `ispe` (image spatial extents) box: version/flags, width, height.
        const sig = ascii("ispe");
        for (let i = 0; i + 16 <= bytes.length && i < 4096; i++) {
          if (startsWith(bytes, sig, i)) return ok(dv.getUint32(i + 8), dv.getUint32(i + 12));
        }
        return undefined;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Drop the metadata that can locate or identify someone — EXIF (GPS, camera
 * serial), XMP and IPTC — from a JPEG or PNG, leaving the pixels and the colour
 * profile alone. The store runs every upload through it, so an image added by
 * any surface (an agent's file, a pasted photo) is clean before git sees it.
 * Other formats, and anything it can't parse, are returned unchanged.
 */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
  const ext = sniffImage(bytes);
  try {
    if (ext === "jpg") return stripJpeg(bytes);
    if (ext === "png") return stripPng(bytes);
  } catch {
    // A malformed file: leave it as uploaded rather than corrupt it further.
  }
  return bytes;
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b;
    const marker = b[i + 1]!;
    // Start of scan: the rest is entropy-coded image data.
    if (marker === 0xda) {
      keep.push(b.subarray(i));
      return concat(keep);
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) return b;
    // APP1 (EXIF/XMP) and APP13 (IPTC) go; APP2 (ICC profile) and the rest stay.
    if (marker !== 0xe1 && marker !== 0xed) keep.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return b;
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i);
    const end = i + 12 + len;
    if (end > b.length) return b;
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    if (!PNG_DROP.has(type)) keep.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(keep);
  }
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Base64-encode bytes (browser and Node; chunked so large images don't overflow the stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Decode base64 into bytes. Throws on malformed input. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** What `PUT /assets` accepts: the image bytes, base64-encoded. */
export interface AssetUpload {
  data: string;
}

/** What `GET /assets/:name` returns and `PUT /assets` answers with (minus `data`). */
export interface AssetInfo {
  name: AssetName;
  mime: string;
  bytes: number;
  /** Pixel size read from the file header, when the format allows it. */
  width?: number;
  height?: number;
}

/** An asset with its bytes, base64-encoded. */
export interface AssetData extends AssetInfo {
  data: string;
}

/** Scale `w × h` down (never up) so its longer side is at most `max`. */
export function scaleToFit(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Every asset a set of elements paints, deduplicated. */
export function assetRefs(elements: Iterable<DesignElement>): Set<string> {
  const out = new Set<string>();
  for (const el of elements) if (el.style?.image) out.add(el.style.image.asset);
  return out;
}
