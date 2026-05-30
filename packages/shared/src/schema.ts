import { z } from "zod";

/**
 * The data contract shared by the VS Code extension and the web canvas.
 *
 * Mirrors the Firebase Realtime Database JSON tree. Keep this flat (Firebase
 * favours shallow trees) and treat it as the single source of truth: if a shape
 * changes, change it here once and both apps follow.
 */

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/** What the extension parses out of a highlighted route. */
export const ApiPayload = z.object({
  endpoint: z.string().min(1),
  method: HttpMethod,
  description: z.string().default(""),
  parameters: z.array(z.string()).default([]),
  requestBody: z.record(z.string()).optional(),
  responseSample: z.record(z.unknown()).optional(),
});
export type ApiPayload = z.infer<typeof ApiPayload>;

/** A single design block on the canvas, bound to one API endpoint. */
export const CanvasNode = ApiPayload.extend({
  /** ISO-8601 timestamp of the last write. */
  updatedAt: z.string().datetime(),
});
export type CanvasNode = z.infer<typeof CanvasNode>;

/** One immutable entry in a node's append-only history. */
export const VersionEntry = z.object({
  version: z.string(),
  timestamp: z.number().int(),
  author: z.string(),
  commitHash: z.string().optional(),
  changeLog: z.string().default(""),
});
export type VersionEntry = z.infer<typeof VersionEntry>;

export const UserConfig = z.object({
  repositoryUrl: z.string().url().optional(),
  projectName: z.string().min(1),
});
export type UserConfig = z.infer<typeof UserConfig>;

/**
 * Full Firebase tree (handy for fixtures / offline mode).
 * Keyed maps mirror Firebase's object-as-collection convention.
 */
export const DatabaseTree = z.object({
  user_configs: z.record(UserConfig).default({}),
  canvas_nodes: z.record(z.record(CanvasNode)).default({}),
  version_timeline: z.record(z.record(z.array(VersionEntry))).default({}),
});
export type DatabaseTree = z.infer<typeof DatabaseTree>;

/** RTDB path helpers — the one place paths are constructed. */
export const paths = {
  node: (projectId: string, nodeId: string) =>
    `canvas_nodes/${projectId}/${nodeId}`,
  projectNodes: (projectId: string) => `canvas_nodes/${projectId}`,
  timeline: (projectId: string, nodeId: string) =>
    `version_timeline/${projectId}/${nodeId}`,
  userConfig: (userId: string) => `user_configs/${userId}`,
} as const;
