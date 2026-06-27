import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClerkClient, type ClerkClient, type User } from "@clerk/backend";
import { PrismaService } from "../prisma/prisma.service.js";

/** A user's display profile, mirrored from Clerk into our `User` row. */
export interface ClerkProfile {
  email: string | null;
  name: string | null;
  imageUrl: string | null;
}

/**
 * Keeps our `User` rows in step with Clerk so the member roster can show a
 * person (name + avatar + email) instead of a raw `user_...` id. The id is all
 * we get from a verified session token; the profile lives in Clerk, so we fetch
 * it here and cache it locally on every authenticated touch.
 */
@Injectable()
export class ClerkUserService {
  private readonly logger = new Logger(ClerkUserService.name);
  private readonly clerk: ClerkClient;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.clerk = createClerkClient({
      secretKey: config.getOrThrow<string>("CLERK_SECRET_KEY"),
    });
  }

  /**
   * Ensure a `User` row exists for `userId`, enriched with the latest Clerk
   * profile. Safe to call on every request: if Clerk is unreachable the row is
   * still created/kept (FK target must exist) with whatever profile we have.
   * `preferEmail` pins the email (e.g. the specific verified address an invite
   * was sent to) instead of Clerk's primary.
   */
  async sync(userId: string, preferEmail?: string): Promise<void> {
    const profile = await this.fetchProfile(userId);
    const email = preferEmail ?? profile?.email ?? undefined;
    const data = {
      ...(email ? { email } : {}),
      ...(profile?.name ? { name: profile.name } : {}),
      ...(profile?.imageUrl ? { imageUrl: profile.imageUrl } : {}),
    };
    await this.prisma.user.upsert({
      where: { id: userId },
      update: data,
      create: { id: userId, ...data },
    });
  }

  /** The user's Clerk profile, or null if Clerk can't be reached. */
  async fetchProfile(userId: string): Promise<ClerkProfile | null> {
    try {
      return toProfile(await this.clerk.users.getUser(userId));
    } catch (err) {
      this.logger.warn(
        `Clerk profile lookup failed for ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

/** Map a Clerk user to the subset we mirror locally. */
function toProfile(user: User): ClerkProfile {
  const primary = user.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId,
  )?.emailAddress;
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    null;
  return {
    email: primary ?? user.emailAddresses[0]?.emailAddress ?? null,
    name,
    imageUrl: user.imageUrl || null,
  };
}
