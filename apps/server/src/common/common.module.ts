import { Global, Module } from "@nestjs/common";
import { ClerkUserService } from "./clerk-user.service.js";
import { EmailService } from "./email.service.js";
import { MembershipGuard } from "./membership.guard.js";
import { RealtimeService } from "./realtime.service.js";

/**
 * Cross-cutting providers used by every feature module: the tenancy guard, the
 * realtime bus, outbound email and the Clerk profile mirror. Global so feature
 * modules inject them without re-importing.
 */
@Global()
@Module({
  providers: [MembershipGuard, RealtimeService, EmailService, ClerkUserService],
  exports: [MembershipGuard, RealtimeService, EmailService, ClerkUserService],
})
export class CommonModule {}
