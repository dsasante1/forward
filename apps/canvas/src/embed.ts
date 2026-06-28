/**
 * Public entry for embedding the canvas in another app (the dashboard route).
 * Re-exports the mount function + the server-backed source so a host can drive
 * the editor with its own auth. The standalone canvas uses src/main.ts instead.
 *
 * The hand-written types for this entry live in ../embed.d.ts (kept in sync), so
 * consumers' typecheckers don't parse the canvas app source.
 */
export { mountCanvas } from "./canvas.js";
export type { MountOptions, CanvasHandle } from "./canvas.js";
export { ServerSource } from "./server-source.js";
export type { TokenProvider } from "./server-source.js";
// The data contract a host can implement to drive the editor itself — e.g. the
// VS Code extension bridges this over postMessage instead of using ServerSource.
export type {
  CanvasSource,
  ElementSnapshot,
  EntitySnapshot,
  InfraSnapshot,
} from "./source.js";
