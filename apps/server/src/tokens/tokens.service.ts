import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

/** Prefix that marks a bearer token as a Forward PAT (vs. a Clerk session JWT). */
export const PAT_PREFIX = "fwd_pat_";

/** Default lifetime when the caller doesn't choose one. */
export const DEFAULT_TOKEN_TTL_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Resolve a TTL (in days) to an absolute expiry. Every token must expire. */
function expiryFromDays(days: number): Date {
  return new Date(Date.now() + days * MS_PER_DAY);
}

/** Hash a plaintext token the one way we ever store/compare it. */
function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Personal Access Tokens — the long-lived credential headless surfaces (the VS
 * Code extension, CLIs) use in place of a short-lived Clerk session JWT. The
 * plaintext is generated here, shown to the caller exactly once, and never
 * stored: only its sha256 hash lives in the database. ClerkAuthGuard resolves a
 * `fwd_pat_` bearer back to a user via {@link verify}, so a PAT carries exactly
 * its owner's access — no elevated powers.
 */
@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mint a token for a user. Returns the **plaintext once** (the only time it is
   * ever available) plus the stored metadata for immediate display. `expiresInDays`
   * defaults to 90; every token expires — there is no never-expires option.
   */
  async create(
    userId: string,
    name: string,
    expiresInDays: number = DEFAULT_TOKEN_TTL_DAYS,
  ) {
    const plaintext = PAT_PREFIX + randomBytes(32).toString("base64url");
    const row = await this.prisma.apiToken.create({
      data: {
        userId,
        name,
        tokenHash: hashToken(plaintext),
        // Enough to recognise a token in a list without revealing it.
        prefix: plaintext.slice(0, PAT_PREFIX.length + 4),
        expiresAt: expiryFromDays(expiresInDays),
      },
      select: { id: true, name: true, prefix: true, expiresAt: true, createdAt: true },
    });
    return { ...row, token: plaintext };
  }

  /**
   * Rotate a token: revoke the existing one and mint a fresh replacement under
   * the same name. Returns the new token's plaintext (shown once). The old token
   * stops working immediately, so a leaked credential can be cycled in one step.
   */
  async rotate(
    userId: string,
    id: string,
    expiresInDays: number = DEFAULT_TOKEN_TTL_DAYS,
  ) {
    const existing = await this.prisma.apiToken.findFirst({
      where: { id, userId, revokedAt: null },
      select: { name: true },
    });
    if (!existing) throw new NotFoundException("Token not found");
    await this.prisma.apiToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return this.create(userId, existing.name, expiresInDays);
  }

  /** A user's tokens, newest first. Never exposes the hash. */
  list(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  /** Revoke (soft-delete) one of the caller's tokens. */
  async revoke(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException("Token not found");
  }

  /**
   * Resolve a plaintext PAT to its owner's user id, or null if it is unknown,
   * revoked, or expired. Bumps `lastUsedAt` fire-and-forget so the auth path
   * stays fast and a tracking write never fails a request.
   */
  async verify(plaintext: string): Promise<string | null> {
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(plaintext) },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    void this.prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row.userId;
  }
}
