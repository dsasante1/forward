import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { ProjectRole } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard, RequireOwner } from "../common/membership.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { ProjectsService } from "./projects.service.js";

const CreateProject = z.object({ name: z.string().min(1).max(120) });
const AddMember = z.object({
  userId: z.string().min(1),
  role: ProjectRole.default("editor"),
});
const UpdateMemberRole = z.object({ role: ProjectRole });

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** Create a project (caller becomes owner). */
  @Post("projects")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(CreateProject)) body: z.infer<typeof CreateProject>,
  ) {
    return this.projects.create(user.id, body.name);
  }

  /** List the projects the caller belongs to. */
  @Get("projects")
  list(@CurrentUser() user: AuthUser) {
    return this.projects.listForUser(user.id);
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
