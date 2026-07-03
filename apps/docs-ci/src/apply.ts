import { readFile, appendFile } from "node:fs/promises";
import {
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
} from "forward-core";
import {
  bindApiToElement,
  createCheckpoint,
  fetchEntities,
  fetchInfra,
  saveEntity,
  saveEntityRelation,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  type VersionInput,
} from "forward-core/api";
import { loadConfig, type CliConfig } from "./config.js";
import { GridPlacer, type Geom } from "./layout.js";
import { Plan } from "./plan.js";

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A tiny report so a partial failure still tells the operator exactly what landed. */
interface Report {
  ok: string[];
  failed: { item: string; error: string }[];
}

type Positioned = { id: string } & Geom;

function geomMap(nodes: readonly Positioned[]): Map<string, Geom> {
  const m = new Map<string, Geom>();
  for (const n of nodes) {
    m.set(n.id, { x: n.x, y: n.y, width: n.width, height: n.height, parentId: n.parentId });
  }
  return m;
}

async function run(
  kind: string,
  id: string,
  fn: () => Promise<void>,
  report: Report,
): Promise<void> {
  try {
    await fn();
    report.ok.push(`${kind} ${id}`);
    console.error(`  ✓ ${kind} ${id}`);
  } catch (e) {
    report.failed.push({ item: `${kind} ${id}`, error: msg(e) });
    console.error(`  ✗ ${kind} ${id} — ${msg(e)}`);
  }
}

/**
 * Apply an AI-produced `forward-docs.json` to a Forward project. This is the one
 * deterministic, credentialed step in the pipeline — the AI never touches the
 * token or the API. It:
 *
 *   1. no-ops cleanly when the plan is empty (a merge with nothing to document);
 *   2. takes a **checkpoint first** so any run is one restore away from undo;
 *   3. hydrates each content object with stable geometry + timestamps and
 *      re-validates it through the canonical schema before writing;
 *   4. writes nodes before the edges/flows/relations that reference them.
 *
 * Returns a process exit code (0 = everything applied, 1 = at least one write
 * failed — the checkpoint id is printed so the operator can restore).
 */
export async function apply(planPath: string): Promise<number> {
  const cfg = loadConfig();

  let plan: Plan;
  try {
    plan = Plan.parse(JSON.parse(await readFile(planPath, "utf8")));
  } catch (e) {
    console.error(`Could not read/validate ${planPath}: ${msg(e)}`);
    return 1;
  }

  const total =
    plan.bindings.length +
    plan.entities.length +
    plan.entityRelations.length +
    plan.infraNodes.length +
    plan.infraEdges.length +
    plan.infraFlows.length;

  if (total === 0) {
    console.error("forward-docs: plan is empty — nothing to document. Skipping.");
    return 0;
  }

  // 1. Safety net BEFORE any write.
  const checkpoint = await createCheckpoint(cfg.api, {
    title: plan.checkpoint?.title ?? `Pre-CI docs ${cfg.commit || new Date().toISOString().slice(0, 10)}`,
    description:
      plan.checkpoint?.note ??
      "Automatic snapshot taken by forward-docs before applying CI-generated documentation.",
    tag: "checkpoint",
  });
  console.error(`forward-docs: checkpoint ${checkpoint.id} created (restore point).`);

  // 2. Existing geometry, so we update nodes in place and only grid-place new ones.
  const [{ entities: exEntities }, { nodes: exNodes }] = await Promise.all([
    fetchEntities(cfg.api),
    fetchInfra(cfg.api),
  ]);
  const entityGeom = geomMap(exEntities);
  const nodeGeom = geomMap(exNodes);
  const entityPlacer = new GridPlacer(entityGeom.values());
  const nodePlacer = new GridPlacer(nodeGeom.values());

  const now = () => new Date().toISOString();
  const report: Report = { ok: [], failed: [] };
  const defaultVersion = cfg.commit ? `ci-${cfg.commit}` : now().slice(0, 10);
  const defaultLog = cfg.commitMessage || "Documented via CI";

  // 3. Entities, then the relations that reference them.
  for (const e of plan.entities) {
    const g = entityPlacer.place(e, entityGeom.get(e.id), 180, 120);
    const entity = Entity.parse({ ...e, ...g, updatedAt: now() });
    await run("entity", e.id, () => saveEntity(cfg.api, entity), report);
  }
  for (const r of plan.entityRelations) {
    const relation = EntityRelation.parse({ ...r, updatedAt: now() });
    await run("relation", r.id, () => saveEntityRelation(cfg.api, relation), report);
  }

  // 4. Infra nodes, then edges + flows that reference them.
  for (const n of plan.infraNodes) {
    const g = nodePlacer.place(n, nodeGeom.get(n.id), 160, 72);
    const node = InfraNode.parse({ ...n, ...g, updatedAt: now() });
    await run("infra-node", n.id, () => saveInfraNode(cfg.api, node), report);
  }
  for (const e of plan.infraEdges) {
    const edge = InfraEdge.parse({ ...e, updatedAt: now() });
    await run("infra-edge", e.id, () => saveInfraEdge(cfg.api, edge), report);
  }
  for (const f of plan.infraFlows) {
    const flow = InfraFlow.parse({ ...f, updatedAt: now() });
    await run("infra-flow", f.id, () => saveInfraFlow(cfg.api, flow), report);
  }

  // 5. API bindings (independent of the graph layers).
  for (const b of plan.bindings) {
    const version: VersionInput = {
      version: b.version ?? defaultVersion,
      author: "forward-docs",
      changeLog: b.changeLog ?? defaultLog,
      action: b.action ?? "modified",
    };
    await run(
      "binding",
      b.elementId,
      () =>
        bindApiToElement(
          cfg.api,
          b.elementId,
          { title: b.title, description: b.description },
          version,
        ),
      report,
    );
  }

  await writeSummary(cfg, checkpoint.id, report);

  if (report.failed.length) {
    console.error(
      `forward-docs: ${report.failed.length}/${total} write(s) failed. ` +
        `Restore checkpoint ${checkpoint.id} if the canvas is inconsistent.`,
    );
    return 1;
  }
  console.error(`forward-docs: applied ${report.ok.length} item(s) successfully.`);
  return 0;
}

/** Append a Markdown summary to the GitHub Actions run, when running in one. */
async function writeSummary(cfg: CliConfig, checkpointId: string, report: Report): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = [
    `### Forward docs updated`,
    ``,
    `Project \`${cfg.api.projectId}\` · checkpoint \`${checkpointId}\` (restore point)`,
    ``,
    `- ✅ applied: **${report.ok.length}**`,
    `- ❌ failed: **${report.failed.length}**`,
  ];
  if (report.failed.length) {
    lines.push(``, `<details><summary>Failures</summary>`, ``);
    for (const f of report.failed) lines.push(`- \`${f.item}\` — ${f.error}`);
    lines.push(``, `</details>`);
  }
  await appendFile(file, `${lines.join("\n")}\n`).catch(() => {});
}
