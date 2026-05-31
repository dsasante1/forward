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
    expect(result?.method).toBe(method);
    expect(result?.parameters).toEqual(params);
  });

  it("returns null for a non-route selection", () => {
    expect(parseHighlightedCode("const x = doThing(42)")).toBeNull();
  });

  it("extracts the exact endpoint string", () => {
    expect(parseHighlightedCode(`app.post('/api/v1/login', h)`)?.endpoint).toBe(
      "/api/v1/login",
    );
  });
});

describe("request-body inference", () => {
  it("picks up dotted req.body access", () => {
    const code = `
      app.post('/api/v1/login', (req, res) => {
        const email = req.body.email;
        if (!req.body.password) return res.sendStatus(400);
      })`;
    const result = parseHighlightedCode(code);
    expect(result?.requestBody).toEqual({ email: "string", password: "string" });
  });

  it("picks up destructured req.body", () => {
    const code = `
      app.put('/api/v1/users/:id', (req, res) => {
        const { name, age, email } = req.body;
      })`;
    const result = parseHighlightedCode(code);
    expect(result?.requestBody).toEqual({
      name: "string",
      age: "string",
      email: "string",
    });
  });

  it("handles aliased and defaulted destructure keys", () => {
    const code = `
      app.post('/x', (req, res) => {
        const { email: mail, count = 0 } = req.body;
      })`;
    const result = parseHighlightedCode(code);
    expect(result?.requestBody).toEqual({ email: "string", count: "string" });
  });

  it("supports the request.body long form", () => {
    const code = `app.post('/x', (request, res) => { request.body.token })`;
    expect(parseHighlightedCode(code)?.requestBody).toEqual({ token: "string" });
  });

  it("leaves requestBody undefined when nothing is read", () => {
    const code = `app.get('/ping', (req, res) => res.send('ok'))`;
    expect(parseHighlightedCode(code)?.requestBody).toBeUndefined();
  });
});

describe("response-sample inference", () => {
  it("extracts keys from res.json({...})", () => {
    const code = `
      app.post('/api/v1/login', (req, res) => {
        return res.json({ status: 'success', token: jwt });
      })`;
    const result = parseHighlightedCode(code);
    expect(result?.responseSample).toEqual({
      status: "string",
      token: "string",
    });
  });

  it("supports res.send({...}) and the response long form", () => {
    const code = `app.get('/me', (req, response) => response.send({ id: 1 }))`;
    expect(parseHighlightedCode(code)?.responseSample).toEqual({ id: "string" });
  });

  it("leaves responseSample undefined for a string response", () => {
    const code = `app.get('/ping', (req, res) => res.send('ok'))`;
    expect(parseHighlightedCode(code)?.responseSample).toBeUndefined();
  });

  it("produces a full payload end to end", () => {
    const code = `
      router.post('/api/v1/users/:teamId/invite', auth, (req, res) => {
        const { email, role } = req.body;
        res.json({ invited: true, id: newId });
      })`;
    const result = parseHighlightedCode(code);
    expect(result).toMatchObject({
      method: "POST",
      endpoint: "/api/v1/users/:teamId/invite",
      parameters: ["teamId"],
      requestBody: { email: "string", role: "string" },
      responseSample: { invited: "string", id: "string" },
    });
  });
});
