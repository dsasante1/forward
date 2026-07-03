import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailService, type SendEmailInput } from "./email.service.js";

/**
 * The JSON body every enqueued email job carries. Kept identical to what
 * {@link EmailService.send} consumes so the queue handler is a thin pass-through
 * ("send this email") and any future email type reuses it without new plumbing.
 */
export type EmailJob = SendEmailInput;

interface QueueConfig {
  projectId: string;
  location: string;
  queue: string;
  /** Public base URL of THIS service (its Cloud Run URL) that Cloud Tasks POSTs
   * the job back to — the `internal/jobs/*` handler. Also the OIDC audience. */
  serviceUrl: string;
  /** Service account Cloud Tasks mints the request's OIDC token as; the handler
   * verifies the token's `email` claim matches it. The runtime SA must be able
   * to actAs this SA. */
  invokerServiceAccount: string;
}

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/**
 * Enqueues background work onto a GCP Cloud Tasks queue that delivers each job
 * back to this same service over HTTP (`internal/jobs/*`). This keeps side
 * effects like email off the request's critical path and hands retries/backoff
 * to a managed queue, without a Redis + always-on worker (which fit Cloud Run's
 * scale-to-zero model poorly).
 *
 * Best-effort and lazily configured, exactly like {@link EmailService} and
 * RealtimeService: if the queue env is absent (local dev, or prod before the
 * queue is provisioned) it *falls back to a direct, non-blocking send* so mail
 * still goes out and the request never blocks. Enqueue never throws — a queue
 * hiccup must never roll back the real write that scheduled it.
 *
 * Config (apps/server/.env):
 *   GCP_PROJECT_ID           — the GCP project holding the queue.
 *   CLOUD_TASKS_LOCATION     — queue region, e.g. "us-central1".
 *   CLOUD_TASKS_QUEUE        — queue id, e.g. "forward-email".
 *   CLOUD_TASKS_SERVICE_URL  — public base URL of this service (Cloud Run URL);
 *                              also the OIDC audience the job handler verifies.
 *   CLOUD_TASKS_INVOKER_SA   — service account Cloud Tasks mints the request's
 *                              OIDC token as; the handler authorizes its `email`.
 *
 * The runtime service account needs the `cloudtasks.enqueuer` role, and must be
 * able to actAs the invoker SA to attach its OIDC token. Auth to the Cloud Tasks
 * API uses an access token minted by the Cloud Run metadata server (no SDK, no
 * key files) — there is no shared secret to leak.
 */
@Injectable()
export class CloudTasksService {
  private readonly logger = new Logger(CloudTasksService.name);
  private readonly config?: QueueConfig;
  /** Cached metadata-server access token + its absolute expiry (ms epoch). */
  private token?: { value: string; expiresAt: number };

  constructor(
    config: ConfigService,
    private readonly email: EmailService,
  ) {
    const projectId = config.get<string>("GCP_PROJECT_ID");
    const location = config.get<string>("CLOUD_TASKS_LOCATION");
    const queue = config.get<string>("CLOUD_TASKS_QUEUE");
    const serviceUrl = config.get<string>("CLOUD_TASKS_SERVICE_URL");
    const invokerServiceAccount = config.get<string>("CLOUD_TASKS_INVOKER_SA");
    if (projectId && location && queue && serviceUrl && invokerServiceAccount) {
      this.config = {
        projectId,
        location,
        queue,
        serviceUrl: serviceUrl.replace(/\/$/, ""),
        invokerServiceAccount,
      };
    } else {
      this.logger.warn(
        "Cloud Tasks not configured — email jobs run inline (best-effort, non-blocking).",
      );
    }
  }

  /** Whether an actual queue is wired up (vs. the inline fallback). */
  get enabled(): boolean {
    return Boolean(this.config);
  }

  /**
   * Whether an enqueued email can actually be delivered on this deployment.
   * Every delivery path — the inline fallback here, or the queue handler after
   * dequeue — ultimately sends through {@link EmailService}, so this is exactly
   * "is Mailtrap configured", *not* "is the queue wired up": a live queue in
   * front of a disabled EmailService still delivers nothing. False means the
   * invite is created but no mail will be sent, so callers can surface a "check
   * email config" hint. (Same deployment, so this instance's Mailtrap config
   * mirrors the job handler's.)
   */
  get canDeliver(): boolean {
    return this.email.enabled;
  }

  /**
   * Schedule an email for background delivery. Resolves as soon as the job is
   * accepted by the queue (or handed to the inline fallback) — not when the mail
   * is actually sent. Never throws: a failure to enqueue degrades to a direct
   * fire-and-forget send so the message is not silently lost.
   */
  async enqueueEmail(job: EmailJob): Promise<void> {
    if (!this.config) {
      this.sendInline(job);
      return;
    }
    try {
      await this.createTask(this.config, "email", job);
    } catch (err) {
      this.logger.warn(
        `Cloud Tasks enqueue failed for "${job.subject}" — falling back to inline send: ${(err as Error).message}`,
      );
      this.sendInline(job);
    }
  }

  /** Direct, non-blocking send used when no queue is available. */
  private sendInline(job: EmailJob): void {
    void this.email.send(job).catch((err) => {
      this.logger.warn(
        `Inline email fallback failed for "${job.subject}": ${(err as Error).message}`,
      );
    });
  }

  /** Create one HTTP-target Cloud Task carrying `payload` to `internal/jobs/<kind>`. */
  private async createTask(
    cfg: QueueConfig,
    kind: string,
    payload: unknown,
  ): Promise<void> {
    const token = await this.accessToken();
    const url =
      `https://cloudtasks.googleapis.com/v2/projects/${cfg.projectId}` +
      `/locations/${cfg.location}/queues/${cfg.queue}/tasks`;
    const body = {
      task: {
        httpRequest: {
          httpMethod: "POST",
          url: `${cfg.serviceUrl}/internal/jobs/${kind}`,
          headers: { "Content-Type": "application/json" },
          // Cloud Tasks mints a Google-signed OIDC token as the invoker SA and
          // sends it as `Authorization: Bearer`. The handler verifies its
          // signature, audience and `email` claim — no shared secret to leak.
          oidcToken: {
            serviceAccountEmail: cfg.invokerServiceAccount,
            audience: cfg.serviceUrl,
          },
          // Cloud Tasks requires the body base64-encoded.
          body: Buffer.from(JSON.stringify(payload)).toString("base64"),
        },
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Cloud Tasks API ${res.status}: ${detail}`);
    }
  }

  /**
   * Access token for the Cloud Tasks API from the Cloud Run metadata server,
   * cached until ~60s before expiry. Only reachable on GCP — off-platform this
   * throws and callers fall back to an inline send.
   */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;
    const res = await fetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!res.ok) {
      throw new Error(`metadata token ${res.status}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: data.access_token,
      expiresAt: now + (data.expires_in - 60) * 1000,
    };
    return data.access_token;
  }
}
