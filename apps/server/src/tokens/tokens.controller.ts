import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { SessionOnlyGuard } from "../auth/session-only.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { TokensService } from "./tokens.service.js";

// `expiresInDays`: omit for the 90-day default, otherwise 1–730 days. Bounded so
// a typo can't mint a century-long key; every token MUST expire (no never-expires
// option — that's the whole point of an expiry).
const ExpiresInDays = z.number().int().positive().max(730).optional();

const CreateToken = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: ExpiresInDays,
});

const RotateToken = z.object({
  expiresInDays: ExpiresInDays,
});

/**
 * Account-level Personal Access Token management. These routes carry no
 * `:projectId`, so only the global ClerkAuthGuard applies — plus SessionOnlyGuard,
 * which enforces that the caller signed in with a real Clerk session: a PAT can
 * mint nothing, so a leaked token can't be used to bootstrap fresh credentials.
 * Every action is scoped to the caller.
 */
@Controller("tokens")
@UseGuards(SessionOnlyGuard)
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tokens.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(CreateToken)) body: z.infer<typeof CreateToken>,
  ) {
    return this.tokens.create(user.id, body.name, body.expiresInDays);
  }

  /** Revoke a token and mint a replacement under the same name (returns plaintext). */
  @Post(":id/rotate")
  rotate(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodBody(RotateToken)) body: z.infer<typeof RotateToken>,
  ) {
    return this.tokens.rotate(user.id, id, body.expiresInDays);
  }

  @Delete(":id")
  async revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.tokens.revoke(user.id, id);
    return { ok: true };
  }
}
