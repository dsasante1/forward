import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { InfraEdge, InfraFlow, InfraNode } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard } from "../common/membership.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { InfraService } from "./infra.service.js";

@Controller("projects/:projectId/infra")
@UseGuards(MembershipGuard)
export class InfraController {
  constructor(private readonly infra: InfraService) {}

  /** The whole graph (nodes + edges + flows) in one read. */
  @Get()
  fetch(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.infra.fetch(projectId, user.id);
  }

  @Put("nodes/:id")
  saveNode(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(InfraNode)) body: InfraNode,
  ) {
    return this.infra.saveNode(projectId, { ...body, id }, user.id);
  }

  @Delete("nodes/:id")
  async deleteNode(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.infra.deleteNode(projectId, id, user.id);
    return { ok: true };
  }

  @Put("edges/:id")
  saveEdge(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(InfraEdge)) body: InfraEdge,
  ) {
    return this.infra.saveEdge(projectId, { ...body, id }, user.id);
  }

  @Delete("edges/:id")
  async deleteEdge(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.infra.deleteEdge(projectId, id, user.id);
    return { ok: true };
  }

  @Put("flows/:id")
  saveFlow(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(InfraFlow)) body: InfraFlow,
  ) {
    return this.infra.saveFlow(projectId, { ...body, id }, user.id);
  }

  @Delete("flows/:id")
  async deleteFlow(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.infra.deleteFlow(projectId, id, user.id);
    return { ok: true };
  }
}
