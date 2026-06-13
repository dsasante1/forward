import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ApiBinding,
  bindApiToElement,
  fetchElements,
  unbindApiFromElement,
  type FirebaseConfig,
} from "@adc/shared";
import { findAnchorsInSource, scanPath } from "./anchor.js";
import { rankElements } from "./match.js";

/**
 * API Design Connector — MCP server.
 *
 * The AI-native surface of the project: it exposes the same RTDB writer the VS
 * Code extension uses (`@adc/shared`) as a handful of tools any MCP-capable
 * agent (Claude Code, Cursor, …) can call. So a backend dev who just finished a
 * feature can say "document the login endpoint on the canvas" and the agent
 * finds the right design element and writes the docs — no quick-pick, no form.
 *
 * Trust boundary: this process holds the Firebase credentials (read from env);
 * the agent only ever sees the scoped tools below, never the token. Stdout is
 * reserved for the MCP protocol, so all logging goes to stderr.
 */

const AGENT = process.env.ADC_AGENT || "agent";

/**
 * BYOD config from the environment. Thrown errors surface to the agent as a tool
 * error telling the user which variables to set, rather than crashing the server.
 */
function getConfig(): FirebaseConfig {
  const databaseUrl = process.env.ADC_FIREBASE_DATABASE_URL ?? "";
  const projectId = process.env.ADC_PROJECT_ID ?? "";
  const authToken = process.env.ADC_AUTH_TOKEN ?? "";
  if (!databaseUrl || !projectId) {
    throw new Error(
      "Missing configuration. Set ADC_FIREBASE_DATABASE_URL and ADC_PROJECT_ID " +
        "(and ADC_AUTH_TOKEN if your RTDB rules require auth) in the MCP server env.",
    );
  }
  return { databaseUrl, projectId, ...(authToken ? { authToken } : {}) };
}

/** Stable JSON tool result. */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Error tool result the agent can read and relay to the user. */
function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const server = new McpServer({
  name: "api-design-connector",
  version: "0.1.0",
});

