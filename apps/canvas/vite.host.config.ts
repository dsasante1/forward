import { resolve } from "node:path";
import { defineConfig } from "vite";
import { thirdPartyNotices } from "../../scripts/third-party-notices.mjs";

// Builds the standalone canvas host (host/) that the `forward` CLI ships:
// `forward serve` serves it with a live config, `forward export` copies it next
// to a project bundle for GitHub Pages. `base: "./"` keeps every asset URL
// relative so the site works under any Pages sub-path (/<repo>/).
export default defineConfig({
  root: resolve(__dirname, "host"),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist-host"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  plugins: [
    {
      // Mermaid and the rest are inlined into the chunks; ship their licenses alongside.
      name: "third-party-notices",
      apply: "build",
      generateBundle(_, bundle) {
        const files = Object.values(bundle).flatMap((c) => (c.type === "chunk" ? Object.keys(c.modules) : []));
        this.emitFile({
          type: "asset",
          fileName: "THIRD_PARTY_NOTICES.txt",
          source: thirdPartyNotices(files, __dirname, "The Forward canvas UI"),
        });
      },
    },
  ],
});
