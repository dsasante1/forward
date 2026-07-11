import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ProjectRole } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthUser } from "../auth/current-user.decorator.js";

export const REQUIRE_OWNER_KEY = "requireOwner";
/** Mark a route as owner-only (e.g. managing the member roster, deleting a project). */
export const RequireOwner = () => SetMetadata(REQUIRE_OWNER_KEY, true);

export const REQUIRE_WRITE_KEY = "requireWrite";
/**
 * Force the write-permission check on a route regardless of its HTTP method —
 * the explicit, declared form of "viewers may not call this". By default write
 * is inferred from the verb (anything but GET/HEAD/OPTIONS is a write); use this
 * for the rare GET that has side effects so a `viewer` is still denied.
 */
export const RequireWrite = () => SetMetadata(REQUIRE_WRITE_KEY, true);

export interface Membership {
  projectId: string;
  role: ProjectRole;
}

/** HTTP methods that only read — a `viewer` may call these, but nothing else. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Enforces per-project tenancy on every project-scoped route with a server-side
 * check:
 * the authenticated user must be on the project's roster, and `@RequireOwner()`
 * routes additionally require the `owner` role. Attaches the resolved membership
 * to `req.membership` for handlers that need the role.
 *
 * The route MUST expose the project via a `:projectId` path param.
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      params: Record<string, string>;
      method: string;
      user?: AuthUser;
      membership?: Membership;
    }>();

    const projectId = req.params["projectId"];
    if (!projectId) throw new NotFoundException("Missing projectId");
    if (!req.user) throw new ForbiddenException("Unauthenticated");

    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId, userId: req.user.id },
      },
      select: {
        role: true,
        project: {
          select: { organization: { select: { suspendedAt: true } } },
        },
      },
    });
    if (!member) {
      // Do not reveal whether the project exists — just deny.
      throw new ForbiddenException("Not a member of this project");
    }
    // A suspended org freezes all access to its projects (set from the platform
    // admin portal); members are denied until it is restored.
    if (member.project.organization?.suspendedAt) {
      throw new ForbiddenException("Organization suspended");
    }

    const requireOwner = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_OWNER_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (requireOwner) {
      if (member.role !== "owner") {
        throw new ForbiddenException("Owner role required");
      }
    } else {
      // A write is anything but a read method, OR an explicit @RequireWrite route.
      const requireWrite = this.reflector.getAllAndOverride<boolean>(
        REQUIRE_WRITE_KEY,
        [ctx.getHandler(), ctx.getClass()],
      );
      const isWrite = requireWrite || !READ_METHODS.has(req.method);
      if (isWrite && member.role === "viewer") {
        throw new ForbiddenException(
          "Read-only access: an editor or owner role is required to make changes",
        );
      }
    }

    req.membership = { projectId, role: member.role };
    return true;
  }
}
