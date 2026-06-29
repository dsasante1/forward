import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The internal Platform Admin app — a SEPARATE deploy from the customer
// dashboard. Runs on its own port; every unknown route falls through to
// index.html so Clerk's path-based routing and React Router work on refresh.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
});
