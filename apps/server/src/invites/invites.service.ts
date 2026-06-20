import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { randomBytes } from "node:crypto";
import type { ProjectRole } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { EmailService } from "../common/email.service.js";
import { RealtimeService } from "../common/realtime.service.js";

const INVITE_TTL_DAYS = 7;

/**
 * Email-based project invitations — the flow a user expects from a SaaS:
 * an owner invites someone by email; the backend emails a tokenized link; the
 * invitee signs in and accepts, which creates their `ProjectMember` row with the
 * granted role. The link's `token` is a capability, but acceptance additionally
 * verifies the signed-in user's Clerk email matches the invited address, so a
 * forwarded link can't be redeemed by someone else.
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);
  private readonly clerk: ClerkClient;
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly realtime: RealtimeService,
    config: ConfigService,
  ) {
    this.clerk = createClerkClient({
      secretKey: config.getOrThrow<string>("CLERK_SECRET_KEY"),
    });
    this.appBaseUrl = (
      config.get<string>("APP_BASE_URL") ?? "http://localhost:5174"
    ).replace(/\/$/, "");
  }

  /** Pending invitations for a project (the roster view shows these alongside members). */
  async list(projectId: string) {
    const rows = await this.prisma.invite.findMany({
      where: { projectId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    return rows.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
    }));
  }

  /** Create + email an invitation (owner-only — enforced by the route guard). */
  async create(
    projectId: string,
    email: string,
    role: ProjectRole,
    invitedBy: string,
  ) {
    const normalized = email.trim().toLowerCase();
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });

    // Supersede any earlier pending invite for the same email on this project.
    await this.prisma.invite.updateMany({
      where: { projectId, email: normalized, status: "pending" },
      data: { status: "expired" },
    });

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const invite = await this.prisma.invite.create({
      data: { projectId, email: normalized, role, token, invitedBy, expiresAt },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    const sent = await this.sendInviteEmail(
      normalized,
      project?.name ?? "a project",
      role,
      token,
    );
    if (!sent) {
      this.logger.warn(
        `Invite ${invite.id} created but the email was not sent (email disabled or rejected).`,
      );
    }
    await this.realtime.publish(projectId, {
      resource: "members",
      op: "upsert",
      ids: [invite.id],
      actor: invitedBy,
      at: Date.now(),
    });
    return {
      ...invite,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      emailSent: sent,
    };
  }

  /** Revoke a pending invitation (owner-only). */
  async revoke(projectId: string, inviteId: string, actor: string) {
    await this.prisma.invite.updateMany({
      where: { id: inviteId, projectId, status: "pending" },
      data: { status: "revoked" },
    });
    await this.realtime.publish(projectId, {
      resource: "members",
      op: "delete",
      ids: [inviteId],
      actor,
      at: Date.now(),
    });
  }

  /**
   * Redeem an invitation: the signed-in user joins the project with the granted
   * role. Verifies the token is live and that the user's email matches the invite.
   */
  async accept(token: string, userId: string) {
    const invite = await this.prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.status !== "pending") {
      throw new NotFoundException("This invitation is no longer valid.");
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { status: "expired" },
      });
      throw new GoneException("This invitation has expired.");
    }

    const email = await this.primaryEmail(userId);
    if (!email || email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException(
        "This invitation was sent to a different email address.",
      );
    }

    await this.prisma.user.upsert({
      where: { id: userId },
      update: { email },
      create: { id: userId, email },
    });
    await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: invite.projectId, userId } },
      update: { role: invite.role },
      create: { projectId: invite.projectId, userId, role: invite.role },
    });
    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { status: "accepted", acceptedAt: new Date() },
    });
    await this.realtime.publish(invite.projectId, {
      resource: "members",
      op: "upsert",
      ids: [userId],
      actor: userId,
      at: Date.now(),
    });
    return { projectId: invite.projectId, role: invite.role };
  }

  /** The invitee's primary email, via Clerk (the token carries no identity). */
  private async primaryEmail(userId: string): Promise<string | undefined> {
    try {
      const user = await this.clerk.users.getUser(userId);
      const primary = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId,
      );
      return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
    } catch (err) {
      this.logger.warn(
        `Clerk user lookup failed for ${userId}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private async sendInviteEmail(
    to: string,
    projectName: string,
    role: ProjectRole,
    token: string,
  ): Promise<boolean> {
    const link = `${this.appBaseUrl}/invite/${token}`;
    const safeName = escapeHtml(projectName);
    return this.email.send({
      to,
      subject: `You've been invited to "${projectName}" on Forward`,
      text:
        `You've been invited to join the project "${projectName}" as ${role}.\n\n` +
        `Accept your invitation:\n${link}\n\n` +
        `This link expires in ${INVITE_TTL_DAYS} days.`,
      html:
        `<p>You've been invited to join the project <strong>${safeName}</strong> as <strong>${role}</strong>.</p>` +
        `<p><a href="${link}">Accept your invitation</a></p>` +
        `<p style="color:#666">Or paste this link into your browser:<br>${link}</p>` +
        `<p style="color:#999;font-size:12px">This link expires in ${INVITE_TTL_DAYS} days.</p>`,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
}
