import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

/**
 * The Platform Admin tier. PlatformAdminGuard and AdminAuditService come from the
 * global CommonModule; this module only registers the control-plane routes.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
