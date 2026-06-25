import type { Entity, EntityRelation, RelationCardinality } from "./schema.js";

/**
 * The export/print renderer for the entity (ER / data-model) layer, as UML via
 * Mermaid. Where `infra-flow.ts` covers the behavioural (sequence) and structural
 * (component) UML grammars, this covers the **data** grammar: the entities that
 * make up the domain and the crow's-foot associations between them — a Mermaid
 * `erDiagram`.
 *
 * Like the infra serializers it is a pure function of the same single source of
 * truth (the Entity + EntityRelation graph the canvas would draw from), so no
 * state is duplicated.
 */

/**
 * Crow's-foot glyph for the cardinality at the LEFT (`from`) end of a relation.
 * Mermaid mirrors the glyph between the two ends, so left and right differ.
 */
const LEFT: Record<RelationCardinality, string> = {
  "zero-or-one": "|o",
  "exactly-one": "||",
  "zero-or-many": "}o",
  "one-or-many": "}|",
};

/** Crow's-foot glyph for the cardinality at the RIGHT (`to`) end of a relation. */
const RIGHT: Record<RelationCardinality, string> = {
  "zero-or-one": "o|",
  "exactly-one": "||",
  "zero-or-many": "o{",
  "one-or-many": "|{",
};

/**
 * Mermaid forbids newlines mid-label; collapse them and trim so the diagram stays
 * valid whatever an entity name, field or note holds.
 */
function clean(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Escape a user-supplied label for inclusion in Mermaid source. The canvas
 * renders these diagrams with `securityLevel: "loose"`, so Mermaid emits label
 * text verbatim — a raw `<` would be a stored-XSS vector. Entity-escape the
 * HTML-significant characters (`&` first so introduced entities aren't
 * re-escaped) and the double-quote, since names/notes are emitted quoted.
 */
function escapeLabel(s: string): string {
  return clean(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Mermaid attribute `type`/`name` tokens must be bare identifiers (no spaces or
 * punctuation). Collapse anything else to underscores so e.g. "first name" or
 * "varchar(50)" still render; fall back to a placeholder if nothing survives.
 */
function token(s: string, fallback: string): string {
  const t = clean(s)
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return t || fallback;
}

/**
 * Serialise an ER model to a UML **entity-relationship diagram** (Mermaid
 * `erDiagram`). Each entity becomes a table block of `type name KEYS "note"`
 * attribute rows (a fieldless entity renders as a bare, quoted name so isolated
 * tables still appear). Each relation becomes a crow's-foot association whose end
 * glyphs come from the per-end cardinality and whose line is solid (identifying)
 * or dashed (non-identifying). Entity names are emitted quoted so spaces are
 * allowed and the text is XSS-escaped. Relations referencing an entity not in the
 * list are skipped — the same "skip dangling" rule the infra serializers use.
 */
export function entityToMermaid(
  entities: Entity[],
  relations: EntityRelation[],
): string {
  const lines = ["erDiagram"];
  // entity id -> the quoted display name used in both the block and relations.
  const names = new Map<string, string>();

  for (const e of entities) {
    const name = `"${escapeLabel(e.name)}"`;
    names.set(e.id, name);
    if (e.fields.length === 0) {
      // A lone entity with no attributes — declare it by name alone.
      lines.push(`  ${name}`);
      continue;
    }
    lines.push(`  ${name} {`);
    for (const f of e.fields) {
      const type = token(f.type, "string");
      const fname = token(f.name, "field");
      const keys = f.keys.length ? ` ${f.keys.join(", ")}` : "";
      const note = f.note ? ` "${escapeLabel(f.note)}"` : "";
      lines.push(`    ${type} ${fname}${keys}${note}`);
    }
    lines.push("  }");
  }

  for (const r of relations) {
    const a = names.get(r.from);
    const b = names.get(r.to);
    if (!a || !b) continue; // dangling entity — skip, mirroring the infra serializers
    const line = r.identifying ? "--" : "..";
    const rel = `${LEFT[r.fromCardinality]}${line}${RIGHT[r.toCardinality]}`;
    const label = escapeLabel(r.label ?? "") || "—";
    lines.push(`  ${a} ${rel} ${b} : "${label}"`);
  }

  return lines.join("\n");
}
