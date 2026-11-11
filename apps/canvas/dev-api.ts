import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RepoStore, createRepoRouter, findRepoRoot, initRepo, resolveAuthor } from "forward-core/repo";
import type { Plugin } from "vite";

/**
 * `vite` dev server only: answers the canvas's REST calls in-process (the same
 * repo router `forward serve` uses) and injects the host config, so the host
 * page runs with hot reload. The project is `$FORWARD_REPO`, else a scratch
 * repo in the temp dir that is created on first run.
 */
export function forwardDevApi(): Plugin {
  let config: unknown;
  return {
    name: "forward-dev-api",
    apply: "serve",
    configureServer(server) {
      const root = projectRoot();
      const store = new RepoStore(root, { author: resolveAuthor(root) });
      const manifest = store.manifest();
      const router = createRepoRouter(store);
      const token = randomBytes(24).toString("base64url");
      const apiPrefix = `/projects/${encodeURIComponent(manifest.id)}`;
      server.config.logger.info(`  forward project: ${root}`);

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://local");
        if (url.pathname !== apiPrefix && !url.pathname.startsWith(`${apiPrefix}/`)) return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Cache-Control", "no-store");
          if (status === 204) return void res.end();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(body === undefined ? "" : JSON.stringify(body));
        };
        if (req.headers.authorization?.replace(/^Bearer\s+/i, "") !== token) {
          return send(401, { message: "Missing or wrong session token." });
        }
        readJson(req)
          .then((body) => router({ method: req.method ?? "GET", path: `${url.pathname.slice(apiPrefix.length) || "/"}${url.search}`, body }))
          .then((out) => send(out.status, out.body))
          .catch((err: Error) => send(400, { message: err.message }));
      });

      config = { mode: "serve", token, projectId: manifest.id, projectName: manifest.name };
    },
    transformIndexHtml(html) {
      const json = JSON.stringify(config).replace(/</g, "\\u003c");
      return html.replace("<!--forward:config-->", `<script>window.__FORWARD__=${json};</script>`);
    },
  };
}

function projectRoot(): string {
  if (process.env.FORWARD_REPO?.trim()) {
    const found = findRepoRoot();
    if (!found) throw new Error(`FORWARD_REPO=${process.env.FORWARD_REPO} has no .forward/forward.json.`);
    return found;
  }
  const root = resolve(tmpdir(), "forward-canvas-dev");
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, ".git"))) execFileSync("git", ["init", "-q"], { cwd: root });
  initRepo(root, { name: "Canvas dev" });
  return root;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((done, fail) => {
    if (req.method === "GET" || req.method === "HEAD") return done(undefined);
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        done(text ? JSON.parse(text) : undefined);
      } catch {
        fail(new Error("Body is not valid JSON."));
      }
    });
    req.on("error", fail);
  });
}
