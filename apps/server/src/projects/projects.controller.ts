import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { ProjectRole } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard, RequireOwner } from "../common/membership.guard.js";
import { RealtimeService } from "../common/realtime.service.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { ProjectsService } from "./projects.service.js";

const CreateProject = z.object({ name: z.string().min(1).max(120) });
const RenameProject = z.object({ name: z.string().min(1).max(120) });
const SetFavorite = z.object({ favorite: z.boolean() });
const AddMember = z.object({
  userId: z.string().min(1),
  role: ProjectRole.default("editor"),
});
const UpdateMemberRole = z.object({ role: ProjectRole });

@Controller()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * The realtime channel name for this project — an unguessable capability the
   * client subscribes to (it never derives the name itself). Behind MembershipGuard
   * so only a member can learn it, which is what keeps the broadcast bus inside the
   * tenancy boundary (see RealtimeService.channelName).
   */
  @Get("projects/:projectId/realtime")
  @UseGuards(MembershipGuard)
  realtimeChannel(@Param("projectId") projectId: string) {
    return { channel: this.realtime.channelName(projectId) };
  }

  /** Create a project (caller becomes owner). */
  @Post("projects")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(CreateProject)) body: z.infer<typeof CreateProject>,
  ) {
    return this.projects.create(user.id, body.name, user.orgId);
  }

  /**
   * List the projects the caller belongs to, enriched for the dashboard
   * (role, favorite, member preview, edited time). Optional `q` searches by
   * name and `sort` is `recent` (default) or `name`.
   */
  @Get("projects")
  list(
    @CurrentUser() user: AuthUser,
    @Query("q") q?: string,
    @Query("sort") sort?: string,
  ) {
    return this.projects.listForUser(user.id, {
      q,
      sort: sort === "name" ? "name" : "recent",
    });
  }

  /** Rename a project (owner-only). */
  @Patch("projects/:projectId")
  @UseGuards(MembershipGuard)
  @RequireOwner()
  rename(
    @Param("projectId") projectId: string,
    @Body(new ZodBody(RenameProject)) body: z.infer<typeof RenameProject>,
  ) {
    return this.projects.rename(projectId, body.name);
  }

  /** Delete a project and everything under it (owner-only). */
  @Delete("projects/:projectId")
  @UseGuards(MembershipGuard)
  @RequireOwner()
  async remove(@Param("projectId") projectId: string) {
    await this.projects.remove(projectId);
    return { ok: true };
  }

  /** Duplicate a project into a new one the caller owns (any member may copy). */
  @Post("projects/:projectId/duplicate")
  @UseGuards(MembershipGuard)
  duplicate(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.duplicate(projectId, user.id, user.orgId);
  }

  /** Set/clear the caller's favorite flag on a project they belong to. */
  @Put("projects/:projectId/favorite")
  @UseGuards(MembershipGuard)
  setFavorite(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(SetFavorite)) body: z.infer<typeof SetFavorite>,
  ) {
    return this.projects.setFavorite(projectId, user.id, body.favorite);
  }

  // --- roster (project-scoped; MembershipGuard enforces tenancy) ---

  @Get("projects/:projectId/members")
  @UseGuards(MembershipGuard)
  members(@Param("projectId") projectId: string) {
    return this.projects.listMembers(projectId);
  }

  @Post("projects/:projectId/members")
  @UseGuards(MembershipGuard)
  @RequireOwner()
  async addMember(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(AddMember)) body: z.infer<typeof AddMember>,
  ) {
    await this.projects.addMember(projectId, body.userId, body.role, user.id);
    return { ok: true };
  }

  @Patch("projects/:projectId/members/:userId")
  @UseGuards(MembershipGuard)
  @RequireOwner()
  async updateMemberRole(
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(UpdateMemberRole)) body: z.infer<typeof UpdateMemberRole>,
  ) {
    try {
      await this.projects.updateMemberRole(projectId, userId, body.role, user.id);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return { ok: true };
  }

  @Delete("projects/:projectId/members/:userId")
  @UseGuards(MembershipGuard)
  @RequireOwner()
  async removeMember(
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      await this.projects.removeMember(projectId, userId, user.id);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return { ok: true };
  }
}
