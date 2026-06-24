import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard } from "../common/membership.guard.js";
import { TimelineService } from "./timeline.service.js";

/** Read-only: the project's unified activity feed for the canvas History view. */
@Controller("projects/:projectId/timeline")
@UseGuards(MembershipGuard)
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.timeline.list(projectId, user.id);
  }
}
