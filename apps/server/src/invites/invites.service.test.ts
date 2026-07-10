import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpException, HttpStatus } from "@nestjs/common";

// The service constructs a Clerk client at build time; stub it so no real key /
// network is needed. The invite-abuse fixes under test (H-1) never touch Clerk.
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({}),
}));
import { InvitesService } from "./invites.service.js";

const RESEND_COOLDOWN_MS = 60_000;
const MAX_PENDING_INVITES = 100;
const PROJECT = "project_xyz";
const EMAIL = "victim@example.com";

/** Build the service over a fake Prisma whose invite reads we control per test. */
function makeService(over: {
  recentCreatedAt?: Date | null;
  pending?: number;
}) {
  const invite = {
    findFirst: vi.fn(async () =>
      over.recentCreatedAt ? { createdAt: over.recentCreatedAt } : null,
    ),
    count: vi.fn(async () => over.pending ?? 0),
    updateMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async () => ({
      id: "inv_1",
      email: EMAIL,
      role: "editor",
      status: "pending",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      expiresAt: new Date("2026-07-17T00:00:00.000Z"),
    })),
  };
  const prisma = {
    invite,
    project: { findUnique: vi.fn(async () => ({ name: "Acme" })) },
  } as never;
  const queue = { enqueueEmail: vi.fn(async () => undefined), canDeliver: true } as never;
  const realtime = { publish: vi.fn(async () => undefined) } as never;
  const users = {} as never;
  const config = {
    getOrThrow: () => "sk_test",
    get: () => undefined,
  } as never;
  const svc = new InvitesService(prisma, queue, realtime, users, config);
  return { svc, invite };
}

describe("InvitesService.create abuse guards (H-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a re-send inside the per-recipient cooldown (429) before doing anything else", async () => {
    const { svc, invite } = makeService({ recentCreatedAt: new Date() });
    const err = await svc
      .create(PROJECT, EMAIL, "editor", "user_owner")
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    // Short-circuits: never counts pending, never writes an invite row / email.
    expect(invite.count).not.toHaveBeenCalled();
    expect(invite.create).not.toHaveBeenCalled();
  });

  it("allows a re-send once the cooldown has elapsed", async () => {
    const stale = new Date(Date.now() - RESEND_COOLDOWN_MS - 1_000);
    const { svc, invite } = makeService({ recentCreatedAt: stale, pending: 0 });
    const res = await svc.create(PROJECT, EMAIL, "editor", "user_owner");
    expect(invite.create).toHaveBeenCalledTimes(1);
    expect(res.email).toBe(EMAIL);
  });

  it("rejects when the project is already at the pending-invite ceiling (429)", async () => {
    const { svc, invite } = makeService({ pending: MAX_PENDING_INVITES });
    const err = await svc
      .create(PROJECT, EMAIL, "editor", "user_owner")
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(invite.create).not.toHaveBeenCalled();
  });

  it("normalizes the recipient before the cooldown lookup (case/whitespace can't bypass it)", async () => {
    const { svc, invite } = makeService({ pending: 0 });
    await svc.create(PROJECT, "  VICTIM@Example.com ", "editor", "user_owner");
    expect(invite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT, email: EMAIL },
      }),
    );
  });

  it("creates and arranges delivery on the clean path (no recent invite, under the cap)", async () => {
    const { svc, invite } = makeService({ pending: 3 });
    const res = await svc.create(PROJECT, EMAIL, "editor", "user_owner");
    expect(invite.create).toHaveBeenCalledTimes(1);
    expect(res.emailSent).toBe(true);
  });
});
