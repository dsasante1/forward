import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown.js";

describe("parseMarkdown", () => {
  it("splits paragraphs, keeps line breaks, and recognises lists", () => {
    expect(parseMarkdown("Creates a user.\nReturns 201.\n\n- email\n- password\n\n1. send\n2. wait")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "Creates a user." }], [{ kind: "text", text: "Returns 201." }]] },
      { kind: "ul", items: [[{ kind: "text", text: "email" }], [{ kind: "text", text: "password" }]] },
      { kind: "ol", items: [[{ kind: "text", text: "send" }], [{ kind: "text", text: "wait" }]] },
    ]);
  });

  it("treats a block mixing list items and prose as a paragraph", () => {
    expect(parseMarkdown("Body:\n- email")[0]?.kind).toBe("p");
  });
});

describe("parseInline", () => {
  it("parses code, emphasis and http(s) links", () => {
    expect(parseInline("POST `/login` is **fast**, _cached_, see [docs](https://x.dev/a)")).toEqual([
      { kind: "text", text: "POST " },
      { kind: "code", text: "/login" },
      { kind: "text", text: " is " },
      { kind: "strong", text: "fast" },
      { kind: "text", text: ", " },
      { kind: "em", text: "cached" },
      { kind: "text", text: ", see " },
      { kind: "link", text: "docs", href: "https://x.dev/a" },
    ]);
  });

  it("leaves raw HTML and non-http links as text", () => {
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([{ kind: "text", text: '<img src=x onerror="alert(1)">' }]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
  });
});
