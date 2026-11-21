import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // geometry.ts is pure — no DOM environment needed.
    include: ["src/**/*.test.ts"],
    // Vitest blanks CSS imports by default; theme-view.test.ts reads canvas.css.
    css: { include: [/canvas\.css/] },
  },
});
