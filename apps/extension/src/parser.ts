import { ApiPayload, HttpMethod } from "@adc/shared";

/**
 * MVP scope: Express-style route declarations only.
 *
 *   app.post('/api/v1/login', handler)
 *   router.get("/users/:id", a, b)
 *
 * Other frameworks (Fastify, Nest decorators) are deliberately out of scope for
 * v1 — keep the supported dialect explicit and well tested rather than guessing
 * across many. Add new dialects as new branches with their own tests.
 *
 * Beyond the route line, the parser inspects the *handler body* in the same
 * selection to infer:
 *   - request body fields   (req.body.x  /  const { a, b } = req.body)
 *   - a response sample      (res.json({...}) / res.send({...}))
 * so endpoints arrive on the canvas with a schema, not just method + path.
 */

const ROUTE_RE =
  /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/i;

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Extract `:param` style path params, e.g. /users/:id -> ["id"]. */
function pathParams(endpoint: string): string[] {
  const out: string[] = [];
  for (const m of endpoint.matchAll(/:([A-Za-z0-9_]+)/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Infer request-body fields from the handler. Two common shapes:
 *   req.body.email                         -> "email"
 *   const { email, password } = req.body   -> "email", "password"
 * Returns a field->type map (type is best-effort, defaults to "string").
 */
function inferRequestBody(code: string): Record<string, string> | undefined {
  const fields = new Map<string, string>();

  // Dotted access: req.body.fieldName / request.body.fieldName
  for (const m of code.matchAll(/\breq(?:uest)?\.body\.([A-Za-z0-9_]+)/g)) {
    if (m[1]) fields.set(m[1], "string");
  }

  // Destructured: const { a, b, c } = req.body
  for (const m of code.matchAll(/\{([^{}]+)\}\s*=\s*req(?:uest)?\.body\b/g)) {
    const inner = m[1];
    if (!inner) continue;
    for (const raw of inner.split(",")) {
      // handle `name: alias` and `name = default` -> take the source key
      const name = raw.split(/[:=]/)[0]?.trim() ?? "";
      if (IDENTIFIER_RE.test(name)) fields.set(name, "string");
    }
  }

  return fields.size ? Object.fromEntries(fields) : undefined;
}

/**
 * Infer a response sample from the first res.json({...}) / res.send({...}).
 * We don't eval — we extract the object literal text and turn keys into typed
 * placeholders so the canvas has something to render.
 */
function inferResponseSample(code: string): Record<string, unknown> | undefined {
  const m = /\bres(?:ponse)?\.(?:json|send)\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(
    code,
  );
  const body = m?.[1];
  if (!body) return undefined;

  const sample: Record<string, unknown> = {};
  for (const km of body.matchAll(/([A-Za-z0-9_]+)\s*:/g)) {
    if (km[1]) sample[km[1]] = "string";
  }
  return Object.keys(sample).length ? sample : undefined;
}

/**
 * Parse a highlighted snippet into an ApiPayload.
 * Returns null when no recognised route is found (caller surfaces a message).
 */
export function parseHighlightedCode(code: string): ApiPayload | null {
  const match = ROUTE_RE.exec(code);
  const rawMethod = match?.[1];
  const endpoint = match?.[2];
  if (!rawMethod || !endpoint) return null;

  const method = HttpMethod.parse(rawMethod.toUpperCase());

  return ApiPayload.parse({
    endpoint,
    method,
    parameters: pathParams(endpoint),
    requestBody: inferRequestBody(code),
    responseSample: inferResponseSample(code),
  });
}
