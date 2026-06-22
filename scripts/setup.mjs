/**
 * One-shot Firebase setup for the Forward canvas.
 *
 * Interactively collects your own Firebase config, then wires up *both* halves
 * of the project from a single source of truth:
 *
 *   1. apps/canvas/.env.local        — the web canvas (Vite env, gitignored)
 *   2. .vscode/settings.json         — the VS Code extension (URL + projectId)
 *   3. firebase.json + .firebaserc   — so `firebase deploy --only database`
 *                                      pushes the locked rules in this repo
 *
 * It can then run the rule deploy for you. Two things it deliberately does NOT
 * automate, by design:
 *   - Enabling Anonymous sign-in (a one-click console toggle — link printed).
 *   - Writing any auth token into committed files (secrets stay out of git).
 *
 *   node scripts/setup.mjs            # interactive
 *   node scripts/setup.mjs --no-deploy  # write config files, skip rule deploy
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const skipDeploy = process.argv.includes("--no-deploy");

const rl = createInterface({ input: stdin, output: stdout });

/** Prompt with an optional default; blank input falls back to the default. */
async function ask(label, def) {
  const hint = def ? ` [${def}]` : "";
  const answer = (await rl.question(`${label}${hint}: `)).trim();
  return answer || def || "";
}

/** Derive the Firebase (GCP) project id from a Realtime Database URL. */
function projectFromUrl(url) {
  try {
    const host = new URL(url).hostname; // e.g. my-app-default-rtdb.firebaseio.com
    const first = host.split(".")[0]; // my-app-default-rtdb
    return first.replace(/-default-rtdb$/, "").replace(/-rtdb$/, "");
  } catch {
    return "";
  }
}

console.log("\nFirebase setup — point this project at its Firebase RTDB.\n");

const databaseUrl = await ask("Realtime Database URL (required)");
if (!databaseUrl) {
  console.error("\nA database URL is required. Aborting.");
  rl.close();
  process.exit(1);
}

const guessedProject = projectFromUrl(databaseUrl);
const firebaseProjectId = await ask(
  "Firebase project id (GCP, for rule deploy)",
  guessedProject,
);
const canvasProjectId = await ask(
  "Project namespace id (DB subtree the extension/MCP read & write)",
  "project_xyz",
);

rl.close();

// ---------------------------------------------------------------------------
// 1. .vscode/settings.json — URL + projectId only. The auth token (if you use
//    one for locked-rule writes) goes in USER settings, never here, so it can't
//    be committed. Merge into any existing settings rather than clobbering.
// ---------------------------------------------------------------------------
const vscodeDir = join(root, ".vscode");
if (!existsSync(vscodeDir)) mkdirSync(vscodeDir);
const settingsPath = join(vscodeDir, "settings.json");
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    console.warn(`! ${settingsPath} wasn't valid JSON — leaving it untouched.`);
    settings = null;
  }
}
if (settings) {
  settings["forward.firebaseDatabaseUrl"] = databaseUrl;
  settings["forward.projectId"] = canvasProjectId;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`✓ wrote ${settingsPath} (no token — keep that in User settings)`);
}

// ---------------------------------------------------------------------------
// 3. firebase.json + .firebaserc — point the CLI at this repo's rules file.
// ---------------------------------------------------------------------------
writeFileSync(
  join(root, "firebase.json"),
  JSON.stringify(
    { database: { rules: "apps/canvas/firebase.rules.json" } },
    null,
    2,
  ) + "\n",
);
console.log(`✓ wrote ${join(root, "firebase.json")}`);

if (firebaseProjectId) {
  writeFileSync(
    join(root, ".firebaserc"),
    JSON.stringify({ projects: { default: firebaseProjectId } }, null, 2) + "\n",
  );
  console.log(`✓ wrote ${join(root, ".firebaserc")}`);
}

// ---------------------------------------------------------------------------
// 4. Deploy the locked rules (optional).
// ---------------------------------------------------------------------------
if (!skipDeploy && firebaseProjectId) {
  console.log("\nDeploying security rules via the Firebase CLI…");
  console.log("(if not logged in, this will tell you to run `npx firebase login`)\n");
  const res = spawnSync(
    "npx",
    ["--yes", "firebase-tools", "deploy", "--only", "database", "--project", firebaseProjectId],
    { cwd: root, stdio: "inherit" },
  );
  if (res.status !== 0) {
    console.warn(
      "\n! Rule deploy didn't complete. Run it later with: npm run deploy:rules",
    );
  }
} else if (skipDeploy) {
  console.log("\nSkipped rule deploy (--no-deploy). Run later: npm run deploy:rules");
}

// ---------------------------------------------------------------------------
// 5. The two manual steps that can't be safely scripted.
// ---------------------------------------------------------------------------
console.log(`
Done. The extension + MCP now point at this Firebase RTDB.

Manual step (if using the locked rules): enable Anonymous sign-in:
  https://console.firebase.google.com/project/${firebaseProjectId || "_"}/authentication/providers
`);
