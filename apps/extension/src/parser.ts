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
 */

const ROUTE_RE =
  /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/i;

/** Extract `:param` style path params, e.g. /users/:id -> ["id"]. */
function pathParams(endpoint: string): string[] {
  return [...endpoint.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
}

/**
 * Parse a highlighted snippet into an ApiPayload.
 * Returns null when no recognised route is found (caller surfaces a message).
 */
export function parseHighlightedCode(code: string): ApiPayload | null {
  const match = ROUTE_RE.exec(code);
  if (!match) return null;

  const method = HttpMethod.parse(match[1]!.toUpperCase());
  const endpoint = match[2]!;

  return ApiPayload.parse({
    endpoint,
    method,
    parameters: pathParams(endpoint),
  });
}
