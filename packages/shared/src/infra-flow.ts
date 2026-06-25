import type {
  InfraEdge,
  InfraNode,
  InfraFlow,
  InfraStepKind,
  InfraKind,
} from "./schema.js";

/**
 * The export/print renderers for the infrastructure layer, both in UML via
 * Mermaid. UML splits into two diagram families and so do these:
 *
 *   • a *flow* → a UML **sequence diagram** (behavioural): how the nodes interact
 *     over time to complete a process — `flowToMermaid`.
 *   • the *graph* → a UML **component diagram** (structural): the components that
 *     make up the system and the dependencies between them — `infraToComponentMermaid`.
 *
 * Both are pure functions of the same single source of truth (the InfraFlow steps
 * / the InfraNode + InfraEdge graph) the on-canvas SVG overlay draws from, so no
 * state is duplicated — the overlay and these UML exports are two views of one model.
 */

/** Mermaid sequence-message token per call style (see InfraStepKind). */
const ARROW: Record<InfraStepKind, string> = {
  sync: "->>", // synchronous call — a solid arrowhead in UML
  async: "-)", // asynchronous / fire-and-forget — an open arrowhead
  reply: "-->>", // return message — a dashed line in UML
};

/**
 * Kinds that sit on the edge of the system act as UML *actors* (the stick figure)
 * rather than internal lifelines: the user-facing client and third-party services.
 */
const ACTOR_KINDS = new Set<InfraNode["kind"]>(["frontend", "external"]);

/**
 * Mermaid forbids a bare label after the colon containing a newline, and aliases
 * must be simple. Collapse newlines and trim so the diagram stays valid whatever
 * a node label or step text holds.
 */
