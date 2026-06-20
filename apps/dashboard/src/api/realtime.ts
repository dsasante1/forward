import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A change broadcast by the server after a write — mirrors the backend's
 * `RealtimeService.ChangeEvent`. The server publishes on `project:<id>` with the
 * service-role key; clients subscribe here with the public anon key and re-fetch
 * the affected resource (the server stays the only DB writer).
 */
export interface ProjectChange {
  resource: "elements" | "timeline" | "infra" | "flows" | "tasks" | "members";
  op: "upsert" | "delete";
  ids: string[];
  actor: string;
  at: number;
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Realtime is optional: without both env values the hooks below simply no-op. */
export function realtimeEnabled(): boolean {
  return Boolean(URL && ANON);
}

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  if (!URL || !ANON) return null;
  if (!client) {
    client = createClient(URL, ANON, { auth: { persistSession: false } });
  }
  return client;
}

/**
 * Subscribe to a project's live change feed. `onChange` fires for every event;
 * the newest handler is always used (kept in a ref) so callers can close over
 * fresh state without re-subscribing. Unsubscribes on unmount / project change.
 */
export function useProjectRealtime(
  projectId: string | undefined,
  onChange: (e: ProjectChange) => void,
): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const sb = supabase();
    if (!sb || !projectId) return;
    const channel = sb
      .channel(`project:${projectId}`, { config: { broadcast: { ack: false } } })
      .on("broadcast", { event: "change" }, (msg) => {
        handler.current(msg.payload as ProjectChange);
      })
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [projectId]);
}
