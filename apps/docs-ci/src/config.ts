import type { ApiConfig } from "forward-core/api";

/**
 * Everything `apply` needs, read from the environment. The three FORWARD_* vars
 * are the only secrets/config a customer wires up; the commit fields are filled
 * automatically by the GitHub Action from the merge context and are used to
 * default a binding's version + change log (so the AI never has to guess them).
 */
export interface CliConfig {
  api: ApiConfig;
  /** Short commit sha of the merge, used as the default version label. */
  commit: string;
  /** Merge commit message, used as the default change log. */
  commitMessage: string;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

export function loadConfig(): CliConfig {
  const baseUrl = process.env.FORWARD_API_BASE_URL ?? "";
  const projectId = process.env.FORWARD_PROJECT_ID ?? "";
  const token = process.env.FORWARD_API_TOKEN ?? "";

  const missing = [
    ["FORWARD_API_BASE_URL", baseUrl],
    ["FORWARD_PROJECT_ID", projectId],
    ["FORWARD_API_TOKEN", token],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set the FORWARD_API_TOKEN secret and the FORWARD_API_BASE_URL / ` +
        `FORWARD_PROJECT_ID values in your workflow.`,
    );
  }

  return {
    api: { baseUrl, projectId, token },
    commit: short(process.env.FORWARD_COMMIT ?? process.env.GITHUB_SHA ?? ""),
    commitMessage: (process.env.FORWARD_COMMIT_MESSAGE ?? "").split("\n")[0] ?? "",
  };
}
