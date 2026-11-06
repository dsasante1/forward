import { MAX_ASSET_BYTES, base64ToBytes, imageSize, type CaptureNode, type CaptureSnapshot } from "forward-core";

/**
 * `import_design_from_code` with `images`: fetch the bytes of every captured
 * `<img>` and store them as assets, so the draft shows the real picture instead
 * of a grey placeholder. Runs on the Node side after capture, so it works the
 * same for every capture engine and for saved DevTools snapshots (as long as
 * the URLs still answer). Best effort: an image that can't be fetched, isn't an
 * allowed type or is too big keeps its placeholder and is reported.
 */

/** Stores (or, for a dry run, only names) image bytes; mirrors `PUT /assets`. */
export type StoreImage = (bytes: Uint8Array) => Promise<{ name: string; width?: number; height?: number }>;

export interface ResolveImagesOptions {
  store: StoreImage;
  fetch?: typeof fetch;
  /** Most distinct images fetched per import. */
  maxImages?: number;
  timeoutMs?: number;
}

export interface ResolveImagesReport {
  stored: number;
  skipped: Array<{ src: string; reason: string }>;
}

const MAX_IMAGES = 200;

/** Fill `node.image` in place for every `<img>` with a fetchable `src`. */
export async function resolveCaptureImages(
  snapshots: CaptureSnapshot[],
  opts: ResolveImagesOptions,
): Promise<ResolveImagesReport> {
  const doFetch = opts.fetch ?? fetch;
  const max = opts.maxImages ?? MAX_IMAGES;
  const nodes: CaptureNode[] = [];
  const walk = (n: CaptureNode) => {
    if (n.tag === "img" && n.attrs?.src) nodes.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const s of snapshots) walk(s.root);

  const report: ResolveImagesReport = { stored: 0, skipped: [] };
  const bySrc = new Map<string, Promise<CaptureNode["image"] | undefined>>();
  const resolveOne = async (src: string): Promise<CaptureNode["image"] | undefined> => {
    try {
      const bytes = await load(src, doFetch, opts.timeoutMs ?? 10_000);
      const info = await opts.store(bytes);
      const size = info.width && info.height ? { width: info.width, height: info.height } : imageSize(bytes);
      if (!size) throw new Error("unreadable image size");
      report.stored++;
      return { asset: info.name, naturalWidth: size.width, naturalHeight: size.height };
    } catch (err) {
      report.skipped.push({ src: shortSrc(src), reason: (err as Error).message });
      return undefined;
    }
  };
  for (const node of nodes) {
    const src = node.attrs!.src!;
    let pending = bySrc.get(src);
    if (!pending) {
      if (bySrc.size >= max) {
        report.skipped.push({ src: shortSrc(src), reason: `over the ${max}-image limit` });
        continue;
      }
      pending = resolveOne(src);
      bySrc.set(src, pending);
    }
    const image = await pending;
    if (image) node.image = image;
  }
  return report;
}

/** Bytes for an http(s) or data: URL, refusing anything else and anything too big. */
async function load(src: string, doFetch: typeof fetch, timeoutMs: number): Promise<Uint8Array> {
  if (src.startsWith("data:")) {
    const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(src);
    if (!m) throw new Error("malformed data: URL");
    return m[1] ? base64ToBytes(m[2]!) : new TextEncoder().encode(decodeURIComponent(m[2]!));
  }
  const url = new URL(src);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${url.protocol} URLs aren't fetched`);
  const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ASSET_BYTES) throw new Error("larger than 5 MB");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_ASSET_BYTES) throw new Error("larger than 5 MB");
  return bytes;
}

function shortSrc(src: string): string {
  return src.startsWith("data:") ? `${src.slice(0, 40)}…` : src.length > 200 ? `${src.slice(0, 199)}…` : src;
}
