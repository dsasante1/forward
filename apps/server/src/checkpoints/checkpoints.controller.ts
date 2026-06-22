import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CheckpointInput } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard } from "../common/membership.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { CheckpointsService } from "./checkpoints.service.js";

@Controller("projects/:projectId/checkpoints")
@UseGuards(MembershipGuard)
export class CheckpointsController {
  constructor(private readonly checkpoints: CheckpointsService) {}

  @Get()
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.checkpoints.list(projectId, user.id);
  }

  @Post()
  create(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(CheckpointInput)) body: CheckpointInput,
  ) {
    return this.checkpoints.create(projectId, body, user.id);
  }

  @Post(":id/restore")
  async restore(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.checkpoints.restore(projectId, id, user.id);
    return { ok: true };
  }

  @Delete(":id")
  async delete(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.checkpoints.delete(projectId, id, user.id);
    return { ok: true };
  }
}
