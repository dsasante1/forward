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
  properties?: Record<string, JsonSchema>;
  required?: string[];
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

/** One step of `forward call --batch`: a tool call, optionally named for later steps. */
export interface BatchStep {
  tool: string;
  args?: Record<string, unknown>;
  /** A name later steps use in `$name.path` references (else `$<index>`). */
  as?: string;
}

export interface BatchOutcome {
  step: number;
  tool: string;
  as?: string;
  ok: boolean;
  result: unknown;
}

/**
 * Parse a batch file: a JSON array of steps, or one step per line (JSON Lines;
 * blank lines and lines starting with `#` or `//` are skipped).
 */
export function parseBatch(text: string): BatchStep[] {
  const trimmed = text.trim();
  const steps: unknown[] = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"))
        .map((l, i) => {
          try {
            return JSON.parse(l) as unknown;
          } catch (err) {
            throw new Error(`Batch line ${i + 1} is not JSON: ${(err as Error).message}`);
          }
        });
  return steps.map((raw, i) => {
    const step = raw as Partial<BatchStep>;
    if (!step || typeof step.tool !== "string") throw new Error(`Batch step ${i} needs a "tool" name.`);
    if (step.args !== undefined && (typeof step.args !== "object" || Array.isArray(step.args))) {
      throw new Error(`Batch step ${i} ("${step.tool}"): "args" must be an object.`);
    }
    return { tool: step.tool, ...(step.args ? { args: step.args } : {}), ...(step.as ? { as: step.as } : {}) };
  });
}

const REF = /^\$([A-Za-z_][\w-]*|\d+)((?:\.[\w-]+)*)$/;

/**
 * Replace every string that is exactly `$name.path` (or `$<index>.path`) with
 * that value from an earlier step's result, e.g. `"$frame.id"`, `"$0.refs.card"`.
 * A string that only contains a `$` elsewhere is left alone.
 */
export function resolveRefs(value: unknown, results: Map<string, unknown>): unknown {
  if (typeof value === "string") {
    const m = REF.exec(value);
    if (!m) return value;
    if (!results.has(m[1]!)) throw new Error(`"${value}": no earlier step named "${m[1]}".`);
    let out: unknown = results.get(m[1]!);
    for (const key of m[2]!.split(".").filter(Boolean)) {
      if (out === null || typeof out !== "object" || !(key in out)) throw new Error(`"${value}": the result of "${m[1]}" has no "${key}".`);
      out = (out as Record<string, unknown>)[key];
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, results));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results)]));
  }
  return value;
}

/**
 * Run steps in order through one client (one process, one connection), feeding
 * earlier results into later arguments. Stops at the first failing step.
 */
export async function runBatch(
  steps: BatchStep[],
  call: (tool: string, args: Record<string, unknown>) => Promise<CallResult> = callTool,
): Promise<BatchOutcome[]> {
  const results = new Map<string, unknown>();
  const out: BatchOutcome[] = [];
  for (const [i, step] of steps.entries()) {
    const label = { step: i, tool: step.tool, ...(step.as ? { as: step.as } : {}) };
    let args: Record<string, unknown>;
    try {
      args = resolveRefs(step.args ?? {}, results) as Record<string, unknown>;
    } catch (err) {
      out.push({ ...label, ok: false, result: (err as Error).message });
      break;
    }
    const res = await call(step.tool, args);
    let result: unknown = res.text;
    try {
      result = JSON.parse(res.text);
    } catch {
      // not JSON (markdown output, or an error message): keep the text
    }
    out.push({ ...label, ok: !res.isError, result });
    if (res.isError) break;
    results.set(String(i), result);
    if (step.as) results.set(step.as, result);
  }
  return out;
}