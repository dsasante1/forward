import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { OrgAdminGuard } from "../common/org-admin.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { OrgsService } from "./orgs.service.js";

const TransferOwnership = z.object({ userId: z.string().min(1) });

/**
 * The Org Admin portal API. Every route is org-scoped (`:orgId`) and gated by
 * OrgAdminGuard, so only an admin of that org (or a platform admin) reaches it.
 * Read routes power the dashboard's org-admin panels; the writes are audited in
 * the service.
 */
@Controller("orgs/:orgId")
@UseGuards(OrgAdminGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get("projects")
  projects(@Param("orgId") orgId: string) {
    return this.orgs.listProjects(orgId);
  }

  @Post("projects/:projectId/transfer")
  transfer(
    @Param("orgId") orgId: string,
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(TransferOwnership))
    body: z.infer<typeof TransferOwnership>,
  ) {
    return this.orgs.transferOwnership(orgId, projectId, body.userId, user.id);
  }

  @Delete("projects/:projectId")
  deleteProject(
    @Param("orgId") orgId: string,
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orgs.deleteProject(orgId, projectId, user.id);
  }

  @Get("members")
  members(@Param("orgId") orgId: string) {
    return this.orgs.listMembers(orgId);
  }

  @Get("tokens")
  tokens(@Param("orgId") orgId: string) {
    return this.orgs.listTokens(orgId);
  }

  @Delete("tokens/:tokenId")
  revokeToken(
    @Param("orgId") orgId: string,
    @Param("tokenId") tokenId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orgs.revokeToken(orgId, tokenId, user.id);
  }

  @Get("activity")
  activity(@Param("orgId") orgId: string, @Query("limit") limit?: string) {
    return this.orgs.activity(orgId, limit ? Number(limit) : undefined);
  }

  @Get("usage")
  usage(@Param("orgId") orgId: string) {
    return this.orgs.usage(orgId);
  }

  @Get("audit")
  audit(@Param("orgId") orgId: string, @Query("limit") limit?: string) {
    return this.orgs.auditTrail(orgId, limit ? Number(limit) : undefined);
  }
}
