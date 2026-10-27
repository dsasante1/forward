/// <reference types="node" />
import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { diffBindings } from "../api-diff.js";
import {
  AgentNode,
  ApiBinding,
  Checkpoint,
  CheckpointChange,
  CheckpointInput,
  CheckpointSnapshot,
  DesignElement,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  McpServerNode,
  Task,
  VersionEntry,
  descendantIds,
} from "../schema.js";
import { nextTaskKey } from "../tasks.js";
import {
  COLLECTIONS,
  FORMAT_VERSION,
  FORWARD_DIR,
  MANIFEST_FILE,
  collectionDir,
  fileNameForId,
  type CollectionKey,
} from "./layout.js";

/** An error carrying the HTTP status the router should answer with. */
export class RepoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

/** The `.forward/forward.json` manifest. */
export interface RepoManifest {
  format: number;
  /** Project id, the namespace every surface addresses (`ApiConfig.projectId`). */
  id: string;
  name: string;
}

export interface RepoStoreOptions {
  /** Who writes. Defaults to `$FORWARD_AUTHOR`, then git `user.name`, then the OS user. */
  author?: string;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

/**
 * The file-backed store behind repo mode. It mirrors the central server's
 * semantics, so a project behaves the same whether it lives in Postgres or in
 * git. Writers stamp `updatedAt`; `saveElement` never touches `apiBinding`;
 * bind/unbind append an immutable history entry with a structured diff; deletes
 * cascade exactly as the server does.
 *
 * Synchronous on purpose. Projects are small, the files are local, and a
 * synchronous read-modify-write cannot interleave with another request in the
 * same process.
 */
export class RepoStore {
  readonly author: string;
  private readonly now: () => Date;

  constructor(
    readonly root: string,
    opts: RepoStoreOptions = {},
  ) {
    this.author = opts.author ?? "local";
    this.now = opts.now ?? (() => new Date());
  }

  // --- manifest ------------------------------------------------------------

