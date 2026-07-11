import { describe, it, expect } from "vitest";
import { entityToMermaid } from "./entity.js";
import { Entity, EntityRelation } from "./schema.js";

function entity(
  id: string,
  name: string,
  fields: Entity["fields"] = [],
  extra: Partial<Entity> = {},
): Entity {
  return Entity.parse({
    id,
    name,
    fields,
    x: 0,
    y: 0,
    updatedAt: "2026-05-28T11:45:00Z",
    ...extra,
  });
}

function relation(
  id: string,
  from: string,
  to: string,
  extra: Partial<EntityRelation> = {},
): EntityRelation {
  return EntityRelation.parse({
    id,
    from,
    to,
    updatedAt: "2026-05-28T11:45:00Z",
    ...extra,
  });
}

describe("entityToMermaid (ER diagram)", () => {
  it("renders entities as attribute blocks with types and key roles", () => {
    const entities = [
      entity("cust", "Customer", [
        { name: "id", type: "uuid", keys: ["PK"] },
        { name: "email", type: "varchar", keys: ["UK"], note: "case-insensitive" },
      ]),
      entity("order", "Order", [
        { name: "id", type: "uuid", keys: ["PK"] },
        { name: "customer_id", type: "uuid", keys: ["FK"] },
      ]),
    ];
    const out = entityToMermaid(entities, []);
    expect(out).toContain("erDiagram");
    expect(out).toContain('"Customer" {');
    expect(out).toContain("uuid id PK");
    expect(out).toContain('varchar email UK "case-insensitive"');
    expect(out).toContain("uuid customer_id FK");
  });

  it("emits the mirrored crow's-foot glyphs from per-end cardinality", () => {
    const entities = [entity("a", "Customer"), entity("b", "Order")];
    const out = entityToMermaid(entities, [
      relation("r1", "a", "b", {
        fromCardinality: "exactly-one",
        toCardinality: "zero-or-many",
        label: "places",
      }),
    ]);
    expect(out).toContain('"Customer" ||--o{ "Order" : "places"');
  });

  it("uses a dashed line for a non-identifying relation", () => {
    const entities = [entity("a", "User"), entity("b", "Profile")];
    const out = entityToMermaid(entities, [
      relation("r1", "a", "b", {
        fromCardinality: "exactly-one",
        toCardinality: "zero-or-one",
        identifying: false,
      }),
    ]);
    expect(out).toContain('"User" ||..o| "Profile" : "—"');
  });

  it("declares a fieldless entity by name alone (no empty block)", () => {
    const out = entityToMermaid([entity("a", "Activity")], []);
    expect(out).toContain('"Activity"');
    expect(out).not.toContain("{");
  });

  it("allows spaces in entity names by quoting them", () => {
    const entities = [
      entity("inv", "Invoice Line Item", [{ name: "id", type: "uuid", keys: ["PK"] }]),
    ];
    expect(entityToMermaid(entities, [])).toContain('"Invoice Line Item" {');
  });

  it("collapses punctuation/spaces in attribute type and name to tokens", () => {
    const entities = [
      entity("a", "Thing", [{ name: "first name", type: "varchar(50)" }]),
    ];
    expect(entityToMermaid(entities, [])).toContain("varchar_50 first_name");
  });

  it("entity-escapes names, notes and labels (XSS-safe)", () => {
    const entities = [
      entity("a", '<img src=x onerror="alert(1)">', [
        { name: "f", type: "t", keys: [], note: "<b>bad</b>" },
      ]),
      entity("b", "Safe"),
    ];
    const out = entityToMermaid(entities, [
      relation("r1", "a", "b", { label: "<script>x</script>" }),
    ]);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;img");
    expect(out).toContain("&lt;script>");
  });

  it("skips relations referencing an entity missing from the list", () => {
    const out = entityToMermaid(
      [entity("a", "Real")],
      [relation("r1", "a", "ghost", { label: "nowhere" })],
    );
    expect(out).not.toContain("nowhere");
  });
});
