import { readFileSync } from "node:fs";

/**
 * The package version, read from the package.json next to `dist/`. Works both
 * in the workspace (apps/mcp/package.json) and in the published bundle
 * (pkg/package.json), so `forward --version` always names what npm installed.
 */
export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
