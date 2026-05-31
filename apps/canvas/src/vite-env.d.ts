/// <reference types="vite/client" />

interface ImportMetaEnv {
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
