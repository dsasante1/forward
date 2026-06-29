import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthUser } from "../auth/current-user.decorator.js";

/**
 * The gate for the Platform Admin portal (`/admin/*`) — the cross-tenant API
 * Forward staff use to operate the hosted product. This is the ONE place the
 * "no client carries admin powers" rule in clerk-auth.guard.ts is deliberately
 * relaxed: it admits only users whose `User.isPlatformAdmin` is true (granted by
 * another platform admin, never self-service). It does NOT consult the per-project
 * MembershipGuard or per-org OrgAdminGuard — a platform admin is above tenancy.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthUser }>();
    if (!req.user) throw new ForbiddenException("Unauthenticated");

    const row = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPlatformAdmin: true },
    });
    if (!row?.isPlatformAdmin) {
      throw new ForbiddenException("Platform admin access required");
    }
    return true;
  }
}
