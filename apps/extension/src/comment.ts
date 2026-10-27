// Comment syntax per VS Code language id, for inserting `@adc` anchors. Kept
// free of the `vscode` import so it can be unit-tested. The anchor parser is
// comment-agnostic (it only looks for the `@adc` token), so this only has to
// produce a comment the file's own language accepts.

const BLOCK: Record<string, [string, string]> = {};
const LINE: Record<string, string> = {};

function block(open: string, close: string, ids: string[]): void {
  for (const id of ids) BLOCK[id] = [open, close];
}
function line(prefix: string, ids: string[]): void {
  for (const id of ids) LINE[id] = prefix;
}

block("<!--", "-->", ["html", "xml", "xsl", "svg", "markdown", "vue", "svelte", "handlebars"]);
block("/*", "*/", ["css", "scss", "less"]);
block("(*", "*)", ["ocaml"]);
line("#", [
  "python", "ruby", "shellscript", "yaml", "dockerfile", "makefile", "toml",
  "perl", "r", "elixir", "coffeescript", "powershell", "graphql", "terraform",
  "julia", "nim", "nix", "tcl", "properties", "dotenv", "crystal",
]);
line("--", ["sql", "plsql", "lua", "haskell", "elm", "ada", "purescript"]);
line("%", ["erlang", "matlab", "latex", "tex", "bibtex", "prolog"]);
line(";", ["clojure", "lisp", "scheme", "racket", "ini"]);
line("!", ["fortran", "fortran-modern", "FortranFreeForm"]);
line("'", ["vb"]);
line("REM", ["bat"]);

/** Wrap `text` in the line/block comment syntax for the given editor language. */
export function commentFor(languageId: string, text: string): string {
  const b = BLOCK[languageId];
  if (b) return `${b[0]} ${text} ${b[1]}`;
  return `${LINE[languageId] ?? "//"} ${text}`;
}
