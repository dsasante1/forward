import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { verifyToken } from "@clerk/backend";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import type { AuthUser } from "./current-user.decorator.js";
import { PAT_PREFIX, TokensService } from "../tokens/tokens.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Authenticates every request and attaches the principal to `req.user`. This is
 * the heart of the closed-source pivot: the old extension carried a Firebase
 * admin secret that bypassed all rules (firebase.rules.json:3) — that god-token
 * is gone. Two user-scoped credentials are accepted, both with no admin powers:
 *
 *   - a short-lived Clerk session JWT (browsers: dashboard + embedded canvas), and
 *   - a long-lived Personal Access Token, `fwd_pat_…` (headless: the VS Code
 *     extension / CLIs), resolved to its owner via TokensService.
 *
 * Either way the result is a plain `{ id }` principal, so MembershipGuard and the
 * role checks downstream are identical for both. The token is read from the
 * `Authorization: Bearer` header only — never a query string (the old client
 * appended `?auth=`, which leaks into logs/proxies).
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);
  private readonly secretKey: string;
  private readonly authorizedParties?: string[];
  /** Per-user timestamp of the last `lastSeenAt` write from this instance. */
  private readonly lastSeenWrites = new Map<string, number>();
  private static readonly LAST_SEEN_INTERVAL_MS = 60_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
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

    // A Personal Access Token resolves to its owner without touching Clerk.
    if (token.startsWith(PAT_PREFIX)) {
      const userId = await this.tokens.verify(token);
      if (!userId) throw new UnauthorizedException("Invalid or revoked token");
      await this.assertNotSuspended(userId);
      req.user = { id: userId };
      return true;
    }

    try {
      const claims = await verifyToken(token, {
        secretKey: this.secretKey,
        ...(this.authorizedParties
          ? { authorizedParties: this.authorizedParties }
          : {}),
      });
      // Clerk adds the active-org claims when an organization is selected on the
      // session; they are absent for a personal (no-org) session.
      const c = claims as typeof claims & { org_id?: string; org_role?: string };
      await this.assertNotSuspended(claims.sub);
      req.user = {
        id: claims.sub,
        sessionId: claims.sid,
        ...(c.org_id ? { orgId: c.org_id } : {}),
        ...(c.org_role ? { orgRole: c.org_role } : {}),
      };
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.debug(`Token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException("Invalid or expired session token");
    }
  }

  /**
   * Reject a suspended account at the single auth chokepoint. A brand-new user
   * has no `User` row yet (it is created lazily on first project touch), so a
   * missing row is allowed — only an existing, flagged row is denied.
   */
  private async assertNotSuspended(userId: string): Promise<void> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { suspendedAt: true },
    });
    if (row?.suspendedAt) {
      throw new ForbiddenException("Account suspended");
    }
    // Stamp "last seen" fire-and-forget (no row for brand-new users yet → no-op).
    // updateMany never throws on zero matches, and we never await it, so this
    // tracking write can't slow or fail a request. Throttled to once a minute
    // per user: it's presence data, and un-throttled every request UPDATEs the
    // same User row — parallel requests from one user then serialize on the row
    // lock while each holds a pooled connection (see the 2026-07-02 outage).
    const now = Date.now();
    const lastWrite = this.lastSeenWrites.get(userId) ?? 0;
    if (now - lastWrite < ClerkAuthGuard.LAST_SEEN_INTERVAL_MS) return;
    // Keep the dedupe map bounded: an entry older than the interval has already
    // served its purpose (the throttle window has elapsed), so drop stale entries
    // before inserting. Without this the map grows one entry per distinct user
    // for the life of the instance.
    this.pruneLastSeen(now);
    this.lastSeenWrites.set(userId, now); // set eagerly to dedupe parallel requests
    void this.prisma.user
      .updateMany({ where: { id: userId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  /**
   * Evict `lastSeenWrites` entries older than the throttle interval, so the map
   * stays proportional to *recently active* users rather than growing forever.
   * An evicted user simply gets a fresh `lastSeenAt` write on their next request,
   * which is harmless (it's presence data). O(n) but only over the live set.
   */
  private pruneLastSeen(now: number): void {
    for (const [id, ts] of this.lastSeenWrites) {
      if (now - ts >= ClerkAuthGuard.LAST_SEEN_INTERVAL_MS) {
        this.lastSeenWrites.delete(id);
      }
    }
  }
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}
