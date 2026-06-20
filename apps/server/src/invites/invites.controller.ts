import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { ProjectRole } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard, RequireOwner } from "../common/membership.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { InvitesService } from "./invites.service.js";

const CreateInvite = z.object({
  email: z.string().email(),
  role: ProjectRole.default("editor"),
});

@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get("projects/:projectId/invites")
  @UseGuards(MembershipGuard)
  list(@Param("projectId") projectId: string) {
    return this.invites.list(projectId);
  }

  @Post("projects/:projectId/invites")
  @UseGuards(MembershipGuard)
  @RequireOwner()
  create(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(CreateInvite)) body: z.infer<typeof CreateInvite>,
  ) {
    return this.invites.create(projectId, body.email, body.role, user.id);
  }

  @Delete("projects/:projectId/invites/:id")
  @UseGuards(MembershipGuard)
  @RequireOwner()
  async revoke(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.invites.revoke(projectId, id, user.id);
    return { ok: true };
  }

  /**
   * Redeem an invitation. Deliberately NOT membership-guarded — the caller is not
   * yet a member; that's the whole point. ClerkAuthGuard still requires sign-in.
   */
  @Post("invites/:token/accept")
  accept(@Param("token") token: string, @CurrentUser() user: AuthUser) {
    return this.invites.accept(token, user.id);
  }
}
