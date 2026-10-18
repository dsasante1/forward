import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { RepoStore, createRepoRouter, resolveAuthor } from "forward-core/repo";
import { renderIndex, requireUiDir } from "./ui.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

const MAX_BODY = 16 * 1024 * 1024;

export interface ServeOptions {
  root: string;
  port: number;
  host: string;
}

/**
 * `forward serve`: the canvas editor on top of the repository's `.forward/`.
 *
 * It serves the built canvas plus the project-scoped REST routes, backed by the
 * same repo router the MCP server and extension use in-process — so an agent
 * writing through MCP and a human dragging boxes in the browser edit the same
 * files and see each other's changes on the next poll.
 *
 * There are no accounts, so the server defends itself instead:
 *   - it binds to loopback by default;
 *   - every API call must carry a random per-session token that only the
 *     served page knows (another site can't read it — no CORS);
 *   - the Host header must be the address we bound, which defeats DNS rebinding.
 */
export function serve(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  const ui = requireUiDir();
  const store = new RepoStore(opts.root, { author: resolveAuthor(opts.root) });
  const manifest = store.manifest();
  const router = createRepoRouter(store);
  const token = randomBytes(24).toString("base64url");
  const apiPrefix = `/projects/${encodeURIComponent(manifest.id)}`;

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHost(host, opts)) return send(res, 421, { message: "Unexpected Host header." });

    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === apiPrefix || url.pathname.startsWith(`${apiPrefix}/`)) {
      if (!authorized(req.headers.authorization, token)) {
        return send(res, 401, { message: "Missing or wrong session token." });
      }
      let body: unknown;
      try {
        body = await readBody(req);
      } catch (err) {
        return send(res, 400, { message: (err as Error).message });
      }
      const rest = url.pathname.slice(apiPrefix.length) || "/";
      const out = await router({ method: req.method ?? "GET", path: `${rest}${url.search}`, body });
      res.setHeader("Cache-Control", "no-store");
      if (out.status === 204) {
        res.writeHead(204).end();
        return;
      }
      return send(res, out.status, out.body);
    }
    if (url.pathname.startsWith("/projects/")) {
      return send(res, 404, { message: `This server only serves project "${manifest.id}".` });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { message: "Method not allowed" });

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = renderIndex(ui, {
        mode: "serve",
        token,
        projectId: manifest.id,
        projectName: manifest.name,
      });
      res.writeHead(200, { "Content-Type": TYPES[".html"]!, "Cache-Control": "no-store" });
      res.end(html);
      return;
    }
    const file = safeJoin(ui, decodeURIComponent(url.pathname));
    if (!file) return send(res, 404, { message: "Not found" });
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error("not a file");
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Content-Length": st.size,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      if (req.method === "HEAD") return void res.end();
      createReadStream(file).pipe(res);
    } catch {
      send(res, 404, { message: "Not found" });
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => send(res, 500, { message: (err as Error).message }));
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      opts.port = port;
      const shown = opts.host === "0.0.0.0" || opts.host === "::" ? "localhost" : opts.host;
      resolvePromise({ url: `http://${shown.includes(":") ? `[${shown}]` : shown}:${port}/`, close: () => server.close() });
    });
  });
}

function allowedHost(host: string, opts: ServeOptions): boolean {
  const names = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (opts.host !== "0.0.0.0" && opts.host !== "::") names.add(opts.host.includes(":") ? `[${opts.host}]` : opts.host);
  for (const name of names) if (host === `${name}:${opts.port}`) return true;
  // Binding to every interface is an explicit opt-in to LAN access; the token still guards the API.
  return opts.host === "0.0.0.0" || opts.host === "::";
}

function authorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

function safeJoin(dir: string, pathname: string): string | undefined {
  const base = resolve(dir);
  const target = resolve(join(base, normalize(pathname)));
  return target === base || target.startsWith(base + sep) ? target : undefined;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    if (req.method === "GET" || req.method === "HEAD") return resolvePromise(undefined);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolvePromise(undefined);
      try {
        resolvePromise(JSON.parse(text));
      } catch {
        reject(new Error("Body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