  manifest(): RepoManifest {
    const file = join(this.root, FORWARD_DIR, MANIFEST_FILE);
    if (!existsSync(file)) {
      throw new RepoError(
        404,
        `No Forward project at ${this.root}. Run \`forward init\` to create .forward/${MANIFEST_FILE}.`,
      );
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RepoManifest>;
    if (!raw.id) throw new RepoError(500, `.forward/${MANIFEST_FILE} has no "id".`);
    return { format: raw.format ?? FORMAT_VERSION, id: raw.id, name: raw.name ?? raw.id };
  }

  // --- design elements -----------------------------------------------------

  listElements(): DesignElement[] {
    return this.readAll("elements", DesignElement);
  }

  getElement(id: string): DesignElement | undefined {
    return this.readOne("elements", id, DesignElement);
  }

  /** Upsert geometry/style. A client-sent binding is ignored and the stored one kept. */
  saveElement(input: unknown): DesignElement {
    const parsed = this.parse(DesignElement, input, "design element");
    const { apiBinding: _ignored, ...clean } = parsed;
    const stored = this.getElement(clean.id)?.apiBinding;
    const next = DesignElement.parse({
      ...clean,
      ...(stored ? { apiBinding: stored } : {}),
      updatedAt: this.iso(),
    });
    this.write("elements", next.id, next);
    return next;
  }

  /** Partial update that preserves untouched fields, including the binding. */
  patchElement(id: string, patch: unknown): DesignElement {
    const current = this.requireElement(id);
    const { apiBinding: _ignored, ...rest } = (patch ?? {}) as Partial<DesignElement>;
    const next = this.parse(
      DesignElement,
      { ...current, ...rest, id, updatedAt: this.iso() },
      "design element",
    );
    this.write("elements", id, next);
    return next;
  }

  /** Delete an element, by default with its `parentId` subtree. History is kept. */
  deleteElement(id: string, cascade = true): string[] {
    const all = this.listElements();
    const ids = cascade ? [id, ...descendantIds(id, all)] : [id];
    for (const target of ids) this.remove("elements", target);
    return ids;
  }

  /** Attach or replace the API docs and append a version entry with a diff. */
  bind(
    id: string,
    body: { binding?: unknown; version?: string; changeLog?: string; action?: string },
  ): void {
    const current = this.requireElement(id);
    const binding = this.parse(ApiBinding, body.binding, "API binding");
    const action = body.action === "created" ? "created" : "modified";
    this.write("elements", id, DesignElement.parse({
      ...current,
      apiBinding: binding,
      updatedAt: this.iso(),
    }));
    this.appendVersion(id, {
      version: body.version ?? "",
      author: this.author,
      action,
      changeLog: body.changeLog ?? "",
      endpoint: { title: binding.title },
      diff: diffBindings(current.apiBinding, binding),
    });
  }

  /** Remove the API docs and append a "deleted" version entry. */
  unbind(id: string, body: { version?: string; changeLog?: string; title?: string }): void {
    const current = this.requireElement(id);
    const { apiBinding: _drop, ...rest } = current;
    this.write("elements", id, DesignElement.parse({ ...rest, updatedAt: this.iso() }));
    this.appendVersion(id, {
      version: body.version ?? "",
      author: this.author,
      action: "deleted",
      changeLog: body.changeLog ?? "Removed API documentation",
      ...(body.title ? { endpoint: { title: body.title } } : {}),
      diff: diffBindings(current.apiBinding, undefined),
    });
  }

  /** Every element's API-doc history, oldest first, keyed by element id. */
  timelines(): Record<string, VersionEntry[]> {
    const dir = collectionDir(this.root, "history");
    const out: Record<string, VersionEntry[]> = {};
    for (const sub of listDirs(dir)) {
      const entries: VersionEntry[] = [];
      for (const file of listJson(join(dir, sub))) {
        const parsed = VersionEntry.safeParse(readJson(join(dir, sub, file)));
        if (parsed.success) entries.push(parsed.data);
      }
      if (!entries.length) continue;
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const elementId = (readJson(join(dir, sub, ".element")) as string | undefined) ?? sub;
      out[typeof elementId === "string" ? elementId : sub] = entries;
    }
    return out;
  }

  // --- infra graph + flows -------------------------------------------------

  infra() {
    return {
      nodes: this.readAll("infraNodes", InfraNode),
      edges: this.readAll("infraEdges", InfraEdge),
      flows: this.readAll("infraFlows", InfraFlow),
      entities: this.readAll("entities", Entity),
      relations: this.readAll("relations", EntityRelation),
    };
  }

  saveInfraNode(input: unknown): InfraNode {
    return this.upsert("infraNodes", InfraNode, input, "infra node");
  }

  saveInfraEdge(input: unknown): InfraEdge {
    return this.upsert("infraEdges", InfraEdge, input, "infra edge");
  }

  saveInfraFlow(input: unknown): InfraFlow {
    return this.upsert("infraFlows", InfraFlow, input, "flow");
  }

  /** Delete a node and every edge touching it, so none dangle. */
  deleteInfraNode(id: string): void {
    this.remove("infraNodes", id);
    for (const edge of this.readAll("infraEdges", InfraEdge)) {
      if (edge.from === id || edge.to === id) this.remove("infraEdges", edge.id);
    }
  }

  deleteInfraEdge(id: string): void {
    this.remove("infraEdges", id);
  }

  deleteInfraFlow(id: string): void {
    this.remove("infraFlows", id);
  }

  // --- entities (ER) -------------------------------------------------------

  saveEntity(input: unknown): Entity {
    return this.upsert("entities", Entity, input, "entity");
  }

  saveRelation(input: unknown): EntityRelation {
    return this.upsert("relations", EntityRelation, input, "relation");
  }

  /** Delete an entity and every relation touching it. */
  deleteEntity(id: string): void {
    this.remove("entities", id);
    for (const rel of this.readAll("relations", EntityRelation)) {
      if (rel.from === id || rel.to === id) this.remove("relations", rel.id);
    }
  }

  deleteRelation(id: string): void {
    this.remove("relations", id);
  }

  // --- agents + MCP servers ------------------------------------------------

  agents() {
    return {
      agents: this.readAll("agents", AgentNode),
      servers: this.readAll("servers", McpServerNode),
    };
  }

  saveAgent(input: unknown): AgentNode {
    return this.upsert("agents", AgentNode, input, "agent");
  }

  saveServer(input: unknown): McpServerNode {
    return this.upsert("servers", McpServerNode, input, "MCP server");
  }

  deleteAgent(id: string): void {
    this.remove("agents", id);
  }

  /** Delete a server and drop it from every agent's `mcpServerIds`. */
  deleteServer(id: string): void {
    this.remove("servers", id);
    for (const agent of this.readAll("agents", AgentNode)) {
      if (!agent.mcpServerIds.includes(id)) continue;
      this.write("agents", agent.id, AgentNode.parse({
        ...agent,
        mcpServerIds: agent.mcpServerIds.filter((s) => s !== id),
        updatedAt: this.iso(),
      }));
    }
  }

  // --- tasks ---------------------------------------------------------------

  listTasks(): Task[] {
    return this.readAll("tasks", Task);
  }

  /** Upsert a task. `createdAt` survives, `updatedAt` is stamped, a missing key is assigned. */
  saveTask(input: unknown): Task {
    const parsed = this.parse(Task, input, "task");
    const prior = this.readOne("tasks", parsed.id, Task);
    const now = this.iso();
    const next: Task = {
      ...parsed,
      createdAt: prior?.createdAt || parsed.createdAt || now,
      updatedAt: now,
    };
    if (!next.key) next.key = nextTaskKey(this.listTasks().map((t) => t.key));
    const valid = Task.parse(next);
    this.write("tasks", valid.id, valid);
    return valid;
  }

  deleteTask(id: string): void {
    this.remove("tasks", id);
  }

  // --- checkpoints ---------------------------------------------------------

  listCheckpoints(): Checkpoint[] {
    return this.readAll("checkpoints", Checkpoint).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  /** Freeze the current design + infra into a new checkpoint. */
  createCheckpoint(input: unknown): Checkpoint {
    const clean = this.parse(CheckpointInput, input, "checkpoint");
    const snapshot = CheckpointSnapshot.parse({
      elements: this.listElements(),
      infraNodes: this.readAll("infraNodes", InfraNode),
      infraEdges: this.readAll("infraEdges", InfraEdge),
      infraFlows: this.readAll("infraFlows", InfraFlow),
    });
    const cp = Checkpoint.parse({
      id: `cp_${randomUUID()}`,
      ...clean,
      author: this.author,
      changes: changesOf(snapshot),
      snapshot,
      createdAt: this.iso(),
    });
    this.write("checkpoints", cp.id, cp);
    return cp;
  }

  deleteCheckpoint(id: string): void {
    this.remove("checkpoints", id);
  }

  /** Rewind design + infra to a checkpoint. API-doc history is left intact. */
  restoreCheckpoint(id: string): Checkpoint {
    const cp = this.readOne("checkpoints", id, Checkpoint);
    if (!cp) throw new RepoError(404, `No checkpoint "${id}"`);
    const layers: Array<[CollectionKey, Array<{ id: string }>]> = [
      ["elements", cp.snapshot.elements],
      ["infraNodes", cp.snapshot.infraNodes],
      ["infraEdges", cp.snapshot.infraEdges],
      ["infraFlows", cp.snapshot.infraFlows],
    ];
    for (const [key, items] of layers) {
      rmSync(collectionDir(this.root, key), { recursive: true, force: true });
      for (const item of items) this.write(key, item.id, item);
    }
    return cp;
  }

  // --- internals -----------------------------------------------------------

  private iso(): string {
    return this.now().toISOString();
  }

  private requireElement(id: string): DesignElement {
    const el = this.getElement(id);
    if (!el) throw new RepoError(404, `No design element "${id}"`);
    return el;
  }

  /** Validate a body against a schema, turning a Zod failure into a 400. */
  private parse<T>(schema: Schema<T>, value: unknown, what: string): T {
    const res = schema.safeParse(value);
    if (res.success) return res.data;
    const issue = res.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    throw new RepoError(400, `Invalid ${what}${where}: ${issue?.message ?? "bad shape"}`);
  }

  /** Validate, stamp `updatedAt`, write. Shared by every simple graph layer. */
  private upsert<T extends { id: string }>(
    key: CollectionKey,
    schema: Schema<T>,
    input: unknown,
    what: string,
  ): T {
    const stamped = { ...(input as object), updatedAt: this.iso() };
    const next = this.parse(schema, stamped, what);
    this.write(key, next.id, next);
    return next;
  }

  private appendVersion(elementId: string, input: Omit<VersionEntry, "timestamp">): void {
    const dir = join(collectionDir(this.root, "history"), fileNameForId(elementId));
    mkdirSync(dir, { recursive: true });
    // Keep each element's timestamps strictly increasing: entries written in the
    // same millisecond would tie, and the random file suffix would decide their order.
    const last = listJson(dir).reduce((max, file) => Math.max(max, Number.parseInt(file, 10) || 0), 0);
    const timestamp = Math.max(this.now().getTime(), last + 1);
    const entry = VersionEntry.parse({ ...input, timestamp });
    if (fileNameForId(elementId) !== elementId) {
      // Encoded directory names can't be decoded reliably, so record the real id.
      writeAtomic(join(dir, ".element"), `${JSON.stringify(elementId)}\n`);
    }
    const name = `${entry.timestamp}-${randomBytes(3).toString("hex")}.json`;
    writeAtomic(join(dir, name), toJson(entry));
  }

  private readAll<T>(key: CollectionKey, schema: Schema<T>): T[] {
    const dir = collectionDir(this.root, key);
    const out: T[] = [];
    for (const file of listJson(dir)) {
      const parsed = schema.safeParse(readJson(join(dir, file)));
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  private readOne<T>(key: CollectionKey, id: string, schema: Schema<T>): T | undefined {
    const raw = readJson(this.pathOf(key, id));
    if (raw === undefined) return undefined;
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  private write(key: CollectionKey, id: string, value: unknown): void {
    const file = this.pathOf(key, id);
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, toJson(value));
  }

  private remove(key: CollectionKey, id: string): boolean {
    const file = this.pathOf(key, id);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  }

  private pathOf(key: CollectionKey, id: string): string {
    return join(this.root, FORWARD_DIR, COLLECTIONS[key], `${fileNameForId(id)}.json`);
  }
}

/** Per-layer change-count chips for a checkpoint card, matching the server. */
function changesOf(snapshot: CheckpointSnapshot): CheckpointChange[] {
  const out: CheckpointChange[] = [];
  if (snapshot.elements.length) out.push({ layer: "DESIGN", n: snapshot.elements.length });
  const infra = snapshot.infraNodes.length + snapshot.infraEdges.length;
  if (infra) out.push({ layer: "INFRA", n: infra });
  if (snapshot.infraFlows.length) out.push({ layer: "FLOW", n: snapshot.infraFlows.length });
  return out;
}

/** Stable, diff-friendly JSON: two-space indent, trailing newline. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Write via a temp file + rename so a concurrent reader never sees half a file. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}
