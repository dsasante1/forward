/**
 * Seed a live Firebase RTDB with the fixture design so the canvas isn't empty
 * on first run (and the extension has real element ids to annotate).
 *
 * Reads VITE_FIREBASE_DATABASE_URL and VITE_CANVAS_PROJECT_ID from
 * apps/canvas/.env.local. Writes via the RTDB REST API, so it needs either
 * test-mode (open) rules or an auth token passed as the first CLI arg.
 *
 *   node scripts/seed.mjs            # open/test-mode rules
 *   node scripts/seed.mjs <token>    # locked rules (DB secret / ID token)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function readEnv() {
  const env = {};
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  } catch {
    console.error("Missing apps/canvas/.env.local — copy .env.example first.");
    process.exit(1);
  }
  return env;
}

const env = readEnv();
// Prefer the mock URL when set, so the same script seeds the local mock-rtdb.
const dbUrl = env.VITE_MOCK_RTDB_URL || env.VITE_FIREBASE_DATABASE_URL;
const projectId = env.VITE_CANVAS_PROJECT_ID || "project_xyz";
const token = process.argv[2];
if (!dbUrl) {
  console.error(
    "Set VITE_MOCK_RTDB_URL or VITE_FIREBASE_DATABASE_URL in .env.local",
  );
  process.exit(1);
}

const fixture = JSON.parse(
  readFileSync(join(root, "public", "fixture.json"), "utf8"),
);
const auth = token ? `?auth=${encodeURIComponent(token)}` : "";
const base = dbUrl.replace(/\/$/, "");

async function put(path, body) {
  const res = await fetch(`${base}/${path}.json${auth}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

const elements = fixture.design_elements?.[projectId] ?? {};
const timeline = fixture.version_timeline?.[projectId] ?? {};
const infraNodes = fixture.infra_nodes?.[projectId] ?? {};
const infraEdges = fixture.infra_edges?.[projectId] ?? {};
const infraFlows = fixture.infra_flows?.[projectId] ?? {};

await put(`design_elements/${projectId}`, elements);
await put(`version_timeline/${projectId}`, timeline);
// The infrastructure graph (pillar 3) and its narrated flows — without these the
// Infra overlay and the flow panel come up empty against the mock/live database.
await put(`infra_nodes/${projectId}`, infraNodes);
await put(`infra_edges/${projectId}`, infraEdges);
await put(`infra_flows/${projectId}`, infraFlows);

console.log(
  `Seeded ${Object.keys(elements).length} elements, ` +
    `${Object.keys(infraNodes).length} infra nodes, ` +
    `${Object.keys(infraFlows).length} flows into "${projectId}" at ${base}`,
);
