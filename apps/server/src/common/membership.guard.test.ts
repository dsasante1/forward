import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  MembershipGuard,
  REQUIRE_OWNER_KEY,
  REQUIRE_WRITE_KEY,
} from "./membership.guard.js";

/**
 * The RBAC decision table for every project-scoped route. This guard is the
 * tenancy boundary — a wrong branch here is a cross-tenant breach — so it is
 * pinned by unit tests even though the rest of the server is exercised e2e.
 */

type Org = { suspendedAt: Date | null } | null;
type Member = { role: "viewer" | "editor" | "owner"; project: { organization: Org } } | null;

const member = (role: "viewer" | "editor" | "owner", suspendedAt: Date | null = null): Member => ({
  role,
  project: { organization: { suspendedAt } },
});

function ctx(opts: { method?: string; projectId?: string | undefined; user?: { id: string } }) {
  const req = {
    params: "projectId" in opts ? { projectId: opts.projectId } : { projectId: "proj_1" },
    method: opts.method ?? "GET",
    user: "user" in opts ? opts.user : { id: "user_1" },
    membership: undefined as unknown,
  };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as never,
  };
}

const reflector = (meta: Partial<Record<string, boolean>> = {}) =>
  ({ getAllAndOverride: (key: string) => meta[key] }) as never;

const prisma = (m: Member) => ({ projectMember: { findUnique: async () => m } }) as never;

const guard = (m: Member, meta: Partial<Record<string, boolean>> = {}) =>
  new MembershipGuard(prisma(m), reflector(meta));

describe("MembershipGuard", () => {
  it("404s when the route has no :projectId", async () => {
    const { ctx: c } = ctx({ projectId: undefined });
    await expect(guard(member("owner")).canActivate(c)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("denies an unauthenticated request", async () => {
    const { ctx: c } = ctx({ user: undefined });
    await expect(guard(member("owner")).canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies a non-member (without revealing the project exists)", async () => {
    const { ctx: c } = ctx({});
    await expect(guard(null).canActivate(c)).rejects.toThrow(/Not a member/);
  });

  it("denies every member of a suspended organization", async () => {
    const { ctx: c } = ctx({ method: "GET" });
    await expect(
      guard(member("owner", new Date())).canActivate(c),
    ).rejects.toThrow(/suspended/i);
  });

  it("lets a viewer READ", async () => {
    const { ctx: c, req } = ctx({ method: "GET" });
    await expect(guard(member("viewer")).canActivate(c)).resolves.toBe(true);
    expect(req.membership).toEqual({ projectId: "proj_1", role: "viewer" });
  });

  it("denies a viewer WRITE (non-GET method)", async () => {
    const { ctx: c } = ctx({ method: "PUT" });
    await expect(guard(member("viewer")).canActivate(c)).rejects.toThrow(/editor or owner/i);
  });

  it("denies a viewer on a @RequireWrite GET (side-effecting read)", async () => {
    const { ctx: c } = ctx({ method: "GET" });
    await expect(
      guard(member("viewer"), { [REQUIRE_WRITE_KEY]: true }).canActivate(c),
    ).rejects.toThrow(/editor or owner/i);
  });

  it("lets an editor WRITE", async () => {
    const { ctx: c } = ctx({ method: "PUT" });
    await expect(guard(member("editor")).canActivate(c)).resolves.toBe(true);
  });

  it("denies an editor on an @RequireOwner route", async () => {
    const { ctx: c } = ctx({ method: "DELETE" });
    await expect(
      guard(member("editor"), { [REQUIRE_OWNER_KEY]: true }).canActivate(c),
    ).rejects.toThrow(/Owner role required/);
  });

  it("lets an owner through an @RequireOwner route", async () => {
    const { ctx: c } = ctx({ method: "DELETE" });
    await expect(
      guard(member("owner"), { [REQUIRE_OWNER_KEY]: true }).canActivate(c),
    ).resolves.toBe(true);
  });

  it("does not apply the write check to a POST when @RequireOwner passes for an owner", async () => {
    const { ctx: c, req } = ctx({ method: "POST" });
    await expect(guard(member("owner")).canActivate(c)).resolves.toBe(true);
    expect(req.membership).toEqual({ projectId: "proj_1", role: "owner" });
  });
});