// --- read: what the designers drew ----------------------------------------
server.registerTool(
  "list_design_elements",
  {
    title: "List design elements",
    description:
      "List every design element on the canvas for this project (id, name, type, text, " +
      "and whether it already has API documentation). Start here to see what you can document.",
    inputSchema: {},
  },
  async () => {
    try {
      const elements = await fetchElements(getConfig());
      return ok(
        elements.map((el) => ({
          id: el.id,
          name: el.name,
          type: el.type,
          ...(el.text ? { text: el.text } : {}),
          documented: Boolean(el.apiBinding),
          docTitle: el.apiBinding?.title,
        })),
      );
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- the linking step: feature description -> design element ---------------
server.registerTool(
  "find_element",
  {
    title: "Find a design element",
    description:
      "Find which design element best matches a feature you just built, by ranking the " +
      "canvas elements against a natural-language description (e.g. \"login form\", " +
      "\"user profile page\"). Returns candidates best-first with a match score. When the " +
      "top score is low or two candidates are close, confirm the element id with the user " +
      "before documenting.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("Natural-language description of the feature/endpoint to locate."),
      limit: z
        .number()
        .int()
        .positive()
        .max(20)
        .optional()
        .describe("Max candidates to return (default 5)."),
    },
  },
  async ({ query, limit }) => {
    try {
      const elements = await fetchElements(getConfig());
      const ranked = rankElements(query, elements).slice(0, limit ?? 5);
      return ok(ranked);
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- deterministic linking: in-code @adc anchors --------------------------
server.registerTool(
  "resolve_anchors",
  {
    title: "Resolve in-code @adc anchors",
    description:
      "Find `@adc <elementId>` anchors in source code and resolve each to its design element " +
      "— the deterministic alternative to find_element. Pass a file or directory `path` to " +
      "scan, or raw `source` text. Each anchor pins code to a design element unambiguously, so " +
      "prefer this over fuzzy matching whenever the developer has anchored their code. The " +
      "result flags anchors whose elementId doesn't exist (typos / stale ids).",
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe("File or directory to scan for @adc anchors."),
      source: z
        .string()
        .optional()
        .describe("Raw source text to scan, as an alternative to `path`."),
      file: z
        .string()
        .optional()
        .describe("Optional label for where `source` came from."),
    },
  },
  async ({ path, source, file }) => {
    try {
      if (!path && source == null) {
        return fail("Provide `path` (a file or directory to scan) or `source` text.");
      }
      const anchors = [
        ...(source != null ? findAnchorsInSource(source, file) : []),
        ...(path ? await scanPath(path) : []),
      ];

      // Cross-check each anchor against the live design elements so typos and
      // stale ids surface instead of silently writing nowhere. If the database
      // is unreachable we still return the anchors, just unvalidated.
      let byId = new Map<string, { name: string; type: string; documented: boolean }>();
      let warning: string | undefined;
      try {
        byId = new Map(
          (await fetchElements(getConfig())).map((e) => [
            e.id,
            { name: e.name, type: e.type, documented: Boolean(e.apiBinding) },
          ]),
        );
      } catch (err) {
        warning = `Anchors not validated against the canvas: ${(err as Error).message}`;
      }

      const resolved = anchors.map((a) => {
        const el = byId.get(a.elementId);
        return {
          ...a,
          exists: warning ? null : Boolean(el),
          ...(el ? { name: el.name, type: el.type, documented: el.documented } : {}),
        };
      });
      return ok({ count: resolved.length, ...(warning ? { warning } : {}), anchors: resolved });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- read one element's current docs (before editing) ----------------------
server.registerTool(
  "get_documentation",
  {
    title: "Get documentation for an element",
    description:
      "Read the API documentation currently attached to one design element, or null if it " +
      "has none. Call this before write_documentation when editing, so you preserve what's there.",
    inputSchema: {
      elementId: z.string().min(1).describe("The design element id."),
    },
  },
  async ({ elementId }) => {
    try {
      const el = (await fetchElements(getConfig())).find((e) => e.id === elementId);
      if (!el) return fail(`No design element with id "${elementId}".`);
      return ok(el.apiBinding ?? null);
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: attach docs to a specific element ------------------------------
server.registerTool(
  "write_documentation",
  {
    title: "Write documentation onto an element",
    description:
      "Attach (or replace) API documentation on one design element, linking the design to the " +
      "code you just wrote. title + Markdown description carry the meaning; language/method/" +
      "endpoint/parameters are optional structured hints for REST endpoints (omit them for " +
      "GraphQL/gRPC/CLI/jobs). The change is appended to the element's version history. The " +
      "canvas updates live.",
    inputSchema: {
      elementId: z.string().min(1).describe("Target design element id (from find_element)."),
      title: ApiBinding.shape.title.describe("Short label for the endpoint/feature."),
      description: ApiBinding.shape.description.describe(
        "Markdown docs: what it does, params, request/response, gotchas.",
      ),
      language: ApiBinding.shape.language.describe(
        'Language/framework tag, e.g. "Python/FastAPI", "Go", "GraphQL".',
      ),
      method: ApiBinding.shape.method.describe("HTTP method, for REST endpoints only."),
      endpoint: ApiBinding.shape.endpoint.describe("HTTP path, e.g. /api/v1/users/login."),
      parameters: ApiBinding.shape.parameters.describe("Named parameters, if any."),
      changeLog: z
        .string()
        .optional()
        .describe("One-line summary of this change for the version history."),
    },
  },
  async ({ elementId, changeLog, ...fields }) => {
    try {
      const cfg = getConfig();
      const existed = Boolean(
        (await fetchElements(cfg)).find((e) => e.id === elementId)?.apiBinding,
      );
      const binding = ApiBinding.parse(fields);
      await bindApiToElement(cfg, elementId, binding, {
        version: new Date().toISOString(),
        author: AGENT,
        action: existed ? "modified" : "created",
        changeLog:
          changeLog ?? (existed ? "Update API documentation" : "Add API documentation"),
      });
      return ok({ elementId, title: binding.title, action: existed ? "updated" : "created" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

// --- write: remove an element's docs ---------------------------------------
server.registerTool(
  "remove_documentation",
  {
    title: "Remove documentation from an element",
    description:
      "Strip the API documentation off one design element (the design element itself is " +
      "untouched). Records the removal in the version history.",
    inputSchema: {
      elementId: z.string().min(1).describe("The design element id to clear."),
      changeLog: z.string().optional().describe("Why it was removed."),
    },
  },
  async ({ elementId, changeLog }) => {
    try {
      const cfg = getConfig();
      // Snapshot the endpoint's title before removing so the timeline can still
      // label the deletion (its binding is about to be gone).
      const title = (await fetchElements(cfg)).find((e) => e.id === elementId)
        ?.apiBinding?.title;
      await unbindApiFromElement(cfg, elementId, {
        version: new Date().toISOString(),
        author: AGENT,
        action: "deleted",
        ...(title ? { endpoint: { title } } : {}),
        changeLog: changeLog ?? "Removed API documentation",
      });
      return ok({ elementId, action: "removed" });
    } catch (err) {
      return fail((err as Error).message);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[adc-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[adc-mcp] fatal:", err);
  process.exit(1);
});
