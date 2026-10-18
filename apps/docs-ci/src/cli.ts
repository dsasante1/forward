#!/usr/bin/env node
import { apply } from "./apply.js";

/**
 * `forward-docs` — the tiny, deterministic write step of the Forward CI docs
 * pipeline. The customer's own AI does all the reasoning and emits a
 * `forward-docs.json`; this command validates it and writes it into the
 * repository's `.forward/` project. See FORWARD_DOCS.md for the instructions
 * handed to the AI.
 */
function usage(): void {
  console.error(
    [
      "Usage: forward-docs apply [path]",
      "",
      "  apply [path]   Validate a forward-docs.json (default: ./forward-docs.json)",
      "                 and write it into .forward/.",
      "",
      "Run it in a repository that has a .forward/ project.",
      "",
      "Environment:",
      "  FORWARD_REPO           Repository root (default: search up from the cwd)",
      "  FORWARD_AUTHOR         Author stamped on writes (default: forward-docs)",
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
