import { describe, it, expect } from "vitest";
import { commentFor } from "./comment.js";

const A = '@adc el_x "Login"';

describe("commentFor", () => {
  it.each([
    ["typescript", `// ${A}`],
    ["html", `<!-- ${A} -->`],
    ["css", `/* ${A} */`],
    ["python", `# ${A}`],
    ["graphql", `# ${A}`],
    ["lua", `-- ${A}`],
    ["haskell", `-- ${A}`],
    ["erlang", `% ${A}`],
    ["clojure", `; ${A}`],
    ["fortran", `! ${A}`],
    ["vb", `' ${A}`],
    ["bat", `REM ${A}`],
    ["ocaml", `(* ${A} *)`],
  ])("uses the %s comment syntax", (lang, expected) => {
    expect(commentFor(lang, A)).toBe(expected);
  });

  it("falls back to // for an unknown language", () => {
    expect(commentFor("some-new-lang", A)).toBe(`// ${A}`);
  });
});
