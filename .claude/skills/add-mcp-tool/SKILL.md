---
name: add-mcp-tool
description: Adds or edits a tool in the Forward MCP server (apps/mcp/src/server.ts) following the existing registerTool + Zod-shape pattern, keeping AI-agent capabilities at parity with the canvas and extension. Use when exposing a new capability to agents — e.g. "add an MCP tool", "expose X to the agent", "new registerTool", "the MCP server should be able to...". Do NOT use for editing the data contract itself (use schema-change) or for canvas/extension UI work.
metadata:
  version: 1.0.0
---

# Adding an MCP tool

The MCP server ([apps/mcp/src/server.ts](../../../apps/mcp/src/server.ts)) is the AI-native
surface: it must stay at **parity** with the canvas and extension — any data pillar a human
can touch (design elements, API bindings, infra graph, flows, timeline, project members) an
agent can too. New canvas/extension capabilities usually need a matching tool here.

## Pattern (follow the existing tools exactly)

Tools are registered with `server.registerTool(name, config, handler)`. Reuse the shared
Zod schema shapes for inputs rather than redeclaring them:

```ts
server.registerTool(
  "create_element",
  {
    title: "Create a design element",
    description: "...one or two sentences of agent-facing guidance, incl. when NOT to use it...",
    inputSchema: {
      // prefer Foo.shape.bar.describe(...) so inputs track the contract
      type: DesignElement.shape.type.describe("frame, rectangle, text, component, or instance."),
      x: z.number().describe("Canvas x (top-left)."),
      // ...
    },
  },
  async ({ x, ...fields }) => {
    try {
      // ...do work via forward-core helpers (saveElement, saveInfraNode, ...)
      return ok({ id, action: "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);
```

## Rules

- **Import data helpers from `forward-core`**, not raw Firebase calls — `saveElement`,
  `patchElement`, `bindApiToElement`, `saveInfraNode`, `saveInfraFlow`, `fetchElements`,
  `digest`, `listMembers`, etc. are all already exported. Add to the contract first via the
  [[schema-change]] workflow if a helper is missing.
- **Validate with the Zod schema** before writing (`DesignElement.parse({...})`) — never
  trust agent input.
- **Use the existing `ok(...)` / `fail(...)`** result helpers and the `getConfig()` /
  `genId(prefix)` utilities defined near the top of the file; match their style.
- **Write a description that guides the agent**, including when *not* to act (see how
  `create_element` tells the agent to prefer documenting existing elements). This is the
  agent's only instruction surface.
- **Cover logic in tests.** Pure helpers live in [match.ts](../../../apps/mcp/src/match.ts) /
  [anchor.ts](../../../apps/mcp/src/anchor.ts) with colocated `*.test.ts` — put testable
  logic there rather than inline in the handler.

## Verify

```bash
npm run build -w apps/mcp        # tsc
npm test -w apps/mcp
npm run typecheck -w apps/mcp
```

Then confirm the README's "Using with AI tools (MCP)" capability list still describes
reality — update it if you added a new pillar of functionality. The agent-facing workflow
for *using* these tools lives in [[document-with-forward]].

## Troubleshooting

- **`tsc` fails on a schema symbol import.** Cause: the field/type you reference doesn't exist on the contract yet. Solution: add it first via the [[schema-change]] workflow, rebuild shared, then reuse `Foo.shape.bar`.
- **The agent calls the tool with bad data and it half-writes.** Cause: missing validation. Solution: `DesignElement.parse({...})` (or the relevant schema) before any `save*`/`patch*` call, and return `fail(...)` from the `catch`.
- **The agent never picks the tool / picks the wrong one.** Cause: a vague `description` in the tool config. Solution: state what it does and when NOT to use it (mirror `create_element`) — that string is the agent's only guidance.
