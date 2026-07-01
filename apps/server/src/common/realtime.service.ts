import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

/** The layers a client can subscribe to — mirrors the old ETag pollers. */
export type RealtimeResource =
  | "elements"
  | "timeline"
  | "infra"
  | "flows"
  | "entities"
  | "tasks"
  | "checkpoints"
  | "members";

/** Cap on how long a write may wait for the channel to join before giving up. */
const SUBSCRIBE_TIMEOUT_MS = 5000;

export interface ChangeEvent {
  resource: RealtimeResource;
  /** "upsert" | "delete" — what happened, so clients can patch incrementally. */
  op: "upsert" | "delete";
  /** Ids affected (e.g. an element id and its cascade-deleted descendants). */
  ids: string[];
  /** Clerk id of the actor, so a client can ignore its own echoes. */
  actor: string;
  at: number;
}

/**
 * The realtime sync bus. Previously Firebase *was* the bus (the canvas
 * used `onValue`, the extension polled with ETags). Centralized, the server is
 * the single writer, so after every successful write it broadcasts a compact
 * change event on a per-project Supabase Realtime channel (`project:<id>`).
 * Clients subscribe with the Supabase **anon** key (never the service-role key
 * held here) and re-fetch the affected resource — server stays authoritative,
 * no client touches the DB directly.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  // null when Supabase creds are absent (e.g. local dev): the bus becomes a
  // no-op and clients fall back to refetch-on-demand. The bus is best-effort, so
  // running without it must never crash the server.
  private readonly supabase: SupabaseClient | null;
  // Cache the *subscription promise* so the first publish to a project waits for
  // the channel to reach SUBSCRIBED before sending (a send on an un-joined
  // channel is silently dropped — which would lose the first live event).
  private readonly channels = new Map<
    string,
    Promise<ReturnType<SupabaseClient["channel"]>>
  >();
  // Secret that turns a (guessable) project id into an unguessable channel name —
  // see channelName(). Falls back to the Clerk secret (always present, server-only)
  // so no new required env is introduced; set REALTIME_CHANNEL_SECRET to rotate.
  private readonly channelSecret: string;

  constructor(config: ConfigService) {
    const secret =
      config.get<string>("REALTIME_CHANNEL_SECRET") ??
      config.get<string>("CLERK_SECRET_KEY");
    const url = config.get<string>("SUPABASE_URL");
    const key = config.get<string>("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      // The bus is live, so the (unguessable) channel name is the tenancy
      // boundary — it MUST derive from a real secret, never a shipped constant.
      if (!secret) {
        throw new Error(
          "REALTIME_CHANNEL_SECRET (or CLERK_SECRET_KEY) is required when Supabase Realtime is configured.",
        );
      }
      this.channelSecret = secret;
      this.supabase = createClient(url, key, {
        auth: { persistSession: false },
        realtime: { params: {} },
      });
    } else {
      // Bus disabled (e.g. local dev): no channel is ever created, so the secret
      // is moot — an inert placeholder, not a real-looking fallback that could be
      // relied on by accident.
      this.channelSecret = "realtime-disabled";
      this.supabase = null;
      this.logger.warn(
        "Supabase Realtime not configured — change events disabled (clients refetch on demand).",
      );
    }
  }

  /**
   * The Supabase channel a project broadcasts on. Supabase `broadcast` channels
   * are NOT access-controlled — anyone holding the public anon key who knows the
   * channel name can subscribe. So the name must not be the (guessable) project
   * id: we derive an HMAC of it under a server-only secret, making the name itself
   * a capability. Only a project member ever learns it, handed over the
   * MembershipGuard-protected `GET /projects/:id/realtime` route — which restores
   * the tenancy boundary the REST API enforces. The events carry only metadata
   * (ids/actor), but that still must not leak across tenants.
   *
   * (A stronger model is Supabase Realtime Authorization with RLS on
   * `realtime.messages`; this capability scheme needs no migration and no
   * per-message identity, at the cost of no per-member revocation until the
   * secret rotates — acceptable for metadata-only events.)
   */
  channelName(projectId: string): string {
    const mac = createHmac("sha256", this.channelSecret)
      .update(projectId)
      .digest("hex");
    return `project:${mac.slice(0, 32)}`;
  }

  /** Broadcast a change to everyone subscribed to this project's channel. */
  async publish(projectId: string, event: ChangeEvent): Promise<void> {
    if (!this.supabase) return;
    try {
      const channel = await this.channelFor(projectId);
      await channel.send({
        type: "broadcast",
        event: "change",
        payload: event,
      });
    } catch (err) {
      // Realtime is best-effort: a missed broadcast just means a client falls
      // back to its next poll/refetch. Never fail the write because of it.
      // Drop the cached channel so the next publish re-subscribes cleanly.
      this.channels.delete(projectId);
      this.logger.warn(
        `Realtime publish failed for ${projectId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get (or create) the project channel, resolved only once it's SUBSCRIBED.
   * Rejects on any terminal/non-subscribed status AND after a hard timeout, so a
   * channel that never joins can't leave the awaited promise (and thus the write
   * handler that awaits publish()) hanging forever. A rejection is swallowed by
   * publish(), which evicts the cache so the next write re-subscribes cleanly.
   */
  private channelFor(
    projectId: string,
  ): Promise<ReturnType<SupabaseClient["channel"]>> {
    const supabase = this.supabase;
    if (!supabase) return Promise.reject(new Error("realtime disabled"));
    let pending = this.channels.get(projectId);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const channel = supabase.channel(this.channelName(projectId), {
          config: { broadcast: { ack: false } },
        });
        const timer = setTimeout(() => {
          void supabase.removeChannel(channel);
          reject(new Error("subscribe timed out"));
        }, SUBSCRIBE_TIMEOUT_MS);
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve(channel);
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            clearTimeout(timer);
            void supabase.removeChannel(channel);
            reject(new Error(`channel ${status}`));
          }
        });
      });
      this.channels.set(projectId, pending);
    }
    return pending;
  }

  async onModuleDestroy(): Promise<void> {
    await this.supabase?.removeAllChannels();
  }
}
