/**
 * A deliberately small, safe Markdown subset for API docs: paragraphs (with
 * line breaks), bullet and numbered lists, inline code, bold, italic and
 * http(s) links. Raw HTML is always plain text: the output is built from DOM
 * nodes, never parsed from a string. Used by the canvas doc callouts and the
 * inspector's Docs tab.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code" | "strong" | "em"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "ul" | "ol"; items: Inline[][] };

const LIST_ITEM = /^(\s*)([-*+] |\d+\. )(.*)$/;
const INLINE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;

/** Split Markdown into blocks; a block whose every line is a list item is a list. */
export function parseMarkdown(markdown: string): Block[] {
  return markdown
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): Block => {
      const lines = block.split("\n");
      const items = lines.map((line) => LIST_ITEM.exec(line));
      if (items.every(Boolean)) {
        return { kind: /^\s*\d+\. /.test(lines[0] ?? "") ? "ol" : "ul", items: items.map((m) => parseInline(m?.[3] ?? "")) };
      }
      return { kind: "p", lines: lines.map(parseInline) };
    });
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ kind: "text", text: source.slice(last, index) });
    if (m[2]) out.push({ kind: "link", text: m[1] ?? "", href: m[2] });
    else if (m[3]) out.push({ kind: "code", text: m[3] });
    else if (m[4] || m[5]) out.push({ kind: "strong", text: m[4] ?? m[5] ?? "" });
    else out.push({ kind: "em", text: m[6] ?? m[7] ?? "" });
    last = index + m[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

// XHTML elements work both in the page and inside an SVG foreignObject.
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const el = (tag: string): Element => document.createElementNS(XHTML_NS, tag);

/** Append the rendered Markdown to `host`. */
export function appendMarkdown(host: Element, markdown: string): void {
  for (const block of parseMarkdown(markdown)) {
    if (block.kind === "p") {
      const p = el("p");
      block.lines.forEach((line, i) => {
        if (i) p.append(el("br"));
        appendInline(p, line);
      });
      host.append(p);
    } else {
      const list = el(block.kind);
      for (const item of block.items) {
        const li = el("li");
        appendInline(li, item);
        list.append(li);
      }
      host.append(list);
    }
  }
}

function appendInline(host: Element, parts: Inline[]): void {
  for (const part of parts) {
    if (part.kind === "text") {
      host.append(document.createTextNode(part.text));
      continue;
    }
    const node = el(part.kind === "link" ? "a" : part.kind);
    if (part.kind === "link") {
      node.setAttribute("href", part.href);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    node.textContent = part.text;
    host.append(node);
  }
}
