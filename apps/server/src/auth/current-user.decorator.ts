import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** The authenticated principal, attached to the request by ClerkAuthGuard. */
export interface AuthUser {
  /** Clerk user id (the `sub` claim) — our User.id. */
  id: string;
  /** Session id, if present on the token. */
  sessionId?: string;
  /**
   * The active organization on the session, if any (Clerk `org_id` claim). A PAT
   * carries no org context, so this is undefined for headless callers. Drives
   * which org a created project is filed under and OrgAdminGuard.
   */
  orgId?: string;
  /**
   * The caller's role in the active org (Clerk `org_role` claim, e.g.
   * `org:admin`). Undefined when there is no active org. OrgAdminGuard requires
   * the admin role.
   */
  orgRole?: string;
}

/**
 * Inject the authenticated user into a handler:
 *   `@CurrentUser() user: AuthUser`
 * Guaranteed present on guarded routes (ClerkAuthGuard runs first).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) {
      // Should never happen behind the guard; fail loud rather than leak access.
      throw new Error("CurrentUser used on an unauthenticated route");
    }
    return req.user;
  },
);
