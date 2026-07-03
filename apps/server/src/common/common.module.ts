import { Global, Module } from "@nestjs/common";
import { ClerkUserService } from "./clerk-user.service.js";
import { CloudTasksService } from "./cloud-tasks.service.js";
import { EmailService } from "./email.service.js";
import { MembershipGuard } from "./membership.guard.js";
import { OrgAdminGuard } from "./org-admin.guard.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";
import { AdminAuditService } from "./admin-audit.service.js";
import { OrgSyncService } from "./org-sync.service.js";
import { RealtimeService } from "./realtime.service.js";

/**
 * Cross-cutting providers used by every feature module: the tenancy guards, the
 * realtime bus, outbound email, the Clerk profile/org mirrors and the admin audit
 * trail. Global so feature modules inject them without re-importing.
 */
@Global()
@Module({
  providers: [
    MembershipGuard,
    OrgAdminGuard,
    PlatformAdminGuard,
    RealtimeService,
    EmailService,
    CloudTasksService,
    ClerkUserService,
    OrgSyncService,
    AdminAuditService,
  ],
  exports: [
    MembershipGuard,
    OrgAdminGuard,
    PlatformAdminGuard,
    RealtimeService,
    EmailService,
    CloudTasksService,
    ClerkUserService,
    OrgSyncService,
    AdminAuditService,
  ],
})
export class CommonModule {}
