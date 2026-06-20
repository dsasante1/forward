import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Task } from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";
import { sanitizeFields } from "../common/sanitize.js";

type Json = Prisma.InputJsonValue;

/**
 * The project-scoped work tracker (pillar 4). Links into the other layers
 * (elementId / flowId / endpointId) are soft references resolved on read, so the
 * service stores them as-is and does not enforce referential integrity — matching
 * the contract's design.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(projectId: string, actor: string): Promise<Task[]> {
    return this.prisma.withUser(actor, async (tx) => {
      const rows = await tx.task.findMany({
        where: { projectId },
        select: { data: true },
      });
      return rows.flatMap((r) => {
        const p = Task.safeParse(r.data);
        return p.success ? [p.data] : [];
      });
    });
  }

  async save(projectId: string, task: Task, actor: string): Promise<Task> {
    const now = new Date().toISOString();
    const clean = sanitizeFields(task, ["title", "description"]);
    const next: Task = {
      ...clean,
      createdAt: clean.createdAt || now,
      updatedAt: now,
    };
    await this.prisma.withUser(actor, (tx) =>
      tx.task.upsert({
        where: { projectId_id: { projectId, id: next.id } },
        update: { data: next as unknown as Json, updatedAt: new Date() },
        create: {
          projectId,
          id: next.id,
          data: next as unknown as Json,
          createdAt: new Date(next.createdAt),
          updatedAt: new Date(),
        },
      }),
    );
    await this.emit(projectId, "upsert", [next.id], actor);
    return next;
  }

  async delete(projectId: string, id: string, actor: string): Promise<void> {
    await this.prisma.withUser(actor, (tx) =>
      tx.task.deleteMany({ where: { projectId, id } }),
    );
    await this.emit(projectId, "delete", [id], actor);
  }

  private async emit(
    projectId: string,
    op: "upsert" | "delete",
    ids: string[],
    actor: string,
  ): Promise<void> {
    await this.realtime.publish(projectId, {
      resource: "tasks",
      op,
      ids,
      actor,
      at: Date.now(),
    });
  }
}
