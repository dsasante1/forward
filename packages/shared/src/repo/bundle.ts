/// <reference types="node" />
import { diffBindings } from "../api-diff.js";
import type {
  AgentNode,
  Checkpoint,
  DesignElement,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  McpServerNode,
  ProjectTimelineEvent,
  Task,
  VersionDiff,
  VersionEntry,
} from "../schema.js";
import { projectTimeline } from "./git.js";
import { RepoStore } from "./store.js";

/**
 * A whole project in one JSON document. `forward export` writes it next to
 * the static canvas so GitHub Pages can render the project read-only, and the
 * PR digest compares two of them (base vs head).
 */
export interface ProjectBundle {
  format: 1;
  project: { id: string; name: string };
  generatedAt: string;
  elements: DesignElement[];
  timelines: Record<string, VersionEntry[]>;
  infra: { nodes: InfraNode[]; edges: InfraEdge[]; flows: InfraFlow[] };
  entities: { entities: Entity[]; relations: EntityRelation[] };
  agents: { agents: AgentNode[]; servers: McpServerNode[] };
  tasks: Task[];
  checkpoints: Checkpoint[];
  timeline: ProjectTimelineEvent[];
}

export function loadBundle(root: string, opts: { timeline?: boolean } = {}): ProjectBundle {
  const store = new RepoStore(root);
  const manifest = store.manifest();
  const infra = store.infra();
  return {
    format: 1,
    project: { id: manifest.id, name: manifest.name },
    generatedAt: new Date().toISOString(),
    elements: store.listElements(),
    timelines: store.timelines(),
    infra: { nodes: infra.nodes, edges: infra.edges, flows: infra.flows },
    entities: { entities: infra.entities, relations: infra.relations },
    agents: store.agents(),
    tasks: store.listTasks(),
    checkpoints: store.listCheckpoints(),
    timeline: opts.timeline === false ? [] : projectTimeline(root),
  };
}

// --------------------------------------------------------------------------
// Project diff + catch-up digest (what a PR changed, for humans and agents)
// --------------------------------------------------------------------------

export interface EndpointChange {
  elementId: string;
  title: string;
  /** Latest version label recorded in this change, if any. */
  version?: string;
  /** Change logs of the history entries added in this change, oldest first. */
  changeLogs: string[];
  breaking?: string;
  diff?: VersionDiff;
}

export interface LayerChange {
  layer: string;
  added: string[];
  modified: string[];
  removed: string[];
}

export interface ProjectDiff {
  api: { toIntegrate: EndpointChange[]; toModify: EndpointChange[]; toRemove: EndpointChange[] };
  layers: LayerChange[];
  /**
   * Drafts generated from code that were adopted (their `origin` removed):
   * the design, not the code, is now the source of truth for them. Kept out
   * of the per-element changes above, where it would only be noise.
   */
  adopted: string[];
}

type Named = { id: string; name?: string; label?: string; title?: string; key?: string };

/** Compare two project states. `before` may be undefined (a new project). */
export function diffProjects(before: ProjectBundle | undefined, after: ProjectBundle): ProjectDiff {
  const prevEls = byId(before?.elements ?? []);
  const nextEls = byId(after.elements);
  const api: ProjectDiff["api"] = { toIntegrate: [], toModify: [], toRemove: [] };

  const ids = new Set([...prevEls.keys(), ...nextEls.keys()]);
  for (const id of ids) {
    const a = prevEls.get(id)?.apiBinding;
    const b = nextEls.get(id)?.apiBinding;
    // History is append-only, but merges can interleave entries from two
    // branches, so match entries by content rather than by position.
    const seen = new Set((before?.timelines[id] ?? []).map(entryKey));
    const added = (after.timelines[id] ?? []).filter((e) => !seen.has(entryKey(e)));
    const base = {
      elementId: id,
      version: added.at(-1)?.version || undefined,
      changeLogs: added.map((e) => e.changeLog).filter(Boolean),
      breaking: added.map((e) => e.diff?.breaking).filter(Boolean).at(-1),
    };
    if (!a && b) api.toIntegrate.push({ ...base, title: b.title, diff: diffBindings(undefined, b) });
    else if (a && !b) api.toRemove.push({ ...base, title: a.title, diff: diffBindings(a, undefined) });
    else if (a && b && (a.title !== b.title || a.description !== b.description)) {
      api.toModify.push({ ...base, title: b.title, diff: diffBindings(a, b) });
    }
  }

  const layers: LayerChange[] = [
    // `origin` is provenance: adopting a generated draft is not a design change.
    layerDiff("Design elements", before?.elements, after.elements, ["apiBinding", "origin"]),
    layerDiff("Infra nodes", before?.infra.nodes, after.infra.nodes),
    layerDiff("Infra edges", before?.infra.edges, after.infra.edges),
    layerDiff("Flows", before?.infra.flows, after.infra.flows),
    layerDiff("Entities", before?.entities.entities, after.entities.entities),
    layerDiff("Relations", before?.entities.relations, after.entities.relations),
    layerDiff("Agents", before?.agents.agents, after.agents.agents),
    layerDiff("MCP servers", before?.agents.servers, after.agents.servers),
    layerDiff("Tasks", before?.tasks, after.tasks),
  ].filter((l) => l.added.length + l.modified.length + l.removed.length > 0);

  const adopted = after.elements
    .filter((e) => !e.origin && prevEls.get(e.id)?.origin)
    .map((e) => label(e));

  return { api, layers, adopted };
}

