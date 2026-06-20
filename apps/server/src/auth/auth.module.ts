import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ClerkAuthGuard } from "./clerk-auth.guard.js";

/**
 * Registers ClerkAuthGuard as a global guard, so every route requires a verified
 * Clerk session unless explicitly marked `@Public()`. (Project-scoped routes layer
 * MembershipGuard on top for tenancy — see common/membership.guard.ts.)
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: ClerkAuthGuard }],
})
export class AuthModule {}
