import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClerkClient, type ClerkClient } from "@clerk/backend";
import type { OrgRole } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Keeps the local `Organization` / `OrganizationMember` mirror in step with Clerk
 * Organizations (the source of truth). The webhook (webhooks.controller.ts) calls
 * the upsert/delete methods on org + membership events; project creation calls the
 * lazy `ensureOrg` / `ensureMembership` so the FK target exists even before the
 * first webhook lands. Mirrors the ClerkUserService pattern for users.
 */
@Injectable()
export class OrgSyncService {
  private readonly logger = new Logger(OrgSyncService.name);
  private readonly clerk: ClerkClient;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.clerk = createClerkClient({
      secretKey: config.getOrThrow<string>("CLERK_SECRET_KEY"),
    });
  }

  /** Create/update the local org row from known fields (e.g. a webhook payload). */
  async upsertOrg(input: {
    id: string;
    name: string;
    slug?: string | null;
    imageUrl?: string | null;
  }): Promise<void> {
    const data = {
      name: input.name,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
    };
    await this.prisma.organization.upsert({
      where: { id: input.id },
      update: data,
      create: { id: input.id, ...data },
    });
  }

  /** Remove the local org row (projects detach via onDelete: SetNull). */
  async deleteOrg(orgId: string): Promise<void> {
    await this.prisma.organization
      .delete({ where: { id: orgId } })
      .catch(() => undefined);
  }

  /** Create/update a membership mirror row, mapping the Clerk role string. */
  async upsertMembership(
    orgId: string,
    userId: string,
    clerkRole: string,
  ): Promise<void> {
    const role = mapRole(clerkRole);
    await this.prisma.organizationMember.upsert({
      where: { orgId_userId: { orgId, userId } },
      update: { role },
      create: { orgId, userId, role },
    });
  }

  /** Remove a membership mirror row. */
  async deleteMembership(orgId: string, userId: string): Promise<void> {
    await this.prisma.organizationMember
      .delete({ where: { orgId_userId: { orgId, userId } } })
      .catch(() => undefined);
  }

  /**
   * Ensure the local org row exists, fetching from Clerk if we have not mirrored
   * it yet. Called when filing a new project under the caller's active org so the
   * `Project.organizationId` FK resolves. Best-effort: logs and returns on
   * failure rather than blocking project creation.
   */
  async ensureOrg(orgId: string): Promise<void> {
    const existing = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (existing) return;
    try {
      const org = await this.clerk.organizations.getOrganization({
        organizationId: orgId,
      });
      await this.upsertOrg({
        id: org.id,
        name: org.name,
        slug: org.slug,
        imageUrl: org.imageUrl,
      });
    } catch (err) {
      this.logger.warn(
        `Clerk org lookup failed for ${orgId}: ${(err as Error).message}`,
      );
    }
  }

  /** Ensure a membership mirror row exists for a known (orgId, userId, role). */
  async ensureMembership(
    orgId: string,
    userId: string,
    clerkRole: string,
  ): Promise<void> {
    await this.upsertMembership(orgId, userId, clerkRole);
  }
}

/** Map a Clerk org role string (e.g. "org:admin") to our two-value OrgRole. */
function mapRole(clerkRole: string): OrgRole {
  return clerkRole.toLowerCase().includes("admin") ? "admin" : "member";
}
