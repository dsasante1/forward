import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { PlatformAdminGuard } from "../common/platform-admin.guard.js";
import type { AuditTargetType } from "../common/admin-audit.service.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { AdminService } from "./admin.service.js";

/**
 * A `?limit=` query param as a safe `take` value: a positive integer, else
 * undefined (so the service default applies). Without this, `?limit=abc` becomes
 * `take: NaN` and `?limit=-5` a negative take — both Prisma errors (500s).
 */
function parseLimit(limit?: string): number | undefined {
  const n = Number(limit);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const SetSuspended = z.object({ suspend: z.boolean() });
const SetPlatformAdmin = z.object({ value: z.boolean() });
const SetOrgPlan = z.object({
  plan: z.enum(["solo", "team", "enterprise"]).optional(),
  seatLimit: z.number().int().positive().max(100000).nullable().optional(),
  region: z.string().max(60).nullable().optional(),
});

/**
 * The Platform Admin portal API — the cross-tenant control plane, gated by
 * PlatformAdminGuard (the one place tenancy is intentionally bypassed). Consumed
 * by the separate internal admin app (apps/admin), never the customer dashboard.
 */
@Controller("admin")
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  overview() {
    return this.admin.overview();
  }

  @Get("users")
  users(@Query("q") q?: string, @Query("limit") limit?: string) {
    return this.admin.listUsers(q, parseLimit(limit));
  }

  @Post("users/:id/suspend")
  suspendUser(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(SetSuspended)) body: z.infer<typeof SetSuspended>,
  ) {
    return this.admin.setUserSuspended(id, body.suspend, user.id);
  }

  @Post("users/:id/platform-admin")
  setPlatformAdmin(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(SetPlatformAdmin)) body: z.infer<typeof SetPlatformAdmin>,
  ) {
    return this.admin.setPlatformAdmin(id, body.value, user.id);
  }

  @Get("orgs")
  orgs(@Query("q") q?: string, @Query("limit") limit?: string) {
    return this.admin.listOrgs(q, parseLimit(limit));
  }

  @Get("orgs/:id")
  orgDetail(@Param("id") id: string) {
    return this.admin.orgDetail(id);
  }

  @Patch("orgs/:id")
  setOrgPlan(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(SetOrgPlan)) body: z.infer<typeof SetOrgPlan>,
  ) {
    return this.admin.setOrgPlan(id, body, user.id);
  }

  @Post("users/:id/impersonate")
  impersonate(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.admin.impersonate(id, user.id);
  }

  @Post("orgs/:id/suspend")
  suspendOrg(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(SetSuspended)) body: z.infer<typeof SetSuspended>,
  ) {
    return this.admin.setOrgSuspended(id, body.suspend, user.id);
  }

  @Get("projects")
  projects(@Query("q") q?: string, @Query("limit") limit?: string) {
    return this.admin.listProjects(q, parseLimit(limit));
  }

  @Delete("projects/:id")
  deleteProject(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.admin.deleteProject(id, user.id);
  }

  @Get("audit")
  audit(
    @Query("scope") scope?: string,
    @Query("orgId") orgId?: string,
    @Query("actorId") actorId?: string,
    @Query("targetType") targetType?: string,
    @Query("targetId") targetId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.admin.auditTrail({
      ...(scope === "org" || scope === "platform" ? { scope } : {}),
      ...(orgId ? { orgId } : {}),
      ...(actorId ? { actorId } : {}),
      ...(targetType ? { targetType: targetType as AuditTargetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(parseLimit(limit) !== undefined ? { limit: parseLimit(limit) } : {}),
    });
  }
}
