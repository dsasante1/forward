/**
 * The resources a canvas source can refresh on demand. After its own write the
 * canvas calls `CanvasSource.notifyChange(resource)` so the affected poll loop
 * re-fetches immediately instead of waiting for its next tick.
 */
export type RealtimeResource =
  | "elements"
  | "timeline"
  | "infra"
  | "flows"
  | "entities"
  | "agents"
  | "tasks"
  | "checkpoints";