function clean(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Escape a user-supplied label for inclusion in Mermaid source. The canvas
 * renders these diagrams with `securityLevel: "loose"` (needed for the
 * «component» stereotype `<br/>`), which means Mermaid emits label HTML
 * verbatim — so a raw `<` in a node label or step text is a stored-XSS vector.
 * Entity-escape the HTML-significant characters (Mermaid decodes them back to
 * literal text on render) after collapsing newlines. `&` must go first so the
 * entities we introduce aren't themselves re-escaped.
 */
function escapeLabel(s: string): string {
  return clean(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialise a flow to a UML **sequence diagram** (Mermaid `sequenceDiagram`).
 * Each node becomes a lifeline declared in first-seen order under its human
 * label; client/third-party nodes are declared as UML `actor`s, internal nodes
 * as `participant`s. Messages are numbered to match the on-canvas overlay, use
 * the per-kind arrow (sync/async/return), and append a step's `endpointId` when
 * present. Steps referencing a node not in the map are skipped — the same
 * "skip dangling" rule the overlay uses.
 */
export function flowToMermaid(
  flow: InfraFlow,
  nodes: Map<string, InfraNode>,
): string {
  const lines = ["sequenceDiagram"];
  const aliases = new Map<string, string>();
  let nextAlias = 0;

  // Stable, Mermaid-safe lifeline alias for a node id, declared on first use.
  const alias = (id: string): string | null => {
    const node = nodes.get(id);
    if (!node) return null;
    let a = aliases.get(id);
    if (!a) {
      a = `N${nextAlias++}`;
      aliases.set(id, a);
      const keyword = ACTOR_KINDS.has(node.kind) ? "actor" : "participant";
      lines.push(`    ${keyword} ${a} as ${escapeLabel(node.label)}`);
    }
    return a;
  };

  // Declare lifelines in the order steps first reference them.
  for (const step of flow.steps) {
    alias(step.from);
    alias(step.to);
  }

  flow.steps.forEach((step, i) => {
    const from = aliases.get(step.from);
    const to = aliases.get(step.to);
    if (!from || !to) return; // dangling node — skip, mirroring the overlay
    const arrow = ARROW[step.kind];
    const label = escapeLabel(step.label) || "—";
    const suffix = step.endpointId ? ` (${escapeLabel(step.endpointId)})` : "";
    lines.push(`    ${from}${arrow}${to}: ${i + 1}. ${label}${suffix}`);
  });

  return lines.join("\n");
}

/**
 * Serialise the infrastructure graph to a UML **component diagram** (rendered as
 * a Mermaid `flowchart`). Every node is a UML component — a box carrying the
 * «component» stereotype, its label, and its kind — and every edge is a
 * dependency arrow (optionally labelled with the interface it uses, e.g.
 * "reads/writes"). A `group` node becomes a UML package/subsystem boundary
 * (a Mermaid subgraph) holding the nodes nested in it by `parentId`. Edges to or
 * from a node missing from the list are skipped.
 */
export function infraToComponentMermaid(
  nodes: InfraNode[],
  edges: InfraEdge[],
): string {
  const lines = ["flowchart LR"];
  const alias = new Map<string, string>();
  nodes.forEach((n, i) => {
    alias.set(n.id, `C${i}`);
  });

  // A component box: the «component» stereotype over its label and kind.
  const decl = (n: InfraNode): string =>
    `${alias.get(n.id)}["«component»<br/>${escapeLabel(n.label)}<br/>[${n.kind}]"]`;

  // `group` nodes are subsystem boundaries — a subgraph around their children.
  const placed = new Set<string>();
  for (const g of nodes) {
    if (g.kind !== "group") continue;
    const children = nodes.filter((n) => n.parentId === g.id && n.id !== g.id);
    if (!children.length) continue; // empty group: render as a plain component below
    lines.push(`  subgraph ${alias.get(g.id)}["«subsystem»<br/>${escapeLabel(g.label)}"]`);
    for (const c of children) {
      lines.push(`    ${decl(c)}`);
      placed.add(c.id);
    }
    lines.push("  end");
    placed.add(g.id);
  }

  // Every remaining node as a top-level component.
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    lines.push(`  ${decl(n)}`);
  }

  // Dependencies: one directed arrow per edge, labelled with its interface.
  for (const e of edges) {
    const a = alias.get(e.from);
    const b = alias.get(e.to);
    if (!a || !b) continue;
    const label = e.label ? `|"${escapeLabel(e.label)}"|` : "";
    lines.push(`  ${a} -->${label} ${b}`);
  }

  return lines.join("\n");
}

/**
 * The named lenses over the single infra graph. One model, several framings —
 * each view is just a set of node kinds to keep, so the same nodes + edges render
 * as a different diagram:
 *
 *   • `architecture`   — the whole system at a glance (every kind). The §1
 *     high-level architecture diagram.
 *   • `infrastructure` — the runtime/DevOps substrate and the stores/queues/SaaS
 *     it wires to, dropping the app's internal frontend/service boxes. The §2
 *     infrastructure dependency diagram.
 *   • `modules`        — only the internal code units (the app servers and
 *     services), i.e. the module/dependency graph. The §4 dependency graph.
 *
 * `group` is in every view: it's a structural container, kept only while it still
 * has a surviving child (see `filterInfraGraph`).
 */
export type InfraView = "architecture" | "infrastructure" | "modules";

export const INFRA_VIEW_KINDS: Record<InfraView, InfraKind[]> = {
  architecture: [
    "frontend",
    "backend",
    "database",
    "cache",
    "queue",
    "service",
    "devops",
    "external",
    "group",
  ],
  infrastructure: [
    "backend",
    "database",
    "cache",
    "queue",
    "devops",
    "external",
    "group",
  ],
  modules: ["backend", "service", "group"],
};

/**
 * Project the full infra graph down to a single `InfraView`: keep nodes whose
 * kind is in the view, then drop any `group` container the filter left empty (no
 * surviving non-group child) — matching `infraToComponentMermaid`, which renders
 * a childless group as a plain box rather than an empty subsystem. Edges are kept
 * only when both ends survive. Pure, non-mutating; returns fresh arrays.
 */
export function filterInfraGraph(
  nodes: InfraNode[],
  edges: InfraEdge[],
  view: InfraView,
): { nodes: InfraNode[]; edges: InfraEdge[] } {
  const kinds = new Set(INFRA_VIEW_KINDS[view]);
  const byKind = nodes.filter((n) => kinds.has(n.kind));
  const survived = new Set(byKind.map((n) => n.id));

  const kept = byKind.filter((n) => {
    if (n.kind !== "group") return true;
    // Keep the group only if a non-group child of it survived the kind filter.
    return nodes.some(
      (c) =>
        c.parentId === n.id &&
        c.id !== n.id &&
        c.kind !== "group" &&
        survived.has(c.id),
    );
  });

  const ids = new Set(kept.map((n) => n.id));
  const keptEdges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes: kept, edges: keptEdges };
}

/**
 * Convenience: filter the infra graph to a view and serialise it to the UML
 * component diagram in one step — the §1/§2/§4 diagrams as three framings of one
 * model. Equivalent to `infraToComponentMermaid(filterInfraGraph(...))`.
 */
export function infraViewToMermaid(
  nodes: InfraNode[],
  edges: InfraEdge[],
  view: InfraView,
): string {
  const f = filterInfraGraph(nodes, edges, view);
  return infraToComponentMermaid(f.nodes, f.edges);
}
