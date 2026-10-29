// zod 4 re-exports all ~60 of its error-message translations as `z.locales`,
// and esbuild can't drop members of a namespace re-export, so every esbuild
// bundle that imports zod carries them (~360 KB). Forward only uses English,
// which zod registers itself (v4/classic/schemas.js imports locales/en.js
// directly), so resolve zod's locales index to a module re-exporting `en`
// alone. If zod moves the file, this simply stops matching: the bundle grows
// back, nothing breaks.
import { dirname, extname, join } from "node:path";

export const zodEnglishOnly = {
  name: "zod-english-only",
  setup(build) {
    build.onResolve({ filter: /^\.\.\/locales\/index\.c?js$/ }, (args) => {
      if (!/[\\/]node_modules[\\/]zod[\\/]/.test(args.importer)) return undefined;
      return { path: join(args.resolveDir, args.path), namespace: "zod-english-only" };
    });
    build.onLoad({ filter: /.*/, namespace: "zod-english-only" }, (args) => {
      const en = join(dirname(args.path), `en${extname(args.path)}`);
      return {
        contents: `export { default as en } from ${JSON.stringify(en)};`,
        resolveDir: dirname(args.path),
        loader: "js",
      };
    });
  },
};
