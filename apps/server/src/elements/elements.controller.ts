import {
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
import { ApiBinding, DesignElement } from "forward-core";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator.js";
import { MembershipGuard } from "../common/membership.guard.js";
import { ZodBody } from "../common/zod-validation.pipe.js";
import { ElementsService } from "./elements.service.js";

// A patch is any subset of a DesignElement except its id (server keeps the id)
// and its apiBinding: documentation changes must go through the binding routes
// below so every change lands in the append-only version history.
const ElementPatch = DesignElement.partial().omit({ id: true, apiBinding: true });

const BindBody = z.object({
  binding: ApiBinding,
  version: z.string().min(1),
  changeLog: z.string().default(""),
  action: z.enum(["created", "modified"]).default("modified"),
});

const UnbindBody = z.object({
  version: z.string().min(1),
  changeLog: z.string().default("Removed API documentation"),
  title: z.string().optional(),
});

@Controller("projects/:projectId")
@UseGuards(MembershipGuard)
export class ElementsController {
  constructor(private readonly elements: ElementsService) {}

  @Get("elements")
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.elements.list(projectId, user.id);
  }

  @Put("elements/:id")
  save(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(DesignElement)) body: DesignElement,
  ) {
    return this.elements.save(projectId, { ...body, id }, user.id);
  }

  @Patch("elements/:id")
  patch(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(ElementPatch)) body: z.infer<typeof ElementPatch>,
  ) {
    return this.elements.patch(projectId, id, body, user.id);
  }

  @Delete("elements/:id")
  async delete(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Query("cascade") cascade?: string,
  ) {
    const deleted = await this.elements.delete(
      projectId,
      id,
      cascade !== "false",
      user.id,
    );
    return { deleted };
  }

  // --- API binding (the backend documentation) ---

  @Put("elements/:id/binding")
  async bind(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(BindBody)) body: z.infer<typeof BindBody>,
  ) {
    await this.elements.bind(
      projectId,
      id,
      body.binding,
      { version: body.version, changeLog: body.changeLog, action: body.action },
      user.id,
    );
    return { ok: true };
  }

  @Delete("elements/:id/binding")
  async unbind(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(UnbindBody)) body: z.infer<typeof UnbindBody>,
  ) {
    await this.elements.unbind(projectId, id, body, user.id);
    return { ok: true };
  }

  // --- per-element version histories (read-only; append-only server-side) ---
  // NB: distinct path from the unified project feed at `GET /timeline`
  // (TimelineController). This returns a Record<elementId, VersionEntry[]>;
  // colliding the two on `/timeline` shadowed the project feed and emptied the
  // History view's Design/API/Infra/UML tabs.
  @Get("timelines")
  timelines(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.elements.timelines(projectId, user.id);
  }
}
