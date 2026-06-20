import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA: every unknown route falls through to index.html so Clerk's path-based
// routing (/sign-in/*, /sign-up/*) and React Router both work on refresh.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
