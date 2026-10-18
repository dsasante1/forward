/** Parsed command line: positionals plus `--key value` / `--key=value` / `--flag` / `--no-flag`. */
export interface Args {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--") || a === "-") {
      positionals.push(a);
      continue;
    }
    const body = a.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (body.startsWith("no-")) {
      flags[body.slice(3)] = false;
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[body] = next;
        i++;
      } else {
        flags[body] = true;
      }
    }
  }
  return { positionals, flags };
}

export function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
