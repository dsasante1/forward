import createDOMPurify from "isomorphic-dompurify";

const DOMPurify = createDOMPurify;

/**
 * Strip any embedded HTML from user-authored Markdown before it is stored.
 *
 * Liability #8: `description`/`text` fields are free-form Markdown rendered on the
 * canvas. Once the product is multi-tenant, one user's stored content renders in
 * another user's browser — a stored-XSS vector. Markdown itself is fine; the risk
 * is raw HTML smuggled inside it (`<img onerror=…>`, `<script>`). We render
 * Markdown elsewhere, so we forbid HTML tags entirely here.
 *
 * This is the write-side defense; keep the render-side sanitizer too (belt and
 * braces) on whichever surface turns Markdown into HTML.
 */
export function sanitizeMarkdown(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
}

/** Apply `sanitizeMarkdown` to the given string keys of an object, in place-safe copy. */
export function sanitizeFields<T extends Record<string, unknown>>(
  obj: T,
  keys: ReadonlyArray<keyof T>,
): T {
  const out = { ...obj };
  for (const key of keys) {
    const v = out[key];
    if (typeof v === "string") {
      out[key] = sanitizeMarkdown(v) as T[keyof T];
    }
  }
  return out;
}
