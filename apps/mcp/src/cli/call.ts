import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../tools.js";
import { VERSION } from "../version.js";

/**
 * The CLI's window onto the agent tools: an in-memory MCP client wired to the
 * same McpServer that `forward-mcp` serves over stdio. No subprocess, no
 * duplication — `forward call write_documentation …` runs exactly the code an
 * MCP agent would.
 */
let client: Client | undefined;

async function connect(): Promise<Client> {
  if (client) return client;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "forward-cli", version: VERSION });
  await client.connect(clientSide);
  return client;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  default?: unknown;
  anyOf?: JsonSchema[];
}

export async function listTools(): Promise<ToolInfo[]> {
  const c = await connect();
  const { tools } = await c.listTools();
  return tools as ToolInfo[];
}

export interface CallResult {
  text: string;
  isError: boolean;
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const c = await connect();
  // A live capture of many routes takes longer than the SDK's 60s default;
  // each step has its own limit, so this is only a backstop.
  const res = await c.callTool({ name, arguments: args }, undefined, { timeout: 30 * 60_000 });
  const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n");
  return { text, isError: Boolean(res.isError) };
}

export async function close(): Promise<void> {
  await client?.close();
}

/**
 * Turn `--key value` flags into tool arguments, coercing each value to the
 * type the tool's JSON Schema expects. Arrays accept JSON or a comma list;
 * objects accept JSON.
 */
export function coerceFlags(
  tool: ToolInfo,
  flags: Record<string, string | boolean>,
): Record<string, unknown> {
  const props = tool.inputSchema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(flags)) {
    const key = props[rawKey] ? rawKey : camel(rawKey);
    const prop = props[key];
    if (!prop) throw new Error(`Unknown argument --${rawKey}. Run \`forward tools ${tool.name}\` to see its arguments.`);
    out[key] = coerce(value, prop, rawKey);
  }
  return out;
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function typeOf(prop: JsonSchema): string | undefined {
  if (typeof prop.type === "string") return prop.type;
  if (Array.isArray(prop.type)) return prop.type.find((t) => t !== "null");
  return prop.anyOf?.map(typeOf).find(Boolean);
}

function coerce(value: string | boolean, prop: JsonSchema, key: string): unknown {
  const type = typeOf(prop);
  if (typeof value === "boolean") {
    if (type === "boolean" || type === undefined) return value;
    throw new Error(`--${key} needs a value.`);
  }
  switch (type) {
    case "number":
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`--${key} must be a number.`);
      return n;
    }
    case "boolean":
      return value === "true" || value === "1" || value === "yes";
    case "array":
      if (value.trim().startsWith("[")) return JSON.parse(value);
      return value.split(",").map((s) => s.trim()).filter(Boolean)
        .map((s) => (prop.items && typeOf(prop.items) === "number" ? Number(s) : s));
    case "object":
      return JSON.parse(value);
    default:
      return value;
  }
}