function entryKey(e: VersionEntry): string {
  return `${e.timestamp}|${e.version}|${e.author}|${e.changeLog}`;
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

function label(x: Named): string {
  const name = x.key ? `${x.key} ${x.title ?? ""}`.trim() : x.name || x.label || x.title;
  return name ? `${name} (${x.id})` : x.id;
}

/** Records compared without volatile fields (timestamps, plus any `ignore`). */
function comparable(x: object, ignore: string[]): string {
  const { updatedAt: _u, ...rest } = x as Record<string, unknown>;
  for (const k of ignore) delete rest[k];
  return JSON.stringify(rest);
}

function layerDiff<T extends Named>(
  layer: string,
  before: T[] | undefined,
  after: T[],
  ignore: string[] = [],
): LayerChange {
  const prev = byId(before ?? []);
  const next = byId(after);
  const out: LayerChange = { layer, added: [], modified: [], removed: [] };
  for (const [id, b] of next) {
    const a = prev.get(id);
    if (!a) out.added.push(label(b));
    else if (comparable(a, ignore) !== comparable(b, ignore)) out.modified.push(label(b));
  }
  for (const [id, a] of prev) if (!next.has(id)) out.removed.push(label(a));
  return out;
}

/** Hidden marker so a CI job can find and update its own PR comment. */
export const DIGEST_MARKER = "<!-- forward-digest -->";

/** Render a {@link ProjectDiff} as the Markdown catch-up digest for a PR. */
export function renderDiffMarkdown(diff: ProjectDiff, opts: { title?: string; viewerUrl?: string } = {}): string {
  const { toIntegrate, toModify, toRemove } = diff.api;
  const lines: string[] = [DIGEST_MARKER, `## ${opts.title ?? "Forward catch-up"}`, ""];
  const empty =
    !toIntegrate.length && !toModify.length && !toRemove.length && !diff.layers.length && !diff.adopted.length;
  if (empty) {
    lines.push("No changes to the design, API docs, infrastructure or data model.");
    return lines.join("\n") + "\n";
  }

  lines.push(
    `**API docs:** ${toIntegrate.length} new · ${toModify.length} changed · ${toRemove.length} removed`,
    "",
  );
  const section = (heading: string, items: EndpointChange[]) => {
    if (!items.length) return;
    lines.push(`### ${heading}`, "");
    for (const c of items) {
      const version = c.version ? ` · ${c.version}` : "";
      const counts = c.diff ? ` · +${c.diff.added} −${c.diff.removed}` : "";
      lines.push(`- **${escapeMd(c.title)}** \`${c.elementId}\`${version}${counts}`);
      if (c.breaking) lines.push(`  - ⚠️ **Breaking:** ${escapeMd(c.breaking)}`);
      for (const log of c.changeLogs) lines.push(`  - ${escapeMd(firstLine(log))}`);
      const body = c.diff ? diffBlock(c.diff) : "";
      if (body) {
        lines.push("", "  <details><summary>Doc diff</summary>", "", "  ```diff");
        for (const l of body.split("\n")) lines.push(`  ${l}`);
        lines.push("  ```", "", "  </details>");
      }
    }
    lines.push("");
  };
  section("New endpoints — integrate", toIntegrate);
  section("Changed endpoints — modify", toModify);
  section("Removed endpoints — remove", toRemove);

  if (diff.layers.length) {
    lines.push("### Other layers", "", "| Layer | Added | Changed | Removed |", "|---|---|---|---|");
    for (const l of diff.layers) {
      lines.push(`| ${l.layer} | ${cell(l.added)} | ${cell(l.modified)} | ${cell(l.removed)} |`);
    }
    lines.push("");
  }
  if (diff.adopted.length) {
    // Names come from page content: a code span keeps links and @mentions inert.
    const shown = diff.adopted.slice(0, 10).map((a) => `\`${a.replace(/[`\r\n]/g, "'")}\``).join(", ");
    const more = diff.adopted.length > 10 ? ` and ${diff.adopted.length - 10} more` : "";
    lines.push(
      `**Adopted from code:** ${diff.adopted.length} element${diff.adopted.length === 1 ? "" : "s"} — ${shown}${more}. ` +
        "The design is now the source of truth for them; code imports no longer update them.",
      "",
    );
  }
  if (opts.viewerUrl) lines.push(`[Open the canvas](${opts.viewerUrl})`, "");
  return lines.join("\n");
}

function diffBlock(diff: VersionDiff): string {
  const out: string[] = [];
  for (const sec of diff.sections) {
    out.push(`@@ ${sec.label} @@`);
    for (const row of sec.rows) {
      const sign = row.op === "added" ? "+" : row.op === "removed" ? "-" : " ";
      out.push(`${sign} ${row.cols.join("  ")}`);
    }
  }
  return out.join("\n");
}

function cell(items: string[]): string {
  if (!items.length) return "–";
  const shown = items.slice(0, 5).map(escapeMd).join(", ");
  return items.length > 5 ? `${items.length}: ${shown}, …` : `${items.length}: ${shown}`;
}

function firstLine(s: string): string {
  return s.split("\n")[0] ?? "";
}

function escapeMd(s: string): string {
  return s.replace(/[|<>]/g, (c) => `\\${c}`);
}
