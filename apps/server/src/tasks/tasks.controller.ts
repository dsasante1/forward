import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { Task } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard } from "../common/membership.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { TasksService } from "./tasks.service.js";

@Controller("projects/:projectId/tasks")
@UseGuards(MembershipGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.tasks.list(projectId, user.id);
  }

  @Put(":id")
  save(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(Task)) body: Task,
  ) {
    return this.tasks.save(projectId, { ...body, id }, user.id);
  }

  @Delete(":id")
  async delete(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tasks.delete(projectId, id, user.id);
    return { ok: true };
  }
}
