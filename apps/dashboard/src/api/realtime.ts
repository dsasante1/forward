import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChangeEvent } from "forward-core";

/**
 * A change broadcast by the server after a write — the shared `ChangeEvent`
 * contract from forward-core (realtime.ts). The server publishes on the
 * HMAC-named project channel with the service-role key; clients subscribe here
 * with the public anon key and re-fetch the affected resource (the server stays
 * the only DB writer).
 */
export type ProjectChange = ChangeEvent;

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
 * fresh state without re-subscribing. Unsubscribes on unmount / channel change.
 *
 * `channel` is the server-issued, unguessable channel name (from
 * `GET /projects/:id/realtime`), NOT the project id — the broadcast bus is not
 * access-controlled, so the name itself is the membership capability. Pass
 * undefined while it's still resolving (or when realtime is disabled) to no-op.
 */
export function useProjectRealtime(
  channel: string | undefined,
  onChange: (e: ProjectChange) => void,
): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const sb = supabase();
    if (!sb || !channel) return;
    const ch = sb
      .channel(channel, { config: { broadcast: { ack: false } } })
      .on("broadcast", { event: "change" }, (msg) => {
        handler.current(msg.payload as ProjectChange);
      })
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [channel]);
}
