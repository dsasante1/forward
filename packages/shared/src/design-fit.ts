/**
 * Geometry checks for design elements written without seeing the canvas — an
 * agent, a script, `create_design`. Pure and browser-safe.
 *
 * Text on the canvas is one SVG `<text>`: it never wraps, a `\n` starts a new
 * line 1.2em lower, and the first baseline sits one font size below the box's
 * top. So a text element's box is only a hit area; what it needs is the run's
 * natural size, which {@link estimateTextSize} approximates without fonts.
 */

type Box = { x: number; y: number; width: number; height: number };

/** The canvas default when a text element has no `fontSize`. */
export const DEFAULT_FONT_SIZE = 16;

/**
 * Roughly how big `text` renders: the widest line at an average glyph width
 * (wider for bold, for CJK and for emoji), by one line per `\n`. Errs a little
 * large, so a box sized from it holds the text in common sans-serif fonts.
 */
export function estimateTextSize(
  text: string,
  style: { fontSize?: number; fontWeight?: number } = {},
): { width: number; height: number } {
  const size = style.fontSize ?? DEFAULT_FONT_SIZE;
  const em = (style.fontWeight ?? 400) >= 600 ? 0.6 : 0.56;
  const lines = text.split("\n");
  let widest = 0;
  for (const line of lines) {
    let units = 0;
    for (const ch of line) {
      const code = ch.codePointAt(0)!;
      if (code >= 0x1f000 || (code >= 0x2e80 && code <= 0xffef)) units += 1.0 / em; // emoji, CJK: about 1em
      else if (/[ilj.,:;'|!]/.test(ch)) units += 0.5;
      else if (/[mwMW@]/.test(ch)) units += 1.5;
      else units += 1;
    }
    widest = Math.max(widest, units);
  }
  return {
    width: Math.ceil(widest * em * size),
    height: Math.ceil(size * (1.25 + 1.2 * (lines.length - 1))),
  };
}

/** True when `child` and `parent` don't overlap at all. */
export function outsideParent(child: Box, parent: Box): boolean {
  return (
    child.x >= parent.x + parent.width ||
    child.x + child.width <= parent.x ||
    child.y >= parent.y + parent.height ||
    child.y + child.height <= parent.y
  );
}

/**
 * Plain-language problems with where an element sits and how big it is, for a
 * tool to hand back to whoever placed it: entirely outside its parent, past one
 * of its parent's edges, or (for text) a box smaller than the text it holds.
 */
export function fitWarnings(
  el: Box & { name?: string; type: string; text?: string; style?: { fontSize?: number; fontWeight?: number } },
  parent?: Box & { name?: string },
): string[] {
  const out: string[] = [];
  const label = el.name ? `"${el.name}"` : "The element";
  if (parent) {
    const of = parent.name ? `"${parent.name}"` : "its parent";
    if (outsideParent(el, parent)) {
      out.push(
        `${label} at (${el.x}, ${el.y}) is entirely outside ${of} (${parent.x}, ${parent.y}, ${parent.width}×${parent.height}). ` +
          "Coordinates are absolute canvas positions; pass relative:true to place it relative to the parent.",
      );
    } else {
      const over = [
        ["left", parent.x - el.x],
        ["top", parent.y - el.y],
        ["right", el.x + el.width - (parent.x + parent.width)],
        ["bottom", el.y + el.height - (parent.y + parent.height)],
      ] as const;
      const past = over.filter(([, d]) => d > 0.5).map(([side, d]) => `${side} by ${Math.round(d)}px`);
      if (past.length) out.push(`${label} extends past ${of}'s ${past.join(", ")}.`);
    }
  }
  if (el.type === "text" && el.text) {
    const need = estimateTextSize(el.text, el.style);
    if (need.width > el.width + 2 || need.height > el.height + 2) {
      out.push(
        `${label}'s text needs about ${need.width}×${need.height} but its box is ${el.width}×${el.height}. ` +
          "Text doesn't wrap on the canvas: widen the box, or break lines with \\n (omit width/height to size it to the text).",
      );
    }
  }
  return out;
}
