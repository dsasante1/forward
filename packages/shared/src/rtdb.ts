/**
 * Firebase RTDB list helpers.
 *
 * The RTDB has no real arrays. A path written with `push()` (REST POST) comes
 * back as a *push-keyed object* — `{ "-Nxyz": {...}, "-Nabc": {...} }` — while a
 * path written as a literal array comes back as an array. The same logical list
 * can therefore arrive in either shape, so always normalize on read.
 */
export function normalizeList<T = unknown>(value: unknown): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    // Firebase drops null holes; filter them defensively.
    return value.filter((v) => v != null) as T[];
  }
  if (typeof value === "object") {
    // Push-keyed object. Keys are time-ordered, so sort to preserve order.
    return Object.entries(value as Record<string, T>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => v)
      .filter((v) => v != null);
  }
  return [];
}
