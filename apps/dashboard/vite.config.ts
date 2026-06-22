import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA: every unknown route falls through to index.html so Clerk's path-based
// routing (/sign-in/*, /sign-up/*) and React Router both work on refresh.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  // forward-canvas is consumed as source (its "import" condition points at .ts),
  // so keep it out of the esbuild pre-bundler, which can't handle Vite-only
  // imports like `*.css?inline`. Vite transforms it on demand instead.
  optimizeDeps: { exclude: ["forward-canvas"] },
});
