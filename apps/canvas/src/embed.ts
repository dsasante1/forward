/**
 * Public entry for embedding the canvas in another app: the VS Code extension
 * webview and the standalone host in host/ (served by `forward serve`, exported
 * by `forward export`). Re-exports the mount function and the built-in sources.
 *
 * The hand-written types for this entry live in ../embed.d.ts (kept in sync), so
 * consumers' typecheckers don't parse the canvas app source.
 */
export { mountCanvas } from "./canvas.js";
export type { MountOptions, CanvasHandle } from "./canvas.js";
export type { TasksMode } from "./tasks-view.js";
export { ServerSource } from "./server-source.js";
export type { TokenProvider } from "./server-source.js";
// Read-only source over an exported project bundle (GitHub Pages viewer).
export { StaticSource } from "./static-source.js";
// The data contract a host can implement to drive the editor itself — e.g. the
// VS Code extension bridges this over postMessage instead of using ServerSource.
export type {
  AgentSnapshot,
  CanvasSource,
  ElementSnapshot,
  EntitySnapshot,
  InfraSnapshot,
} from "./source.js";
