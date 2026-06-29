import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller.js";

/**
 * The Clerk webhook sink. Its collaborators (ClerkUserService, OrgSyncService)
 * are provided globally by CommonModule, so this module only registers the route.
 */
@Module({
  controllers: [WebhooksController],
})
export class WebhooksModule {}
