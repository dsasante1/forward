import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ApiBinding,
  DesignElement,
  VersionEntry,
  descendantIds,
} from "forward-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeService } from "../common/realtime.service.js";
import { sanitizeFields } from "../common/sanitize.js";

type Json = Prisma.InputJsonValue;

/**
 * Design elements + their optional apiBinding + the append-only documentation
 * timeline. This is the server-side equivalent of the element/binding/timeline
 * functions in packages/shared/src/rtdb-rest.ts, with the centralization fixes:
 *   - server stamps `updatedAt`, `author`, `timestamp` (never the client)
 *   - the three steps of a bind run in ONE transaction (atomic)
 *   - version history is INSERT-only
 *   - Markdown is sanitized before storage
 */
@Injectable()
export class ElementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(projectId: string, actor: string): Promise<DesignElement[]> {
    return this.prisma.withUser(actor, async (tx) => {
      const rows = await tx.designElement.findMany({
        where: { projectId },
        select: { data: true },
      });
      return rows.flatMap((r) => {
        const parsed = DesignElement.safeParse(r.data);
        return parsed.success ? [parsed.data] : [];
      });
    });
  }

  /** Create or replace a whole element. Server owns `updatedAt`. */
  async save(
    projectId: string,
    element: DesignElement,
    actor: string,
  ): Promise<DesignElement> {
    const clean = this.sanitizeElement(element);
    const next: DesignElement = { ...clean, updatedAt: new Date().toISOString() };
    await this.prisma.withUser(actor, async (tx) => {
      await tx.designElement.upsert({
        where: { projectId_id: { projectId, id: next.id } },
        update: { data: next as unknown as Json, updatedAt: new Date() },
        create: {
          projectId,
          id: next.id,
          data: next as unknown as Json,
          updatedAt: new Date(),
        },
      });
      await this.bumpProject(tx, projectId);
    });
    await this.emit(projectId, "upsert", [next.id], actor);
    return next;
  }

  /** Partial update that preserves untouched fields (incl. apiBinding). */
  async patch(
    projectId: string,
    id: string,
    patch: Partial<Omit<DesignElement, "id">>,
    actor: string,
  ): Promise<DesignElement> {
    return this.prisma.withUser(actor, async (tx) => {
      const current = await this.requireElement(tx, projectId, id);
      const merged = DesignElement.parse({
        ...current,
        ...this.sanitizeElement(patch as DesignElement),
        id,
        updatedAt: new Date().toISOString(),
      });
      await tx.designElement.update({
        where: { projectId_id: { projectId, id } },
        data: { data: merged as unknown as Json, updatedAt: new Date() },
      });
      await this.bumpProject(tx, projectId);
      await this.emit(projectId, "upsert", [id], actor);
      return merged;
    });
  }

  /** Delete an element; cascades to its `parentId` subtree by default. */
  async delete(
    projectId: string,
    id: string,
    cascade: boolean,
    actor: string,
  ): Promise<string[]> {
    const ids = await this.prisma.withUser(actor, async (tx) => {
      let toDelete = [id];
      if (cascade) {
        const all = await tx.designElement.findMany({
          where: { projectId },
          select: { data: true },
        });
        const shaped = all.flatMap((r) => {
          const p = DesignElement.safeParse(r.data);
          return p.success ? [{ id: p.data.id, parentId: p.data.parentId }] : [];
        });
        toDelete = [id, ...descendantIds(id, shaped)];
      }
      await tx.designElement.deleteMany({
        where: { projectId, id: { in: toDelete } },
      });
      await this.bumpProject(tx, projectId);
      // The append-only version history is intentionally LEFT INTACT as a record.
      return toDelete;
    });
    await this.emit(projectId, "delete", ids, actor);
    return ids;
  }

  /** Attach/replace the apiBinding and append a version entry — atomically. */
  async bind(
    projectId: string,
    id: string,
    binding: ApiBinding,
    version: { version: string; changeLog: string; action: "created" | "modified" },
    actor: string,
  ): Promise<void> {
    const clean = sanitizeFields(binding, ["description"]);
    await this.prisma.withUser(actor, async (tx) => {
      const current = await this.requireElement(tx, projectId, id);
      const next: DesignElement = {
        ...current,
        apiBinding: clean,
        updatedAt: new Date().toISOString(),
      };
      await tx.designElement.update({
        where: { projectId_id: { projectId, id } },
        data: { data: next as unknown as Json, updatedAt: new Date() },
      });
      await this.bumpProject(tx, projectId);
      await this.appendVersion(tx, projectId, id, actor, {
        version: version.version,
        author: actor,
        action: version.action,
        changeLog: version.changeLog,
        endpoint: {
          title: clean.title,
          ...(clean.method ? { method: clean.method } : {}),
          ...(clean.endpoint ? { path: clean.endpoint } : {}),
        },
      });
    });
    await this.emit(projectId, "upsert", [id], actor);
    await this.realtime.publish(projectId, {
      resource: "timeline",
      op: "upsert",
      ids: [id],
      actor,
      at: Date.now(),
    });
  }

  /** Remove the apiBinding and append a "deleted" version entry — atomically. */
  async unbind(
    projectId: string,
    id: string,
    version: { version: string; changeLog: string; title?: string },
    actor: string,
  ): Promise<void> {
    await this.prisma.withUser(actor, async (tx) => {
      const current = await this.requireElement(tx, projectId, id);
      const { apiBinding: _drop, ...rest } = current;
      const next: DesignElement = {
        ...rest,
        updatedAt: new Date().toISOString(),
      };
      await tx.designElement.update({
        where: { projectId_id: { projectId, id } },
        data: { data: next as unknown as Json, updatedAt: new Date() },
      });
      await this.bumpProject(tx, projectId);
      await this.appendVersion(tx, projectId, id, actor, {
        version: version.version,
        author: actor,
        action: "deleted",
        changeLog: version.changeLog,
        ...(version.title ? { endpoint: { title: version.title } } : {}),
      });
    });
    await this.emit(projectId, "upsert", [id], actor);
    await this.realtime.publish(projectId, {
      resource: "timeline",
      op: "upsert",
      ids: [id],
      actor,
      at: Date.now(),
    });
  }

  /** Every element's history, keyed by element id (what the timeline views read). */
  async timelines(
    projectId: string,
    actor: string,
  ): Promise<Record<string, VersionEntry[]>> {
    return this.prisma.withUser(actor, async (tx) => {
      const rows = await tx.versionEntry.findMany({
        where: { projectId },
        orderBy: { ts: "asc" },
        select: { elementId: true, data: true },
      });
      const out: Record<string, VersionEntry[]> = {};
      for (const row of rows) {
        const parsed = VersionEntry.safeParse(row.data);
        if (!parsed.success) continue;
        (out[row.elementId] ??= []).push(parsed.data);
      }
      return out;
    });
  }

  // --- internals -----------------------------------------------------------

  /**
   * Stamp the project as edited so the dashboard's "edited" time reflects canvas
   * work, not just renames. Done in the same transaction as the element write.
   */
  private async bumpProject(
    tx: Prisma.TransactionClient,
    projectId: string,
  ): Promise<void> {
    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  }

  private async requireElement(
    tx: Prisma.TransactionClient | PrismaService,
    projectId: string,
    id: string,
  ): Promise<DesignElement> {
    const row = await (tx as PrismaService).designElement.findUnique({
      where: { projectId_id: { projectId, id } },
      select: { data: true },
    });
    if (!row) throw new NotFoundException(`No design element "${id}"`);
    return DesignElement.parse(row.data);
  }

  /** INSERT-only history write. Server stamps `timestamp`; `author` = the actor. */
  private async appendVersion(
    tx: Prisma.TransactionClient | PrismaService,
    projectId: string,
    elementId: string,
    actor: string,
    input: Omit<VersionEntry, "timestamp">,
  ): Promise<void> {
    const entry = VersionEntry.parse({ ...input, timestamp: Date.now() });
    await (tx as PrismaService).versionEntry.create({
      data: {
        projectId,
        elementId,
        author: actor,
        ts: BigInt(entry.timestamp),
        data: entry as unknown as Json,
      },
    });
  }

  private sanitizeElement<T extends Partial<DesignElement>>(el: T): T {
    const out = sanitizeFields(el as Record<string, unknown>, ["name", "text"]);
    if (out.apiBinding && typeof out.apiBinding === "object") {
      out.apiBinding = sanitizeFields(
        out.apiBinding as Record<string, unknown>,
        ["description"],
      );
    }
    return out as T;
  }

  private async emit(
    projectId: string,
    op: "upsert" | "delete",
    ids: string[],
    actor: string,
  ): Promise<void> {
    await this.realtime.publish(projectId, {
      resource: "elements",
      op,
      ids,
      actor,
      at: Date.now(),
    });
  }
}
