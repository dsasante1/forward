import type { AgentNode, McpServerNode } from "./schema.js";

/**
 * The export/print renderer for the Agent / MCP layer, in UML via Mermaid — the
 * structural twin of `infraToComponentMermaid`. The single model (agent nodes +
 * MCP server nodes, wired by `agentNode.mcpServerIds` and, per tool, an optional
 * `endpointId`) renders as one **component/wiring diagram**: agents depend on the
 * MCP servers they call, and each server fans out to its tools; a tool that wraps
 * a documented endpoint carries that endpoint id on its arrow. Pure function of
 * the same source of truth the on-canvas overlay draws from, so no state is
 * duplicated — overlay and this UML export are two views of one model.
 */

/**
 * Collapse newlines and trim so a label never breaks Mermaid (which forbids a
 * newline in a bare post-colon label). Mirrors infra-flow.ts `clean`.
 */
function clean(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Entity-escape the HTML-significant characters in a user-supplied label. The
 * canvas renders Mermaid with `securityLevel: "loose"`, so raw `<` in a label is
 * a stored-XSS vector; escape it (Mermaid decodes back to literal text). `&`
 * first so the entities we introduce aren't re-escaped. Mirrors infra-flow.ts.
 */
function escapeLabel(s: string): string {
  return clean(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialise the agent/MCP graph to a UML **component diagram** (rendered as a
 * Mermaid `flowchart`). Every agent is an «agent» component and every MCP server
 * an «mcp» component tagged with its transport; an agent → server dependency
 * arrow is drawn for each id in `agentNode.mcpServerIds` that resolves. Each
 * server's tools hang off it as small nodes, and a tool that wraps an endpoint
 * labels its arrow with the `endpointId`. Wiring to a missing server id is
 * skipped — the same "skip dangling" rule the infra serializer uses.
 */
export function agentsToComponentMermaid(
  agents: AgentNode[],
  servers: McpServerNode[],
): string {
  const lines = ["flowchart LR"];
  const agentAlias = new Map<string, string>();
  const serverAlias = new Map<string, string>();
  agents.forEach((a, i) => agentAlias.set(a.id, `A${i}`));
  servers.forEach((s, i) => serverAlias.set(s.id, `S${i}`));

  // Agent components — «agent» stereotype over label + model.
  for (const a of agents) {
    const model = a.model ? `<br/>[${escapeLabel(a.model)}]` : "";
    lines.push(
      `  ${agentAlias.get(a.id)}["«agent»<br/>${escapeLabel(a.label)}${model}"]`,
    );
  }

  // MCP server components — «mcp» stereotype over label + transport — plus a
  // small node per exposed tool wired from its server.
  for (const s of servers) {
    const sa = serverAlias.get(s.id)!;
    lines.push(
      `  ${sa}["«mcp»<br/>${escapeLabel(s.label)}<br/>[${s.transport}]"]`,
    );
    s.tools.forEach((t, ti) => {
      const ta = `${sa}T${ti}`;
      lines.push(`  ${ta}(["${escapeLabel(t.name)}"])`);
      const ep = t.endpointId ? `|"${escapeLabel(t.endpointId)}"|` : "";
      lines.push(`  ${sa} -->${ep} ${ta}`);
    });
  }

  // Agent → MCP server dependencies. Skip ids that don't resolve to a server.
  for (const a of agents) {
    const aa = agentAlias.get(a.id)!;
    for (const sid of a.mcpServerIds) {
      const sa = serverAlias.get(sid);
      if (!sa) continue;
      lines.push(`  ${aa} -->|"uses"| ${sa}`);
    }
  }

  return lines.join("\n");
}
