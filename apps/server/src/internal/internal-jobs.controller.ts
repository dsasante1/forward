import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import { OAuth2Client } from "google-auth-library";
import { Public } from "../auth/public.decorator.js";
import { EmailService, type SendEmailInput } from "../common/email.service.js";
import type { EmailJob } from "../common/cloud-tasks.service.js";

/**
 * Sink for background jobs delivered by Cloud Tasks (see CloudTasksService).
 *
 * Public (no Clerk session) — these are server-to-server calls from the queue,
 * not a signed-in user. Authenticity is proven instead by the Google-signed
 * OIDC token Cloud Tasks attaches as `Authorization: Bearer`: we verify its
 * signature + expiry, that its audience is our service URL, and that its `email`
 * claim is the expected invoker service account. A forged or replayed request
 * from the open internet can satisfy none of those.
 *
 * HTTP status drives Cloud Tasks' retry policy, so it is chosen deliberately:
 *   2xx — done; the task is deleted.
 *   4xx — permanent failure (bad token / malformed job); dropped, no retry
 *         loop on a poison payload.
 *   5xx — transient failure (mail provider hiccup); Cloud Tasks retries with
 *         backoff up to the queue's max attempts.
 */
@Controller("internal/jobs")
@SkipThrottle()
export class InternalJobsController {
  private readonly logger = new Logger(InternalJobsController.name);
  private readonly oauth = new OAuth2Client();
  private readonly audience?: string;
  private readonly invokerServiceAccount?: string;

  constructor(
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    // Normalize the trailing slash the same way CloudTasksService does when it
    // mints the OIDC token's audience — otherwise a service URL configured with a
    // trailing slash would make every job fail verification (aud mismatch).
    this.audience = config.get<string>("CLOUD_TASKS_SERVICE_URL")?.replace(/\/$/, "");
    this.invokerServiceAccount = config.get<string>("CLOUD_TASKS_INVOKER_SA");
  }

  @Public()
  @Post("email")
  @HttpCode(204)
  async handleEmailJob(
    @Headers("authorization") authorization: string | undefined,
    @Body() job: EmailJob,
  ): Promise<void> {
    await this.assertFromQueue(authorization);
    assertEmailJob(job);

    // If email isn't configured on this instance, retrying can never help —
    // acknowledge and drop rather than spin the queue against a 5xx.
    if (!this.email.enabled) {
      this.logger.warn(`Email job dropped (email disabled): "${job.subject}"`);
      return;
    }

    const ok = await this.email.send(job);
    if (!ok) {
      // Transient: let Cloud Tasks retry with backoff.
      throw new ServiceUnavailableException("Email send failed; will retry");
    }
  }

  /**
   * Reject anything that can't prove it came from our Cloud Tasks queue by
   * verifying the Google-signed OIDC token: signature + expiry (verifyIdToken),
   * audience == our service URL, and the `email` claim == the invoker SA.
   */
  private async assertFromQueue(authorization: string | undefined): Promise<void> {
    if (!this.audience || !this.invokerServiceAccount) {
      // Misconfigured instance: nothing to verify against. Fail closed.
      throw new ForbiddenException("Job invoker verification not configured");
    }
    const token = bearer(authorization);
    if (!token) throw new ForbiddenException("Missing bearer token");

    let email: string | undefined;
    let emailVerified: boolean | undefined;
    try {
      const ticket = await this.oauth.verifyIdToken({
        idToken: token,
        audience: this.audience,
      });
      const payload = ticket.getPayload();
      email = payload?.email;
      emailVerified = payload?.email_verified;
    } catch (err) {
      this.logger.warn(`OIDC verification failed: ${(err as Error).message}`);
      throw new ForbiddenException("Invalid job token");
    }
    if (email !== this.invokerServiceAccount || emailVerified !== true) {
      throw new ForbiddenException("Job token is not the invoker service account");
    }
  }
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}

/** Minimal shape guard — a malformed job is a permanent (4xx) failure. */
function assertEmailJob(job: EmailJob): asserts job is SendEmailInput {
  if (
    !job ||
    typeof job !== "object" ||
    !job.to ||
    typeof job.subject !== "string" ||
    (!job.text && !job.html)
  ) {
    throw new BadRequestException("Malformed email job");
  }
}
