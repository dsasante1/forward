import { readFile, appendFile, writeFile } from "node:fs/promises";
import {
  AgentNode,
  Entity,
  EntityRelation,
  InfraEdge,
  InfraFlow,
  InfraNode,
  McpServerNode,
} from "forward-core";
import {
  bindApiToElement,
  createCheckpoint,
  fetchAgents,
  fetchElements,
  fetchEntities,
  fetchInfra,
  saveAgentNode,
  saveEntity,
  saveEntityRelation,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  saveMcpServer,
  unbindApiFromElement,
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
  /** Writes intentionally not made because the content was already up to date. */
  skipped: string[];
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
 *   2. captures recovery state first — a **checkpoint** (which the server scopes
 *      to design elements + the infra graph) plus, for the layers the checkpoint
 *      does NOT snapshot (ER entities/relations and the Agents/MCP layer), a
 *      `forward-docs.rollback.json` of their prior state that can be re-applied;
 *   3. hydrates each content object with stable geometry + timestamps and
 *      re-validates it through the canonical schema before writing;
 *   4. writes nodes before the edges/flows/relations that reference them, and
 *      skips API bindings whose documentation is already up to date.
 *
 * Returns a process exit code (0 = everything applied, 1 = at least one write
 * failed — the recovery pointers are printed so the operator can restore).
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
    plan.infraFlows.length +
    plan.mcpServers.length +
    plan.agents.length;

  if (total === 0) {
    console.error("forward-docs: plan is empty — nothing to document. Skipping.");
    return 0;
  }

  // 1. Recovery state BEFORE any write. The server-side checkpoint only
  // snapshots design elements + the infra graph, so it is the restore path for
  // those layers (and API bindings, which live on elements).
  const checkpoint = await createCheckpoint(cfg.api, {
    title: plan.checkpoint?.title ?? `Pre-CI docs ${cfg.commit || new Date().toISOString().slice(0, 10)}`,
    description:
      plan.checkpoint?.note ??
      "Automatic snapshot taken by forward-docs before applying CI-generated documentation.",
    tag: "checkpoint",
  });
  console.error(
    `forward-docs: checkpoint ${checkpoint.id} created (restores design + infra).`,
  );

  // 2. Existing state: geometry (so we update nodes in place and only grid-place
  // new ones) and — for the ER + Agents/MCP layers the checkpoint does NOT cover
  // — a prior-state snapshot we can write out as a re-appliable rollback.
  const [
    { entities: exEntities, relations: exRelations },
    { nodes: exNodes },
    { agents: exAgents, servers: exServers },
  ] = await Promise.all([
    fetchEntities(cfg.api),
    fetchInfra(cfg.api),
    fetchAgents(cfg.api),
  ]);
  const entityGeom = geomMap(exEntities);
  const nodeGeom = geomMap(exNodes);
  const agentGeom = geomMap(exAgents);
  const serverGeom = geomMap(exServers);

  // The layers the checkpoint can't restore. If this run touches any of them,
  // write their prior state so an operator can `forward-docs apply` it to revert
  // overwritten content. (Re-applying restores changed content; it does not
  // delete nodes this run newly created — remove those by hand if needed.)
  const touchesUncovered =
    plan.entities.length + plan.entityRelations.length + plan.mcpServers.length + plan.agents.length;
  if (touchesUncovered > 0) {
    const rollbackPath = process.env.FORWARD_ROLLBACK_PATH ?? "forward-docs.rollback.json";
    const rollback = {
      version: 1,
      note: `Prior state of the ER + Agents/MCP layers before applying to project ${cfg.api.projectId} at ${cfg.commit || "unknown commit"}. Re-apply with: forward-docs apply ${rollbackPath}`,
      entities: exEntities,
      entityRelations: exRelations,
      mcpServers: exServers,
      agents: exAgents,
    };
    await writeFile(rollbackPath, `${JSON.stringify(rollback, null, 2)}\n`).catch((e) =>
      console.error(`forward-docs: could not write rollback file: ${msg(e)}`),
    );
    console.error(`forward-docs: wrote ${rollbackPath} (re-appliable rollback for ER + Agents/MCP).`);
  }
  const entityPlacer = new GridPlacer(entityGeom.values());
  const nodePlacer = new GridPlacer(nodeGeom.values());
  // Agents + MCP servers share one overlay, so one placer seeded with both keeps
  // newly-placed boxes from colliding across the two node types.
  const agentPlacer = new GridPlacer([...serverGeom.values(), ...agentGeom.values()]);

  const now = () => new Date().toISOString();
  const report: Report = { ok: [], skipped: [], failed: [] };
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

  // 5. MCP servers, then the agents that wire to them (pillar 8).
  for (const s of plan.mcpServers) {
    const g = agentPlacer.place(s, serverGeom.get(s.id), 200, 96);
    const server = McpServerNode.parse({ ...s, ...g, updatedAt: now() });
    await run("mcp-server", s.id, () => saveMcpServer(cfg.api, server), report);
  }
  for (const a of plan.agents) {
    const g = agentPlacer.place(a, agentGeom.get(a.id), 200, 96);
    const agent = AgentNode.parse({ ...a, ...g, updatedAt: now() });
    await run("agent", a.id, () => saveAgentNode(cfg.api, agent), report);
  }

  // 6. API bindings (independent of the graph layers). Read current bindings once
  // so a re-run that changes nothing appends no duplicate history entry, and a
  // "deleted" action actually removes the binding instead of upserting it.
  if (plan.bindings.length) {
    const elements = await fetchElements(cfg.api);
    const currentBinding = new Map(elements.map((el) => [el.id, el.apiBinding]));

    for (const b of plan.bindings) {
      const current = currentBinding.get(b.elementId);
      const version: VersionInput = {
        version: b.version ?? defaultVersion,
        author: "forward-docs",
        changeLog: b.changeLog ?? defaultLog,
        action: b.action ?? "modified",
        endpoint: { title: b.title },
      };

      if (b.action === "deleted") {
        if (!current) {
          report.skipped.push(`binding ${b.elementId} (already absent)`);
          console.error(`  = binding ${b.elementId} (already absent, skipped)`);
          continue;
        }
        await run(
          "binding",
          b.elementId,
          () => unbindApiFromElement(cfg.api, b.elementId, version),
          report,
        );
        continue;
      }

      if (
        current &&
        current.title === b.title &&
        (current.description ?? "") === (b.description ?? "")
      ) {
        report.skipped.push(`binding ${b.elementId} (unchanged)`);
        console.error(`  = binding ${b.elementId} (unchanged, skipped)`);
        continue;
      }

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
  }

  await writeSummary(cfg, checkpoint.id, report);

  const skippedNote = report.skipped.length ? `, ${report.skipped.length} skipped` : "";
  if (report.failed.length) {
    console.error(
      `forward-docs: ${report.failed.length}/${total} write(s) failed${skippedNote}. ` +
        `Restore checkpoint ${checkpoint.id} (design + infra)` +
        (touchesUncovered > 0 ? " and re-apply the rollback file (ER + Agents/MCP)" : "") +
        ` if the canvas is inconsistent.`,
    );
    return 1;
  }
  console.error(`forward-docs: done — applied ${report.ok.length} item(s)${skippedNote}.`);
  return 0;
}

/** Append a Markdown summary to the GitHub Actions run, when running in one. */
async function writeSummary(cfg: CliConfig, checkpointId: string, report: Report): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = [
    `### Forward docs updated`,
    ``,
    `Project \`${cfg.api.projectId}\` · checkpoint \`${checkpointId}\` (restores design + infra)`,
    ``,
    `- ✅ applied: **${report.ok.length}**`,
    `- ⏭️ skipped (already up to date): **${report.skipped.length}**`,
    `- ❌ failed: **${report.failed.length}**`,
  ];
  if (report.failed.length) {
    lines.push(``, `<details><summary>Failures</summary>`, ``);
    for (const f of report.failed) lines.push(`- \`${f.item}\` — ${f.error}`);
    lines.push(``, `</details>`);
  }
  await appendFile(file, `${lines.join("\n")}\n`).catch(() => {});
}
