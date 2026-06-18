import type { LiveSourceOptions } from "./firebase.js";

/**
 * Reads runtime config from Vite env vars (a local, gitignored `.env.local` —
 * see `.env.example`). Selects the data source, in priority order:
 *
 *   1. VITE_MOCK_RTDB_URL set  -> "mock": poll the local mock-rtdb over REST
 *                                 (end-to-end testing, no cloud Firebase).
 *   2. VITE_FIREBASE_DATABASE_URL set -> "live": the user's real Firebase RTDB.
 *   3. neither                 -> null: fall back to the offline FixtureSource.
 *
 * The canvas "project id" is the namespace within the DB tree (not a GCP id);
 * it must match the extension's forward.projectId.
 */
export type CanvasConfig =
  | { mode: "mock"; databaseUrl: string; projectId: string }
  | {
      mode: "live";
      firebase: Record<string, string>;
      projectId: string;
      options: LiveSourceOptions;
    };

export function loadConfig(): CanvasConfig | null {
  const env = import.meta.env;
  const projectId = env.VITE_CANVAS_PROJECT_ID || "project_xyz";

  const mockUrl = env.VITE_MOCK_RTDB_URL;
  if (mockUrl) {
    return { mode: "mock", databaseUrl: mockUrl, projectId };
  }

  const databaseURL = env.VITE_FIREBASE_DATABASE_URL;
  if (!databaseURL) return null;

  const firebase: Record<string, string> = { databaseURL };
  if (env.VITE_FIREBASE_API_KEY) firebase.apiKey = env.VITE_FIREBASE_API_KEY;
  if (env.VITE_FIREBASE_PROJECT_ID)
    firebase.projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (env.VITE_FIREBASE_AUTH_DOMAIN)
    firebase.authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
  if (env.VITE_FIREBASE_APP_ID) firebase.appId = env.VITE_FIREBASE_APP_ID;

  return {
    mode: "live",
    firebase,
    projectId,
    options: {
      useAnonAuth: env.VITE_FIREBASE_USE_ANON_AUTH === "true",
    },
  };
}
