import { readFile, appendFile } from "node:fs/promises";
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
 * Apply an AI-produced `forward-docs.json` to the repository's `.forward/`
 * project. This is the one deterministic step in the pipeline — the AI only
 * writes a plan. It:
 *
 *   1. no-ops cleanly when the plan is empty (a change with nothing to document);
 *   2. hydrates each content object with stable geometry + timestamps and
 *      re-validates it through the canonical schema before writing;
 *   3. writes nodes before the edges/flows/relations that reference them, and
 *      skips API bindings whose documentation is already up to date.
 *
 * Every write is a file change, so git is the undo: `git checkout -- .forward`
 * discards a partial or unwanted run. Returns a process exit code (0 =
 * everything applied, 1 = at least one write failed).
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

  console.error(`forward-docs: writing into ${cfg.repo}/.forward (git is the undo).`);

  // Existing state: geometry, so we update nodes in place and only grid-place
  // new ones. Fetch ONLY the layers this plan touches: a bindings-only merge (the common case)
  // reads nothing here and goes straight to the element read in step 6.
  const wantEntities = plan.entities.length > 0 || plan.entityRelations.length > 0;
  const wantInfra = plan.infraNodes.length > 0;
  const wantAgents = plan.mcpServers.length > 0 || plan.agents.length > 0;
  const [
    { entities: exEntities, relations: exRelations },
    { nodes: exNodes },
    { agents: exAgents, servers: exServers },
  ] = await Promise.all([
    wantEntities ? fetchEntities(cfg.api) : Promise.resolve({ entities: [], relations: [] }),
    wantInfra ? fetchInfra(cfg.api) : Promise.resolve({ nodes: [], edges: [] }),
    wantAgents ? fetchAgents(cfg.api) : Promise.resolve({ agents: [], servers: [] }),
  ]);
  const entityGeom = geomMap(exEntities);
  const nodeGeom = geomMap(exNodes);
  const agentGeom = geomMap(exAgents);
  const serverGeom = geomMap(exServers);

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

  await writeSummary(cfg, report);

  const skippedNote = report.skipped.length ? `, ${report.skipped.length} skipped` : "";
  if (report.failed.length) {
    console.error(
      `forward-docs: ${report.failed.length}/${total} write(s) failed${skippedNote}. ` +
        "Discard the partial write with `git checkout -- .forward` if needed.",
    );
    return 1;
  }
  console.error(`forward-docs: done — applied ${report.ok.length} item(s)${skippedNote}.`);
  return 0;
}

/** Append a Markdown summary to the GitHub Actions run, when running in one. */
async function writeSummary(cfg: CliConfig, report: Report): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = [
    `### Forward docs updated`,
    ``,
    `Project \`${cfg.api.projectId}\` · written to \`.forward/\` in the repository`,
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
