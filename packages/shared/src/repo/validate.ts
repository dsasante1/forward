/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { z } from "zod";
import { findDependencyCycles, parseTaskDay } from "../gantt.js";
import {
  AgentNode,
  Checkpoint,
  DesignElement,
  DismissedDraft,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  McpServerNode,
  Task,
  VersionEntry,
} from "../schema.js";
import {
  COLLECTIONS,
  FORWARD_DIR,
  MANIFEST_FILE,
  fileNameForId,
  type CollectionKey,
} from "./layout.js";

export interface ValidationIssue {
  /** `error` fails CI. `warning` flags a soft reference that no longer resolves. */
  level: "error" | "warning";
  /** Path relative to the repository root. */
  file: string;
  message: string;
}

const SCHEMAS: Record<Exclude<CollectionKey, "history">, z.ZodTypeAny> = {
  elements: DesignElement,
  infraNodes: InfraNode,
  infraEdges: InfraEdge,
  infraFlows: InfraFlow,
  entities: Entity,
  relations: EntityRelation,
  agents: AgentNode,
  servers: McpServerNode,
  tasks: Task,
  checkpoints: Checkpoint,
  dismissed: DismissedDraft,
};

/**
 * Check a `.forward/` directory the way CI should: every file is valid JSON
 * that satisfies its Zod schema, every filename matches the id inside it, no id
 * appears twice, and (as warnings, since cross-layer links are soft by design)
 * every reference resolves.
 */
export function validateRepo(root: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rel = (p: string) => relative(root, p);
  const err = (file: string, message: string) => issues.push({ level: "error", file: rel(file), message });
  const warn = (file: string, message: string) => issues.push({ level: "warning", file: rel(file), message });

  const manifest = join(root, FORWARD_DIR, MANIFEST_FILE);
  if (!existsSync(manifest)) {
    err(manifest, "Missing project manifest. Run `forward init`.");
    return issues;
  }
  try {
    const m = JSON.parse(readFileSync(manifest, "utf8")) as { id?: unknown };
    if (typeof m.id !== "string" || !m.id) err(manifest, 'Manifest needs a non-empty string "id".');
  } catch (e) {
    err(manifest, `Not valid JSON: ${(e as Error).message}`);
  }

  // Load + schema-check every collection, remembering where each id lives.
  const loaded = {} as Record<Exclude<CollectionKey, "history">, Map<string, { file: string; value: any }>>;
  for (const [key, schema] of Object.entries(SCHEMAS) as [Exclude<CollectionKey, "history">, z.ZodTypeAny][]) {
    const map = new Map<string, { file: string; value: any }>();
    loaded[key] = map;
    const dir = join(root, FORWARD_DIR, COLLECTIONS[key]);
    for (const name of jsonFiles(dir)) {
      const file = join(dir, name);
      const raw = readJson(file);
      if (raw instanceof Error) {
        err(file, `Not valid JSON: ${raw.message}`);
        continue;
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const i = parsed.error.issues[0];
        err(file, `Schema: ${i?.path.join(".") || "(root)"} — ${i?.message}`);
        continue;
      }
      const id = (parsed.data as { id: string }).id;
      if (`${fileNameForId(id)}.json` !== name) {
        err(file, `File name doesn't match its id "${id}" (expected ${fileNameForId(id)}.json).`);
      }
      const dup = map.get(id);
      if (dup) err(file, `Duplicate id "${id}" (also in ${rel(dup.file)}).`);
      map.set(id, { file, value: parsed.data });
    }
  }

  // Version history entries.
  const historyDir = join(root, FORWARD_DIR, COLLECTIONS.history);
  for (const sub of dirs(historyDir)) {
    for (const name of jsonFiles(join(historyDir, sub))) {
      const file = join(historyDir, sub, name);
      const raw = readJson(file);
      if (raw instanceof Error) err(file, `Not valid JSON: ${raw.message}`);
      else if (!VersionEntry.safeParse(raw).success) err(file, "Not a valid version entry.");
    }
  }

  // Soft references.
  const has = (key: Exclude<CollectionKey, "history">, id: string | null | undefined) =>
    !id || loaded[key].has(id);
  for (const { file, value: el } of loaded.elements.values()) {
    if (!has("elements", el.parentId)) warn(file, `parentId "${el.parentId}" not found.`);
    if (!has("elements", el.componentId)) warn(file, `componentId "${el.componentId}" not found.`);
  }
  for (const { file, value: e } of loaded.infraEdges.values()) {
    if (!has("infraNodes", e.from)) warn(file, `Edge source "${e.from}" not found.`);
    if (!has("infraNodes", e.to)) warn(file, `Edge target "${e.to}" not found.`);
  }
  for (const { file, value: f } of loaded.infraFlows.values()) {
    (f.steps as Array<{ from: string; to: string; endpointId?: string }>).forEach((s, i) => {
      if (!has("infraNodes", s.from)) warn(file, `Step ${i + 1}: node "${s.from}" not found.`);
      if (!has("infraNodes", s.to)) warn(file, `Step ${i + 1}: node "${s.to}" not found.`);
      if (!has("elements", s.endpointId)) warn(file, `Step ${i + 1}: endpoint element "${s.endpointId}" not found.`);
    });
  }
  for (const { file, value: r } of loaded.relations.values()) {
    if (!has("entities", r.from)) warn(file, `Relation source "${r.from}" not found.`);
    if (!has("entities", r.to)) warn(file, `Relation target "${r.to}" not found.`);
  }
  for (const { file, value: a } of loaded.agents.values()) {
    for (const s of a.mcpServerIds as string[]) {
      if (!has("servers", s)) warn(file, `MCP server "${s}" not found.`);
    }
  }
  for (const { file, value: t } of loaded.tasks.values()) {
    if (!has("elements", t.elementId)) warn(file, `Linked element "${t.elementId}" not found.`);
    if (!has("infraFlows", t.flowId)) warn(file, `Linked flow "${t.flowId}" not found.`);
    if (!has("elements", t.endpointId)) warn(file, `Linked endpoint "${t.endpointId}" not found.`);
    for (const d of t.dependsOn as string[]) {
      if (!has("tasks", d)) warn(file, `Dependency "${d}" not found.`);
    }
    if (t.dueDate?.trim() && parseTaskDay(t.dueDate) === null) {
      warn(file, `Due date "${t.dueDate}" isn't an ISO date (YYYY-MM-DD), so the timeline can't plot it.`);
    }
  }
  const tasks = [...loaded.tasks.values()];
  for (const cycle of findDependencyCycles(tasks.map((t) => t.value))) {
    const keys = cycle.map((id) => loaded.tasks.get(id)!.value.key || id);
    const path = [...keys, keys[0]].join(" → ");
    for (const id of cycle) warn(loaded.tasks.get(id)!.file, `Dependency cycle: ${path}.`);
  }
  return issues;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

function jsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function dirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
