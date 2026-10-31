/// <reference types="node" />
import type { ApiRequest, ApiResponse } from "../api-rest.js";
import { contributors, projectTimeline } from "./git.js";
import { RepoError, type RepoStore } from "./store.js";

type Handler = (
  params: string[],
  body: unknown,
  query: URLSearchParams,
) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const SEG = "([^/]+)";

/**
 * Serve Forward's project-scoped REST API from a
 * {@link RepoStore}. Paths are relative to `/projects/:projectId`, exactly what
 * `forward-core/api` sends, so the same router backs both the in-process
 * transport (MCP server, extension, CLI) and the HTTP server `forward serve`
 * runs for the canvas.
 *
 * Access is whatever the git host grants, so there are no membership, invite
 * or token routes; the roster is a read-only view of git contributors.
 */
export function createRepoRouter(store: RepoStore) {
  const routes: Route[] = [];
  const on = (method: string, path: string, handler: Handler) => {
    routes.push({ method, pattern: new RegExp(`^${path.replace(/:\w+/g, SEG)}$`), handler });
  };

  // design elements + API docs
  on("GET", "/elements", () => store.listElements());
  on("POST", "/elements/import", (_p, body) => store.importDesign(body));
  on("PUT", "/elements/:id", (_p, body) => store.saveElement(body));
  on("PATCH", "/elements/:id", ([id], body) => store.patchElement(id!, body));
  on("DELETE", "/elements/:id", ([id], _b, q) => ({
    deleted: store.deleteElement(id!, q.get("cascade") !== "false"),
  }));
  on("PUT", "/elements/:id/binding", ([id], body) => {
    store.bind(id!, (body ?? {}) as Parameters<RepoStore["bind"]>[1]);
  });
  on("DELETE", "/elements/:id/binding", ([id], body) => {
    store.unbind(id!, (body ?? {}) as Parameters<RepoStore["unbind"]>[1]);
  });
  on("GET", "/timelines", () => store.timelines());
  on("GET", "/timeline", () => projectTimeline(store.root));

  // infra graph, flows, ER model (served together on GET /infra, like the server)
  on("GET", "/infra", () => store.infra());
  on("PUT", "/infra/nodes/:id", (_p, body) => store.saveInfraNode(body));
  on("DELETE", "/infra/nodes/:id", ([id]) => store.deleteInfraNode(id!));
  on("PUT", "/infra/edges/:id", (_p, body) => store.saveInfraEdge(body));
  on("DELETE", "/infra/edges/:id", ([id]) => store.deleteInfraEdge(id!));
  on("PUT", "/infra/flows/:id", (_p, body) => store.saveInfraFlow(body));
  on("DELETE", "/infra/flows/:id", ([id]) => store.deleteInfraFlow(id!));
  on("PUT", "/infra/entities/:id", (_p, body) => store.saveEntity(body));
  on("DELETE", "/infra/entities/:id", ([id]) => store.deleteEntity(id!));
  on("PUT", "/infra/relations/:id", (_p, body) => store.saveRelation(body));
  on("DELETE", "/infra/relations/:id", ([id]) => store.deleteRelation(id!));

  // agents + MCP servers
  on("GET", "/agents", () => store.agents());
  on("PUT", "/agents/nodes/:id", (_p, body) => store.saveAgent(body));
  on("DELETE", "/agents/nodes/:id", ([id]) => store.deleteAgent(id!));
  on("PUT", "/agents/servers/:id", (_p, body) => store.saveServer(body));
  on("DELETE", "/agents/servers/:id", ([id]) => store.deleteServer(id!));

  // tasks
  on("GET", "/tasks", () => store.listTasks());
  on("PUT", "/tasks/:id", (_p, body) => store.saveTask(body));
  on("DELETE", "/tasks/:id", ([id]) => store.deleteTask(id!));

  // checkpoints
  on("GET", "/checkpoints", () => store.listCheckpoints());
  on("POST", "/checkpoints", (_p, body) => store.createCheckpoint(body));
  on("DELETE", "/checkpoints/:id", ([id]) => store.deleteCheckpoint(id!));
  on("POST", "/checkpoints/:id/restore", ([id]) => {
    store.restoreCheckpoint(id!);
  });

  // contributor roster, derived from git history (read-only)
  on("GET", "/members", () => contributors(store.root));

  return async function handle(req: ApiRequest): Promise<ApiResponse> {
    const url = new URL(req.path, "http://repo.local");
    const method = req.method.toUpperCase();
    let pathMatched = false;
    for (const route of routes) {
      const m = route.pattern.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      try {
        const params = m.slice(1).map((s) => decodeURIComponent(s));
        const result = await route.handler(params, req.body, url.searchParams);
        return result === undefined ? { status: 204 } : { status: 200, body: result };
      } catch (err) {
        if (err instanceof RepoError) return { status: err.status, body: { message: err.message } };
        const message = err instanceof Error ? err.message : String(err);
        return { status: 500, body: { message } };
      }
    }
    return pathMatched
      ? { status: 405, body: { message: `${method} not allowed on ${url.pathname}` } }
      : { status: 404, body: { message: `No route ${method} ${url.pathname}` } };
  };
}

export type RepoRouter = ReturnType<typeof createRepoRouter>;
