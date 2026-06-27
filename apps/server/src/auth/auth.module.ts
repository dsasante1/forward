import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { TokensModule } from "../tokens/tokens.module.js";
import { ClerkAuthGuard } from "./clerk-auth.guard.js";

/**
 * Registers ClerkAuthGuard as a global guard, so every route requires a verified
 * Clerk session (or a valid PAT) unless explicitly marked `@Public()`.
 * (Project-scoped routes layer MembershipGuard on top for tenancy — see
 * common/membership.guard.ts.) Imports TokensModule so the guard can resolve PATs.
 */
@Module({
  imports: [TokensModule],
  providers: [{ provide: APP_GUARD, useClass: ClerkAuthGuard }],
})
export class AuthModule {}
