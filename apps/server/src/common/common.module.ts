import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service.js";
import { MembershipGuard } from "./membership.guard.js";
import { RealtimeService } from "./realtime.service.js";

/**
 * Cross-cutting providers used by every feature module: the tenancy guard, the
 * realtime bus and outbound email. Global so feature modules inject them without
 * re-importing.
 */
@Global()
@Module({
  providers: [MembershipGuard, RealtimeService, EmailService],
  exports: [MembershipGuard, RealtimeService, EmailService],
})
export class CommonModule {}
