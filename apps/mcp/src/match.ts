import type { DesignElement } from "schema-nexus-core";

/**
 * The linking problem, solved fuzzily: given a natural-language description of a
 * feature ("the login form", "user profile page") an agent just finished, rank
 * the design elements a designer drew by how well their name/text/type match —
 * so the agent can pick (or confirm) which element to document without a human
 * scrolling a quick-pick.
 *
 * This is deliberately dependency-free and deterministic (no embeddings/LLM): a
 * token-overlap score with a partial-match (prefix) fallback. It returns every
 * element ranked, never throwing away candidates, so the caller can show the top
 * few and let the agent or developer disambiguate. For an unambiguous,
 * re-runnable link, anchor the element id in code instead (see the README).
 */

export interface Candidate {
  id: string;
  name: string;
  type: string;
  text?: string;
  /** Higher is a better match; 0 means nothing in the query overlapped. */
  score: number;
}

// Words that carry no signal for matching a feature to a design element.
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with",
  "api", "endpoint", "feature", "page", "screen", "view", "component",
  "button", "form", "field", "element", "design", "just", "new",
]);

function tokens(s: string | undefined): string[] {
  if (!s) return [];
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOP.has(t),
  );
}

/** Does either token contain the other? Catches "auth" ↔ "authentication". */
function partial(a: string, b: string): boolean {
  return a !== b && (a.startsWith(b) || b.startsWith(a));
}

function scoreElement(queryTokens: string[], el: DesignElement): number {
  const hay = [
    ...tokens(el.name),
    ...tokens(el.text),
    ...tokens(el.type),
  ];
  if (!hay.length) return 0;
  const haySet = new Set(hay);

  let score = 0;
  for (const q of queryTokens) {
    if (haySet.has(q)) {
      score += 2; // exact token hit
    } else if (hay.some((h) => partial(h, q))) {
      score += 1; // prefix/partial hit
    }
  }
  return score;
}

/**
 * Rank `elements` against `query`, best first. Ties keep input order (stable
 * sort), and elements that already carry a binding are lightly de-prioritised so
 * a fresh, undocumented element wins an otherwise even match.
 */
export function rankElements(
  query: string,
  elements: DesignElement[],
): Candidate[] {
  const q = tokens(query);
  return elements
    .map((el, i): Candidate & { i: number } => {
      let score = scoreElement(q, el);
      if (score > 0 && el.apiBinding) score -= 0.5; // prefer the undocumented
      return {
        i,
        id: el.id,
        name: el.name,
        type: el.type,
        ...(el.text ? { text: el.text } : {}),
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ i: _i, ...c }) => c);
}
