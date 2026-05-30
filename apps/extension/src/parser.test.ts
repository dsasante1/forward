import { describe, it, expect } from "vitest";
import { parseHighlightedCode } from "./parser.js";

describe("parseHighlightedCode (Express dialect)", () => {
  const cases: Array<[string, string, string, string[]]> = [
    [
      "app.post single quotes",
      `app.post('/api/v1/login', (req, res) => {})`,
      "POST",
      [],
    ],
    [
      "router.get with param",
      `router.get("/users/:id", auth, handler)`,
      "GET",
      ["id"],
    ],
    [
      "app.delete template literal",
      "app.delete(`/api/v1/posts/:postId`, h)",
      "DELETE",
      ["postId"],
    ],
    [
      "uppercase method call normalises",
      `app.PUT('/items/:itemId/tags/:tagId', h)`,
      "PUT",
      ["itemId", "tagId"],
    ],
  ];

  it.each(cases)("parses %s", (_name, code, method, params) => {
    const result = parseHighlightedCode(code);
    expect(result).not.toBeNull();
    expect(result!.method).toBe(method);
    expect(result!.parameters).toEqual(params);
  });

  it("returns null for a non-route selection", () => {
    expect(parseHighlightedCode("const x = doThing(42)")).toBeNull();
  });

  it("extracts the exact endpoint string", () => {
    expect(parseHighlightedCode(`app.post('/api/v1/login', h)`)!.endpoint).toBe(
      "/api/v1/login",
    );
  });
});
