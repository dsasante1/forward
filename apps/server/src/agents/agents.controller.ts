import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AgentNode, McpServerNode } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard } from "../common/membership.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { AgentsService } from "./agents.service.js";

@Controller("projects/:projectId/agents")
@UseGuards(MembershipGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  /** Agents + MCP servers in one read. */
  @Get()
  fetch(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.agents.fetch(projectId, user.id);
  }

  @Put("nodes/:id")
  saveAgent(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(AgentNode)) body: AgentNode,
  ) {
    return this.agents.saveAgent(projectId, { ...body, id }, user.id);
  }

  @Delete("nodes/:id")
  async deleteAgent(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.agents.deleteAgent(projectId, id, user.id);
    return { ok: true };
  }

  @Put("servers/:id")
  saveServer(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(McpServerNode)) body: McpServerNode,
  ) {
    return this.agents.saveServer(projectId, { ...body, id }, user.id);
  }

  @Delete("servers/:id")
  async deleteServer(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.agents.deleteServer(projectId, id, user.id);
    return { ok: true };
  }
}
