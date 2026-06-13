/**
 * Minimal in-memory stand-in for the Firebase Realtime Database REST API.
 *
 * Implements just enough for end-to-end testing without a cloud project:
 *   GET    /path.json            -> read the subtree at /path
 *   PUT    /path.json            -> replace the subtree (set)
 *   POST   /path.json            -> push a child under /path with a generated key
 *   PATCH  /path.json            -> shallow-merge into the subtree (update)
 *   DELETE /path.json            -> remove the subtree
 *   ?shallow=true on GET         -> return { key: true } instead of values
 *   X-Firebase-ETag on GET       -> ETag header; matching If-None-Match -> 304
 *
 * The whole DB is one JSON object held in memory (optionally persisted to disk).
 * It is NOT secure and ignores `?auth=` — it's a test double, never production.
 *
 * Run directly as a CLI:
 *   node server.mjs                              # :9000, ephemeral
 *   PORT=9100 DB_FILE=./db.json node server.mjs  # custom port + persistence
 *
 * Or embed it (e.g. integration tests):
 *   import { createMockRtdb } from "./server.mjs";
 *   const mock = await createMockRtdb({ port: 0 });   // 0 = random free port
 *   mock.url;        // http://localhost:<port>
 *   mock.db;         // direct access to the in-memory tree for assertions
 *   await mock.close();
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * Create (but do not start) a mock RTDB request handler over an isolated state
 * tree. Returns the http.Server plus helpers. Each instance is independent.
 */
export function createMockRtdb({ dbFile = "" } = {}) {
  let db = {};
  if (dbFile && existsSync(dbFile)) {
    try {
      db = JSON.parse(readFileSync(dbFile, "utf8"));
    } catch {
      /* start empty on parse failure */
    }
  }

  const persist = () => {
    if (dbFile) writeFileSync(dbFile, JSON.stringify(db, null, 2));
  };

  const segments = (pathname) =>
    decodeURIComponent(pathname)
      .replace(/\.json$/, "")
      .split("/")
      .filter(Boolean);

  const getAt = (keys) => {
    let node = db;
    for (const k of keys) {
      if (node == null || typeof node !== "object") return null;
      node = node[k];
    }
    return node ?? null;
  };

  const setAt = (keys, value) => {
    if (keys.length === 0) {
      db = value ?? {};
      return;
    }
    let node = db;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (node[k] == null || typeof node[k] !== "object") node[k] = {};
      node = node[k];
    }
    const last = keys[keys.length - 1];
    if (value === null) delete node[last];
    else node[last] = value;
  };

  const pushKey = () =>
    `-N${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        if (!raw) return resolve(undefined);
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(undefined);
        }
      });
    });

  const send = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,PUT,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type, x-firebase-etag, if-none-match",
      ...extraHeaders,
    });
    res.end(body === undefined ? "null" : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, null);
    const u = new URL(req.url, "http://localhost");
    const keys = segments(u.pathname);

    try {
      switch (req.method) {
        case "GET": {
          const node = getAt(keys);
          if (
            u.searchParams.get("shallow") === "true" &&
            node &&
            typeof node === "object"
          ) {
            const shallow = {};
            for (const k of Object.keys(node)) shallow[k] = true;
            return send(res, 200, shallow);
          }
          // Firebase-style conditional GET: an ETag is only computed when the
          // client asks for one (X-Firebase-ETag), and a matching If-None-Match
          // short-circuits to a bodyless 304 — what the pollers rely on.
          if (req.headers["x-firebase-etag"] === "true") {
            const etag = createHash("sha1")
              .update(JSON.stringify(node))
              .digest("base64");
            if (req.headers["if-none-match"] === etag) {
              res.writeHead(304, { etag, "access-control-allow-origin": "*" });
              return res.end();
            }
            return send(res, 200, node, { etag });
          }
          return send(res, 200, node);
        }
        case "PUT": {
          const body = await readBody(req);
          setAt(keys, body ?? null);
          persist();
          return send(res, 200, body ?? null);
        }
        case "PATCH": {
          const body = await readBody(req);
          const merged = { ...(getAt(keys) ?? {}), ...(body ?? {}) };
          setAt(keys, merged);
          persist();
          return send(res, 200, merged);
        }
        case "POST": {
          const body = await readBody(req);
          const key = pushKey();
          setAt([...keys, key], body ?? null);
          persist();
          return send(res, 200, { name: key });
        }
        case "DELETE": {
          setAt(keys, null);
          persist();
          return send(res, 200, null);
        }
        default:
          return send(res, 405, { error: "method not allowed" });
      }
    } catch (err) {
      return send(res, 500, { error: String(err) });
    }
  });

  return {
    server,
    /** Snapshot/inspect the in-memory tree (live reference). */
    get db() {
      return db;
    },
    /** Start listening; resolves with { url, port }. port 0 = random free. */
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, () => {
          const actual = server.address().port;
          resolve({ url: `http://localhost:${actual}`, port: actual });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Convenience: create + start in one call. */
export async function startMockRtdb({ port = 0, dbFile = "" } = {}) {
  const mock = createMockRtdb({ dbFile });
  const { url, port: actual } = await mock.listen(port);
  return Object.assign(mock, { url, port: actual });
}

// --- CLI: run directly with `node server.mjs` -----------------------------
const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 9000);
  const dbFile = process.env.DB_FILE ?? "";
  const mock = await startMockRtdb({ port, dbFile });
  console.log(`[mock-rtdb] REST API on ${mock.url}`);
  if (dbFile) console.log(`[mock-rtdb] persisting to ${dbFile}`);
  console.log(`[mock-rtdb] try: curl ${mock.url}/.json`);
}
