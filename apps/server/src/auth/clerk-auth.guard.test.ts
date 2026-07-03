import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

// The Clerk-session path calls verifyToken(). We route it through a plain,
// per-test-controllable function rather than a vi.fn spy: a vi.fn that throws or
// returns a rejection is recorded by Vitest's unhandled-error tracker and fails
// the file even though the guard catches it. A plain async fn the guard awaits
// has no such tracker, so we can exercise the failure path cleanly.
let clerkVerify: (token: string, opts: unknown) => Promise<{ sub: string; sid: string }>;
vi.mock("@clerk/backend", () => ({
  verifyToken: (token: string, opts: unknown) => clerkVerify(token, opts),
}));
import { ClerkAuthGuard } from "./clerk-auth.guard.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

function ctx(headers: Record<string, string>, isPublic = false) {
  const req = { headers, user: undefined as unknown };
  const reflector = {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined),
  };
  return {
    req,
    reflector,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as never,
  };
}

const config = { getOrThrow: () => "sk_test", get: () => undefined } as never;

function makeGuard(opts: { reflector: unknown; patUserId?: string | null; suspended?: boolean }) {
  const tokens = { verify: async () => opts.patUserId ?? null } as never;
  const prisma = {
    user: {
      findUnique: async () => (opts.suspended ? { suspendedAt: new Date() } : { suspendedAt: null }),
      updateMany: async () => ({ count: 0 }),
    },
  } as never;
  return new ClerkAuthGuard(opts.reflector as never, tokens, prisma, config);
}

describe("ClerkAuthGuard", () => {
  beforeEach(() => {
    clerkVerify = async () => ({ sub: "user_default", sid: "sess_default" });
  });

  it("allows a @Public route with no token", async () => {
    const { ctx: c, reflector } = ctx({}, true);
    await expect(makeGuard({ reflector }).canActivate(c)).resolves.toBe(true);
  });

  it("rejects a missing bearer token", async () => {
    const { ctx: c, reflector } = ctx({});
    await expect(makeGuard({ reflector }).canActivate(c)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("resolves a valid PAT to its owner without touching Clerk", async () => {
    let clerkCalled = false;
    clerkVerify = async () => {
      clerkCalled = true;
      return { sub: "x", sid: "y" };
    };
    const { ctx: c, reflector, req } = ctx({ authorization: "Bearer fwd_pat_abc" });
    await expect(makeGuard({ reflector, patUserId: "user_9" }).canActivate(c)).resolves.toBe(true);
    // Exactly {id} (no sessionId) proves the PAT branch, not the Clerk branch.
    expect(req.user).toEqual({ id: "user_9" });
    expect(clerkCalled).toBe(false);
  });

  it("rejects an invalid/revoked PAT", async () => {
    const { ctx: c, reflector } = ctx({ authorization: "Bearer fwd_pat_bad" });
    await expect(
      makeGuard({ reflector, patUserId: null }).canActivate(c),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("denies a suspended account holding a valid PAT", async () => {
    const { ctx: c, reflector } = ctx({ authorization: "Bearer fwd_pat_abc" });
    await expect(
      makeGuard({ reflector, patUserId: "user_9", suspended: true }).canActivate(c),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("accepts a valid Clerk session token and attaches the principal", async () => {
    clerkVerify = async () => ({ sub: "user_5", sid: "sess_1" });
    const { ctx: c, reflector, req } = ctx({ authorization: "Bearer clerk.jwt.token" });
    await expect(makeGuard({ reflector }).canActivate(c)).resolves.toBe(true);
    expect((req.user as { id: string; sessionId: string }).id).toBe("user_5");
    expect((req.user as { sessionId: string }).sessionId).toBe("sess_1");
  });

  it("normalizes a Clerk verification failure to a 401 (never the raw error)", async () => {
    clerkVerify = async () => {
      throw new Error("bad jwt");
    };
    const { ctx: c, reflector } = ctx({ authorization: "Bearer clerk.jwt.bad" });
    await expect(makeGuard({ reflector }).canActivate(c)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
