import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The guard imports verifyToken at module load; stub it (these tests only use the
// PAT path, which never touches Clerk, but the import must still resolve).
vi.mock("@clerk/backend", () => ({
  verifyToken: async () => ({ sub: "unused", sid: "unused" }),
}));
import { ClerkAuthGuard } from "./clerk-auth.guard.js";
import { PAT_PREFIX } from "../tokens/tokens.service.js";

const INTERVAL_MS = 60_000;
// A large, realistic base epoch: the "last write" for an unseen user defaults to
// 0, so the throttle only fires (and the map only fills) when `now` is already
// well past the interval — starting the fake clock near 0 would skip every write.
const BASE = 1_700_000_000_000;

function ctx(userId: string) {
  const req = { headers: { authorization: `Bearer ${PAT_PREFIX}${userId}` }, user: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
}

function makeGuard() {
  const reflector = { getAllAndOverride: () => undefined } as never;
  // The PAT decodes straight to its owner id (fwd_pat_<uid>) so each request can
  // be a distinct user without a real token store.
  const tokens = { verify: async (t: string) => t.slice(PAT_PREFIX.length) } as never;
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    user: { findUnique: async () => ({ suspendedAt: null }), updateMany },
  } as never;
  const config = { getOrThrow: () => "sk_test", get: () => undefined } as never;
  const guard = new ClerkAuthGuard(reflector, tokens, prisma, config);
  // The dedupe map is a TS-private field; reach it at runtime to assert the bound.
  const map = (guard as unknown as { lastSeenWrites: Map<string, number> })
    .lastSeenWrites;
  return { guard, map, updateMany };
}

describe("ClerkAuthGuard lastSeen map is bounded (L-3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps entries for users seen within the interval", async () => {
    const { guard, map } = makeGuard();
    vi.setSystemTime(BASE);
    await guard.canActivate(ctx("user_a"));
    vi.setSystemTime(BASE + INTERVAL_MS / 2); // still inside the window
    await guard.canActivate(ctx("user_b"));
    // A's entry is younger than the interval, so the prune before B's insert
    // retains it: the map holds every *recently active* user, not just the last.
    expect([...map.keys()].sort()).toEqual(["user_a", "user_b"]);
  });

  it("evicts entries older than the interval on the next write (no unbounded growth)", async () => {
    const { guard, map } = makeGuard();
    vi.setSystemTime(BASE);
    await guard.canActivate(ctx("user_a"));
    await guard.canActivate(ctx("user_b"));
    expect(map.size).toBe(2);

    // A minute later a single new user arrives; the prune drops both stale
    // entries before inserting, so the map tracks the live set, not all history.
    vi.setSystemTime(BASE + INTERVAL_MS + 1);
    await guard.canActivate(ctx("user_c"));
    expect([...map.keys()]).toEqual(["user_c"]);
  });

  it("throttles repeat writes for the same user to one per interval", async () => {
    const { guard, updateMany } = makeGuard();
    vi.setSystemTime(BASE);
    await guard.canActivate(ctx("user_a"));
    await guard.canActivate(ctx("user_a")); // within the interval → suppressed
    expect(updateMany).toHaveBeenCalledTimes(1);

    vi.setSystemTime(BASE + INTERVAL_MS + 1); // interval elapsed → writes again
    await guard.canActivate(ctx("user_a"));
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
