import { z } from "zod";

/**
 * The data contract shared by the VS Code extension and the web canvas.
 *
 * Mirrors the Firebase Realtime Database JSON tree. Keep this flat (Firebase
 * favours shallow trees) and treat it as the single source of truth: if a shape
 * changes, change it here once and both apps follow.
 *
 * Two layers, intentionally separate:
 *   1. DESIGN  — what a designer draws on the canvas (frames, shapes, text,
 *      components). This is the primary artefact and exists on its own.
 *   2. API BINDING — an OPTIONAL documentation note the backend attaches to a
 *      design element from VS Code. Most elements never get one.
 *
 * So: a design element MAY own an apiBinding; an endpoint is never a first-class
 * canvas object by itself.
 */

// --------------------------------------------------------------------------
// API binding (the backend documentation — pillar 2)
// --------------------------------------------------------------------------

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/**
 * Documentation a backend dev attaches to a design element from VS Code.
 *
 * Docs-first and framework-agnostic. `title` + Markdown `description` are the
 * core and carry the meaning; `language`, `method`, `endpoint` and `parameters`
 * are OPTIONAL structured hints for REST-style HTTP endpoints. A GraphQL, gRPC,
 * CLI or background-job binding just fills in `title` + `language` + the docs
 * and leaves the HTTP fields blank — nothing here assumes Express or JavaScript.
 */
export const ApiBinding = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  /** Free-form language/framework tag, e.g. "Python/FastAPI", "Go", "GraphQL". */
  language: z.string().optional(),
  /** Optional HTTP hints — present for REST endpoints, omitted otherwise. */
  method: HttpMethod.optional(),
  endpoint: z.string().optional(),
  parameters: z.array(z.string()).default([]),
});
export type ApiBinding = z.infer<typeof ApiBinding>;

// --------------------------------------------------------------------------
// Design layer (what the designer draws — pillar 1)
// --------------------------------------------------------------------------

export const ElementType = z.enum([
  "frame", // a container / screen
  "rectangle", // generic box (buttons, cards, inputs…)
  "text", // a text label
  "component", // a reusable master definition
  "instance", // a placed copy of a component
]);
export type ElementType = z.infer<typeof ElementType>;

/** Visual styling — all optional, sensible defaults applied at render time. */
export const Style = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  radius: z.number().nonnegative().optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().optional(),
  color: z.string().optional(),
});
export type Style = z.infer<typeof Style>;

/**
 * A single element on the design canvas. Geometry is absolute (canvas space);
 * `parentId` records hierarchy/nesting. `apiBinding` is the optional backend
 * annotation. `componentId` links an instance back to its master component.
 */
export const DesignElement = z.object({
  id: z.string().min(1),
  type: ElementType,
  name: z.string().default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  parentId: z.string().nullable().default(null),
  text: z.string().optional(),
  style: Style.optional(),
  /** For type === "instance": the id of the source component element. */
  componentId: z.string().optional(),
  /** Optional API documentation attached by the backend from VS Code. */
  apiBinding: ApiBinding.optional(),
  /** ISO-8601 timestamp of the last write. */
  updatedAt: z.string().datetime(),
});
export type DesignElement = z.infer<typeof DesignElement>;

// --------------------------------------------------------------------------
// Versioning + config
// --------------------------------------------------------------------------

/** One immutable entry in an element's append-only history. */
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
  design_elements: z.record(z.record(DesignElement)).default({}),
  version_timeline: z.record(z.record(z.array(VersionEntry))).default({}),
});
export type DatabaseTree = z.infer<typeof DatabaseTree>;

/** RTDB path helpers — the one place paths are constructed. */
export const paths = {
  element: (projectId: string, elementId: string) =>
    `design_elements/${projectId}/${elementId}`,
  projectElements: (projectId: string) => `design_elements/${projectId}`,
  /** Just the apiBinding sub-tree of one element — what VS Code writes to. */
  apiBinding: (projectId: string, elementId: string) =>
    `design_elements/${projectId}/${elementId}/apiBinding`,
  timeline: (projectId: string, elementId: string) =>
    `version_timeline/${projectId}/${elementId}`,
  userConfig: (userId: string) => `user_configs/${userId}`,
} as const;
