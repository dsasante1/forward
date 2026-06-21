/**
 * Public types for `forward-canvas/embed`, hand-written so host apps (the
 * dashboard) get types without their tsc parsing the canvas app source — which
 * uses Vite-only imports (`*.css?inline`) and pulls in mermaid/firebase.
 *
 * Keep in sync with src/embed.ts. The runtime ("import" condition) resolves to
 * src/embed.ts; this file only backs the "types" condition.
 */
export type TokenProvider = () => Promise<string | null | undefined>;

/** A CanvasSource backed by the Forward backend REST API; the host builds one
 * with its own token provider and hands it to mountCanvas. */
export declare class ServerSource {
  constructor(
    baseUrl: string,
    projectId: string,
    getToken: TokenProvider,
    pollMs?: number,
  );
}

export interface MountOptions {
  /** Element to render the editor into; its Shadow DOM is created/reused. */
  container: HTMLElement;
  /** The data source (a ServerSource when embedded). */
  source: ServerSource;
  /** Element id to select + center once it loads (e.g. a docs deep link). */
  focusElementId?: string | null;
}

/** Handle from mountCanvas; `destroy` stops polling and removes global listeners. */
export interface CanvasHandle {
  destroy: () => void;
}

export declare function mountCanvas(opts: MountOptions): CanvasHandle;
