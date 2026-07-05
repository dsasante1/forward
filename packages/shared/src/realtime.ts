/**
 * The realtime sync-bus contract: after every successful write the server
 * broadcasts a compact {@link ChangeEvent} on a per-project channel; clients
 * re-fetch the affected resource. This is the ONE definition of the event shape
 * — the server (apps/server RealtimeService), the dashboard and the embedded
 * canvas all import it from here, so the publisher and every subscriber can't
 * drift apart.
 */

/** The layers a client can subscribe to — one per pollable resource. */
export type RealtimeResource =
  | "elements"
  | "timeline"
  | "infra"
  | "flows"
  | "entities"
  | "agents"
  | "tasks"
  | "checkpoints"
  | "members";

/** One change broadcast on a project's realtime channel. */
export interface ChangeEvent {
  resource: RealtimeResource;
  /** "upsert" | "delete" — what happened, so clients can patch incrementally. */
  op: "upsert" | "delete";
  /** Ids affected (e.g. an element id and its cascade-deleted descendants). */
  ids: string[];
  /** Clerk id of the actor, so a client can ignore its own echoes. */
  actor: string;
  /** Epoch ms when the server published the event. */
  at: number;
}
