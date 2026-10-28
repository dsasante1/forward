import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { thirdPartyNotices } from "../../scripts/third-party-notices.mjs";

// Two real pages, `/` and `/docs/`, each prerendered to static HTML by
// scripts/prerender.mjs and hydrated in the browser. `/demo/` is added after the
// build by demo/build-demo.mjs (`forward export` of a sample project).
export default defineConfig({
  plugins: [
    react(),
    {
      // React is inlined into the bundle; ship its license alongside.
      name: "third-party-notices",
      apply: (_, env) => env.command === "build" && !env.isSsrBuild,
      generateBundle(_, bundle) {
        const files = Object.values(bundle).flatMap((c) => (c.type === "chunk" ? Object.keys(c.modules) : []));
        this.emitFile({
          type: "asset",
          fileName: "THIRD_PARTY_NOTICES.txt",
          source: thirdPartyNotices(files, import.meta.dirname, "The Forward website"),
        });
      },
    },
  ],
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        docs: resolve(import.meta.dirname, "docs/index.html"),
      },
    },
  },
});
