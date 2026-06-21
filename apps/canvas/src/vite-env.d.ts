/// <reference types="vite/client" />

declare module "*.css?inline" {
  const css: string;
  export default css;
}

interface ImportMetaEnv {
  /** Forward backend (apps/server) base URL. With a token, selects the server source. */
  readonly VITE_API_BASE_URL?: string;
  /** A Clerk session token for standalone server-source dev (deep links supply their own). */
  readonly VITE_API_TOKEN?: string;
  /** Local mock-rtdb REST URL. When set, the canvas polls it (test mode). */
  readonly VITE_MOCK_RTDB_URL?: string;
  /** Canvas project namespace within the DB tree. */
  readonly VITE_CANVAS_PROJECT_ID?: string;
  readonly VITE_FIREBASE_DATABASE_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_USE_ANON_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
