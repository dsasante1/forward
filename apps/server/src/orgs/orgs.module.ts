import { Module } from "@nestjs/common";
import { OrgsController } from "./orgs.controller.js";
import { OrgsService } from "./orgs.service.js";

/**
 * The Org Admin tier. Its cross-cutting collaborators (OrgAdminGuard,
 * AdminAuditService, ClerkUserService) come from the global CommonModule.
 */
@Module({
  controllers: [OrgsController],
  providers: [OrgsService],
})
export class OrgsModule {}
