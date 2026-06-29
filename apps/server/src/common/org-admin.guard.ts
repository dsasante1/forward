import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthUser } from "../auth/current-user.decorator.js";

/** The org context a handler can read off the request after this guard passes. */
export interface OrgContext {
  orgId: string;
}

/**
 * Tenancy guard for the Org Admin portal (`/orgs/:orgId/*`). The caller must be
 * an `admin` of the org, decided against the locally-mirrored OrganizationMember
 * roster (kept in step with Clerk by the webhook) rather than the session claim
 * alone — so the check is authoritative even on a stale/missing `org_role` claim
 * and on PAT callers that carry no org context. Platform admins pass through.
 *
 * The route MUST expose the org via an `:orgId` path param.
 */
@Injectable()
export class OrgAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      params: Record<string, string>;
      user?: AuthUser;
      org?: OrgContext;
    }>();

    const orgId = req.params["orgId"];
    if (!orgId) throw new NotFoundException("Missing orgId");
    if (!req.user) throw new ForbiddenException("Unauthenticated");

    const platform = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPlatformAdmin: true },
    });
    if (!platform?.isPlatformAdmin) {
      const member = await this.prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: req.user.id } },
        select: { role: true },
      });
      if (!member || member.role !== "admin") {
        // Don't reveal whether the org exists — just deny.
        throw new ForbiddenException("Organization admin role required");
      }
    }

    req.org = { orgId };
    return true;
  }
}
