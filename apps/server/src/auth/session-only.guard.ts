import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { AuthUser } from "./current-user.decorator.js";

/**
 * Require a real signed-in Clerk session, not a PAT. A PAT fully represents its
 * owner, so this is not a privilege boundary — it enforces the deliberate rule
 * that credential management (minting/rotating tokens) needs interactive sign-in.
 * The Clerk path sets `sessionId` on `req.user` (clerk-auth.guard.ts); the PAT
 * path never does, so a missing `sessionId` means the caller authenticated with
 * a token.
 */
@Injectable()
export class SessionOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user?.sessionId) {
      throw new ForbiddenException(
        "A signed-in session is required to manage tokens (a PAT cannot).",
      );
    }
    return true;
  }
}
