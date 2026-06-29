import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verifyWebhook, type WebhookEvent } from "@clerk/backend/webhooks";
import { Public } from "../auth/public.decorator.js";
import { ClerkUserService } from "../common/clerk-user.service.js";
import { OrgSyncService } from "../common/org-sync.service.js";

/** The Express request shape we need: headers + the raw (unparsed) body buffer. */
interface RawRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}

/**
 * Clerk webhook sink. Clerk is the source of truth for users and organizations;
 * this endpoint keeps our local mirror (`User`, `Organization`,
 * `OrganizationMember`) in step in near-real-time so the server can JOIN and
 * authorize without a Clerk round-trip on every request.
 *
 * Public (no bearer auth) — authenticity is proven by the Svix signature instead,
 * verified against CLERK_WEBHOOK_SIGNING_SECRET over the exact request bytes.
 */
@Controller("webhooks/clerk")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly signingSecret: string;

  constructor(
    private readonly users: ClerkUserService,
    private readonly orgs: OrgSyncService,
    config: ConfigService,
  ) {
    this.signingSecret = config.getOrThrow<string>(
      "CLERK_WEBHOOK_SIGNING_SECRET",
    );
  }

  @Public()
  @Post()
  @HttpCode(200)
  async handle(@Req() req: RawRequest): Promise<{ ok: true }> {
    if (!req.rawBody) throw new BadRequestException("Missing body");

    let evt: WebhookEvent;
    try {
      // Reconstruct a Web Request so Clerk's Svix verifier can read the signature
      // headers and the raw body exactly as sent.
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v) && v[0]) headers.set(k, v[0]);
      }
      const request = new Request("https://forward/webhooks/clerk", {
        method: "POST",
        headers,
        body: req.rawBody,
      });
      evt = await verifyWebhook(request, { signingSecret: this.signingSecret });
    } catch (err) {
      this.logger.warn(`Webhook verification failed: ${(err as Error).message}`);
      throw new BadRequestException("Invalid webhook signature");
    }

    try {
      await this.dispatch(evt);
    } catch (err) {
      // Log but still 200: a transient mirror failure shouldn't make Clerk retry
      // forever; the lazy ensure paths self-heal on the next authenticated touch.
      this.logger.error(
        `Webhook ${evt.type} handler failed: ${(err as Error).message}`,
      );
    }
    return { ok: true };
  }

  private async dispatch(evt: WebhookEvent): Promise<void> {
    switch (evt.type) {
      case "user.created":
      case "user.updated":
        await this.users.sync(evt.data.id);
        break;

      case "organization.created":
      case "organization.updated":
        await this.orgs.upsertOrg({
          id: evt.data.id,
          name: evt.data.name,
          slug: evt.data.slug,
          imageUrl: evt.data.image_url,
        });
        break;

      case "organization.deleted":
        if (evt.data.id) await this.orgs.deleteOrg(evt.data.id);
        break;

      case "organizationMembership.created":
      case "organizationMembership.updated": {
        const orgId = evt.data.organization.id;
        const userId = evt.data.public_user_data.user_id;
        // FK target must exist before the membership row.
        await this.users.sync(userId);
        await this.orgs.upsertMembership(orgId, userId, evt.data.role);
        break;
      }

      case "organizationMembership.deleted": {
        const orgId = evt.data.organization.id;
        const userId = evt.data.public_user_data.user_id;
        await this.orgs.deleteMembership(orgId, userId);
        break;
      }

      default:
        // Ignore the many event types we don't mirror.
        break;
    }
  }
}
