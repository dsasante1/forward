import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { verifyToken } from "@clerk/backend";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import type { AuthUser } from "./current-user.decorator.js";

/**
 * Verifies the per-user Clerk session token on every request and attaches the
 * principal to `req.user`. This is the heart of the closed-source pivot: the old
 * extension carried a Firebase admin secret that bypassed all rules
 * (firebase.rules.json:3) — that god-token is gone. Every surface now sends a
 * short-lived, user-scoped bearer token, verified here, with no admin powers.
 *
 * The token is read from the `Authorization: Bearer` header only — never a query
 * string (the old client appended `?auth=`, which leaks into logs/proxies).
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);
  private readonly secretKey: string;
  private readonly authorizedParties?: string[];

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.secretKey = config.getOrThrow<string>("CLERK_SECRET_KEY");
    const parties = config.get<string>("CLERK_AUTHORIZED_PARTIES");
    this.authorizedParties = parties
      ? parties.split(",").map((p) => p.trim()).filter(Boolean)
      : undefined;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const token = bearer(req.headers["authorization"]);
    if (!token) throw new UnauthorizedException("Missing bearer token");

    try {
      const claims = await verifyToken(token, {
        secretKey: this.secretKey,
        ...(this.authorizedParties
          ? { authorizedParties: this.authorizedParties }
          : {}),
      });
      req.user = { id: claims.sub, sessionId: claims.sid };
      return true;
    } catch (err) {
      this.logger.debug(`Token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException("Invalid or expired session token");
    }
  }
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}
