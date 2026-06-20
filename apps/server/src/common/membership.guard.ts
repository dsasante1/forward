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

export interface Membership {
  projectId: string;
  role: ProjectRole;
}

/** HTTP methods that only read — a `viewer` may call these, but nothing else. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Enforces per-project tenancy on every project-scoped route. Replaces the
 * Firebase membership rules (firebase.rules.json) with a server-side check:
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
      select: { role: true },
    });
    if (!member) {
      // Do not reveal whether the project exists — just deny.
      throw new ForbiddenException("Not a member of this project");
    }

    const requireOwner = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_OWNER_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (requireOwner) {
      if (member.role !== "owner") {
        throw new ForbiddenException("Owner role required");
      }
    } else if (!READ_METHODS.has(req.method) && member.role === "viewer") {
      // A viewer is read-only: any mutating method on a non-owner route is denied.
      throw new ForbiddenException(
        "Read-only access: an editor or owner role is required to make changes",
      );
    }

    req.membership = { projectId, role: member.role };
    return true;
  }
}
