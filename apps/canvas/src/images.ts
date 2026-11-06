import {
  ASSET_TYPES,
  MAX_ASSET_BYTES,
  MAX_IMAGE_SIDE,
  assetMime,
  base64ToBytes,
  scaleToFit,
  sniffImage,
  type AssetData,
  type ImageFit,
} from "forward-core";

/**
 * Image fills on the canvas: preparing a dropped/pasted file for upload, and
 * turning a stored asset into something an SVG `<image>` can show.
 */

/** A browser URL for an asset fetched as base64 (token- or bridge-backed sources). */
export function blobUrlFromAsset(asset: AssetData): string {
  const bytes = base64ToBytes(asset.data);
  const mime = assetMime(asset.name) ?? asset.mime;
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
}

/** SVG `preserveAspectRatio` for an image fit. */
export function preserveAspectRatio(fit: ImageFit): string {
  return fit === "contain" ? "xMidYMid meet" : fit === "fill" ? "none" : "xMidYMid slice";
}

export { scaleToFit };

/** The image types a user can drop or pick (what the store accepts). */
export const ACCEPTED_IMAGE_TYPES = Object.values(ASSET_TYPES).join(",");

export interface PreparedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Ready a user's image for upload: re-encode it (which drops EXIF, so a phone
 * photo's GPS position never lands in a public repo), cap its longer side at
 * {@link MAX_IMAGE_SIDE}, and shrink further until it fits {@link MAX_ASSET_BYTES}.
 * Small GIFs are kept as they are so animation survives (GIF has no EXIF).
 * Throws a user-readable message for anything that isn't an allowed image.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const original = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(original);
  if (!kind) throw new Error("That file isn't a PNG, JPEG, WebP, GIF or AVIF image.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This browser can't decode that image.");
  });
  try {
    const natural = { width: bitmap.width, height: bitmap.height };
    if (kind === "gif" && original.length <= MAX_ASSET_BYTES && Math.max(natural.width, natural.height) <= MAX_IMAGE_SIDE) {
      return { bytes: original, ...natural };
    }
    let max = MAX_IMAGE_SIDE;
    for (let attempt = 0; attempt < 6; attempt++) {
      const size = scaleToFit(natural.width, natural.height, max);
      const bytes = await encode(bitmap, size.width, size.height);
      if (bytes.length <= MAX_ASSET_BYTES) return { bytes, ...size };
      max = Math.round(Math.max(size.width, size.height) * 0.7);
    }
    throw new Error("That image is too large to store, even scaled down.");
  } finally {
    bitmap.close();
  }
}

/** Draw a bitmap at a size and encode it: WebP where supported, else PNG. */
async function encode(bitmap: ImageBitmap, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the image (no 2D canvas).");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  // A browser without a WebP encoder silently returns PNG, which is also fine.
  if (!blob) throw new Error("Couldn't encode the image.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** The first image file in a drop or paste, if any. */
export function firstImageFile(list: DataTransfer | null | undefined): File | undefined {
  if (!list) return undefined;
  for (const f of Array.from(list.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(list.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return undefined;
}
