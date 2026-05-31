import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // geometry.ts is pure — no DOM environment needed.
    include: ["src/**/*.test.ts"],
  },
});
