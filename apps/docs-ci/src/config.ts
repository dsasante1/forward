import type { ApiConfig } from "forward-core/api";
import { findRepoRoot, repoConfig } from "forward-core/repo";

/**
 * Everything `apply` needs. The project is the `.forward/` directory of the
 * repository the command runs in; the commit fields are filled by the GitHub
 * Action from the PR context and default a binding's version + change log (so
 * the AI never has to guess them).
 */
export interface CliConfig {
  api: ApiConfig;
  /** The repository root whose `.forward/` the plan is written into. */
  repo: string;
  /** Short commit sha, used as the default version label. */
  commit: string;
  /** Commit message or PR title, used as the default change log. */
  commitMessage: string;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

export function loadConfig(): CliConfig {
  const commit = short(process.env.FORWARD_COMMIT ?? process.env.GITHUB_SHA ?? "");
  const commitMessage = (process.env.FORWARD_COMMIT_MESSAGE ?? "").split("\n")[0] ?? "";
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new Error(
      "No Forward project found. Run this in a repository that has .forward/ " +
        "(create it with `npx -y -p forward-mcp forward init`), or set FORWARD_REPO.",
    );
  }
  const author = process.env.FORWARD_AUTHOR || "forward-docs";
  return { api: repoConfig(root, { author }), repo: root, commit, commitMessage };
}
