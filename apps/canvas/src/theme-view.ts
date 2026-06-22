/**
 * The Theme drawer (right panel): recolours the canvas surface and, on demand,
 * every shape on it. The background / accent are pure view chrome applied as CSS
 * custom properties on the canvas shadow host — local to this browser and never
 * persisted to the project. Only "Apply fill & border to all shapes" writes data
 * (each element's style, through the CanvasSource). The grid toggle is also a
 * local view preference.
 *
 * This module only draws; canvas.ts owns the theme state, applies it live, and
 * persists it to localStorage via the callbacks.
 */

/** The view-only theme: surface chrome + the fill/stroke "Apply to shapes" uses. */
export interface CanvasTheme {
  /** Canvas viewport background (the `--bg` custom property / grid backdrop). */
  canvasBg: string;
  /** Default shape fill — what "Apply fill & border to all shapes" writes. */
  surface: string;
  /** Default shape border — what "Apply fill & border to all shapes" writes. */
  stroke: string;
  /** Accent colour (selection, handles, active tools) — the `--accent` property. */
  accent: string;
  /** Whether the dotted alignment grid is drawn behind the design. */
  grid: boolean;
}

/** A one-click bundle that sets background + fill + border + accent together. */
export interface ThemePreset {
  name: string;
  canvasBg: string;
  surface: string;
  stroke: string;
  accent: string;
}

export interface ThemeCallbacks {
  onClose: () => void;
  /** Apply a live patch (background/accent recolour instantly; grid toggles). */
  onChange: (patch: Partial<CanvasTheme>) => void;
  /** Apply a whole preset bundle at once. */
  onApplyPreset: (preset: ThemePreset) => void;
  /** Persist the current fill + border onto every shape on the canvas. */
  onApplyToShapes: () => void;
}

/** Built-in presets, seeded from the design spec's palette. */
export const THEME_PRESETS: ThemePreset[] = [
  { name: "Midnight", canvasBg: "#0c0d11", surface: "#1a1d26", stroke: "#2d313c", accent: "#d06a40" },
  { name: "Slate", canvasBg: "#111418", surface: "#1d232b", stroke: "#39424d", accent: "#5b8fcf" },
  { name: "Paper", canvasBg: "#f4f1ea", surface: "#ffffff", stroke: "#d8d2c4", accent: "#c2562b" },
  { name: "Forest", canvasBg: "#0d1411", surface: "#16241d", stroke: "#2c4438", accent: "#5db98a" },
  { name: "Plum", canvasBg: "#120e16", surface: "#221a2a", stroke: "#3c3048", accent: "#9a7fd0" },
];

/** Swatch palettes for each role (first entry doubles as a sensible default). */
const BG_SWATCHES = ["#0c0d11", "#111418", "#0d1411", "#120e16", "#1a1410", "#f4f1ea"];
const FILL_SWATCHES = ["#1a1d26", "#1d232b", "#16241d", "#221a2a", "#2a2018", "#ffffff"];
const STROKE_SWATCHES = ["#2d313c", "#39424d", "#2c4438", "#3c3048", "#4a3a2a", "#d8d2c4"];
const ACCENT_SWATCHES = ["#d06a40", "#5b8fcf", "#9a7fd0", "#5db98a", "#bc9a64", "#d2603e"];

function hEl(tag: string, content = "", cls = ""): HTMLElement {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (cls) node.className = cls;
  return node;
}

/** A horizontal strip of colour swatches; clicking one fires `onPick`. */
function swatchRow(
  colors: string[],
  current: string,
  onPick: (color: string) => void,
): HTMLElement {
  const row = hEl("div", "", "th-swatches");
  for (const c of colors) {
    const sw = hEl("button", "", "th-swatch") as HTMLButtonElement;
    sw.type = "button";
    sw.style.background = c;
    sw.title = c;
    if (c.toLowerCase() === current.toLowerCase()) sw.classList.add("active");
    sw.addEventListener("click", () => onPick(c));
    row.append(sw);
  }
  return row;
}

function label(text: string): HTMLElement {
  return hEl("div", text, "th-label");
}

export function renderThemeView(
  host: HTMLElement,
  theme: CanvasTheme,
  cb: ThemeCallbacks,
): void {
  host.replaceChildren();

  const head = hEl("div", "", "th-head");
  head.append(hEl("h2", "Theme"));
  const close = hEl("button", "✕", "th-close") as HTMLButtonElement;
  close.title = "Close";
  close.addEventListener("click", cb.onClose);
  head.append(close);
  host.append(head);

  const body = hEl("div", "", "th-body");
  host.append(body);

  body.append(
    hEl(
      "p",
      "Set the canvas background and recolour every shape. Presets apply instantly; fine-tune each role below.",
      "th-intro",
    ),
  );

  // --- presets ---
  body.append(label("PRESETS"));
  const presets = hEl("div", "", "th-presets");
  for (const p of THEME_PRESETS) {
    const active =
      p.canvasBg.toLowerCase() === theme.canvasBg.toLowerCase() &&
      p.accent.toLowerCase() === theme.accent.toLowerCase();
    const btn = hEl("button", "", "th-preset") as HTMLButtonElement;
    btn.type = "button";
    if (active) btn.classList.add("active");
    const chips = hEl("span", "", "th-preset-chips");
    for (const c of [p.canvasBg, p.surface, p.accent]) {
      const chip = hEl("span", "", "th-preset-chip");
      chip.style.background = c;
      chips.append(chip);
    }
    btn.append(chips, hEl("span", p.name, "th-preset-name"));
    btn.addEventListener("click", () => cb.onApplyPreset(p));
    presets.append(btn);
  }
  body.append(presets);

  // --- per-role swatches ---
  body.append(label("CANVAS BACKGROUND"));
  body.append(swatchRow(BG_SWATCHES, theme.canvasBg, (c) => cb.onChange({ canvasBg: c })));

  body.append(label("SHAPE FILL"));
  body.append(swatchRow(FILL_SWATCHES, theme.surface, (c) => cb.onChange({ surface: c })));

  body.append(label("BORDERS"));
  body.append(swatchRow(STROKE_SWATCHES, theme.stroke, (c) => cb.onChange({ stroke: c })));

  body.append(label("ACCENT"));
  body.append(swatchRow(ACCENT_SWATCHES, theme.accent, (c) => cb.onChange({ accent: c })));

  // --- apply to shapes (the one persisted action) ---
  const apply = hEl("button", "Apply fill & border to all shapes", "th-apply") as HTMLButtonElement;
  apply.type = "button";
  apply.addEventListener("click", cb.onApplyToShapes);
  body.append(apply);

  // --- grid toggle ---
  const gridRow = hEl("div", "", "th-grid");
  gridRow.append(hEl("span", "Show grid", "th-grid-label"));
  const toggle = hEl("button", "", "th-toggle") as HTMLButtonElement;
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", String(theme.grid));
  toggle.classList.toggle("on", theme.grid);
  toggle.append(hEl("span", "", "th-knob"));
  toggle.addEventListener("click", () => cb.onChange({ grid: !theme.grid }));
  gridRow.append(toggle);
  body.append(gridRow);
}
