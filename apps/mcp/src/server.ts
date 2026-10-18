#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { currentMode, server } from "./tools.js";

/**
 * `forward-mcp` — serve Forward's agent tools over MCP stdio.
 *
 * It serves the project in the nearest `.forward/` directory, so `claude mcp add forward -- npx -y forward-mcp` run
 * inside a repository is the whole setup.
 */
async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  const mode = currentMode();
  const where =
    mode.kind === "repo" ? `project at ${mode.root}` : `no project yet (${mode.reason})`;
  console.error(`[forward-mcp] ready on stdio — ${where}`);
}

main().catch((err) => {
  console.error("[forward-mcp] fatal:", err);
  process.exit(1);
});
