import type { LiveSourceOptions } from "./firebase.js";

/**
 * Reads runtime config from Vite env vars (a local, gitignored `.env.local` —
 * see `.env.example`). Selects the data source, in priority order:
 *
 *   1. VITE_API_BASE_URL set + a token -> "server": the Forward backend over its
 *                                 REST API (the migration target; shares element
 *                                 ids with the dashboard so deep links resolve).
 *   2. VITE_MOCK_RTDB_URL set  -> "mock": poll the local mock-rtdb over REST
 *                                 (end-to-end testing, no cloud Firebase).
 *   3. VITE_FIREBASE_DATABASE_URL set -> "live": the user's real Firebase RTDB.
 *   4. none                    -> null: fall back to the offline FixtureSource.
 *
 * The canvas "project id" is the namespace/tenancy id (not a GCP id); it must
 * match the extension's forward.projectId or the server project id, depending on
 * the source. A deep link from the dashboard can override the project id and
 * supply a token via the URL hash (see `readLink`).
 */
export type CanvasConfig =
  | { mode: "server"; baseUrl: string; projectId: string; token: string }
  | { mode: "mock"; databaseUrl: string; projectId: string }
  | {
      mode: "live";
      firebase: Record<string, string>;
      projectId: string;
      options: LiveSourceOptions;
    };

/** A deep link's parameters, carried in the URL hash so the token never lands in
 * a query string or the server's access logs. Emitted by the dashboard docs tab. */
export interface LinkParams {
  projectId?: string;
  /** Element id to select + center once it loads. */
  el?: string;
  /** A short-lived Clerk session token, handed off for the "server" source. */
  token?: string;
}

/** Parse the deep-link params out of `window.location.hash` (e.g.
 * `#project=p_1&el=el_9&token=…`). Returns an empty object when there is none. */
export function readLink(): LinkParams {
  if (typeof window === "undefined") return {};
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};
  const p = new URLSearchParams(hash);
  return {
    projectId: p.get("project") ?? undefined,
    el: p.get("el") ?? undefined,
    token: p.get("token") ?? undefined,
  };
}

export function loadConfig(): CanvasConfig | null {
  const env = import.meta.env;
  const link = readLink();
  const projectId =
    link.projectId || env.VITE_CANVAS_PROJECT_ID || "project_xyz";

  // 1. Server source: the backend base URL plus a token (from the deep link, or
  //    VITE_API_TOKEN for standalone dev). Highest priority so a link wins.
  const apiBaseUrl = env.VITE_API_BASE_URL;
  const token = link.token || env.VITE_API_TOKEN;
  if (apiBaseUrl && token) {
    return { mode: "server", baseUrl: apiBaseUrl, projectId, token };
  }

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
