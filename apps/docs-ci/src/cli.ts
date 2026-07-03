#!/usr/bin/env node
import { apply } from "./apply.js";

/**
 * `forward-docs` — the tiny, deterministic write step of the Forward CI docs
 * pipeline. The customer's own AI does all the reasoning and emits a
 * `forward-docs.json`; this command validates it, snapshots a checkpoint, and
 * writes it to the Forward project. It holds the credentials so the AI never
 * has to. See FORWARD_DOCS.md for the instructions handed to the AI.
 */
function usage(): void {
  console.error(
    [
      "Usage: forward-docs apply [path]",
      "",
      "  apply [path]   Validate a forward-docs.json (default: ./forward-docs.json)",
      "                 and write it to the Forward project.",
      "",
      "Environment:",
      "  FORWARD_API_BASE_URL   Forward backend base URL (e.g. https://api.forward.dev)",
      "  FORWARD_PROJECT_ID     Target project (tenancy) id",
      "  FORWARD_API_TOKEN      Project API token (secret)",
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "apply":
      return apply(rest[0] ?? "forward-docs.json");
    case undefined:
    case "-h":
    case "--help":
      usage();
      return command === undefined ? 2 : 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      usage();
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
