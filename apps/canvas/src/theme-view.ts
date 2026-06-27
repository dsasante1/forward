/**
 * The Theme drawer (right panel): recolours the whole editor UI (the rail,
 * panels, strips, text and accent) by swapping the CSS custom properties on the
 * canvas shadow host. It is pure view chrome — local to this browser and never
 * persisted to the project, and it deliberately leaves the design elements on
 * the canvas alone (those carry their own per-shape fill/stroke).
 *
 * This module only draws; canvas.ts owns the theme state, applies it live, and
 * persists it to localStorage via the callbacks.
 */

/** A full UI palette: every chrome surface/text/line/accent custom property. */
export interface ThemePalette {
  /** Canvas viewport background (the `--bg` custom property / grid backdrop). */
  bg: string;
  /** Top breadcrumb strip background (`--bg-strip`). */
  bgStrip: string;
  /** Left tool rail background (`--bg-rail`). */
  bgRail: string;
  /** Side panel background — layers + inspector (`--bg-panel`). */
  bgPanel: string;
  /** Raised surfaces: inputs, menus, cards (`--surface` … `--surface-4`). */
  surface: string;
  surface2: string;
  surface3: string;
  surface4: string;
  /** Hairline borders, light → heavy (`--line` … `--line-3`). */
  line: string;
  line2: string;
  line3: string;
  /** Foreground text, strong → faint (`--text` … `--faint`). */
  text: string;
  text2: string;
  text3: string;
  muted: string;
  muted2: string;
  faint: string;
  /** Accent colour (selection, handles, active tools) — the `--accent` property. */
  accent: string;
}

/** The view-only theme: a full UI palette plus the local grid preference. */
export interface CanvasTheme extends ThemePalette {
  /** Whether the dotted alignment grid is drawn behind the design. */
  grid: boolean;
}

/** A named, one-click UI palette. */
export interface ThemePreset extends ThemePalette {
  name: string;
}

export interface ThemeCallbacks {
  onClose: () => void;
  /** Apply a live patch (recolours the UI instantly; grid toggles). */
  onChange: (patch: Partial<CanvasTheme>) => void;
  /** Apply a whole preset palette at once. */
  onApplyPreset: (preset: ThemePreset) => void;
}

/** The "Midnight" palette — mirrors the CSS `:host` defaults and is the default. */
const MIDNIGHT: ThemePreset = {
  name: "Midnight",
  bg: "#0c0d11", bgStrip: "#101116", bgRail: "#131419", bgPanel: "#121319",
  surface: "#15171e", surface2: "#171920", surface3: "#1a1c23", surface4: "#191b22",
  line: "rgba(255, 255, 255, 0.06)", line2: "rgba(255, 255, 255, 0.09)", line3: "rgba(255, 255, 255, 0.12)",
  text: "#e8e5de", text2: "#cfccc4", text3: "#a9a7a0", muted: "#8d8b85", muted2: "#7d7c76", faint: "#6c6b65",
  accent: "#d06a40",
};

/** Built-in palettes. The first ("Midnight") doubles as the default theme. */
export const THEME_PRESETS: ThemePreset[] = [
  MIDNIGHT,
  {
    name: "Slate",
    bg: "#111418", bgStrip: "#14181d", bgRail: "#161a20", bgPanel: "#15191f",
    surface: "#1d232b", surface2: "#20262f", surface3: "#232a34", surface4: "#222831",
    line: "rgba(255, 255, 255, 0.06)", line2: "rgba(255, 255, 255, 0.09)", line3: "rgba(255, 255, 255, 0.12)",
    text: "#e6e9ee", text2: "#c4cad3", text3: "#9aa2ad", muted: "#828a95", muted2: "#737b86", faint: "#636b76",
    accent: "#5b8fcf",
  },
  {
    name: "Paper",
    bg: "#f4f1ea", bgStrip: "#ece8df", bgRail: "#e8e3d8", bgPanel: "#efece4",
    surface: "#ffffff", surface2: "#faf8f3", surface3: "#f1ede4", surface4: "#f6f3ec",
    line: "rgba(0, 0, 0, 0.08)", line2: "rgba(0, 0, 0, 0.12)", line3: "rgba(0, 0, 0, 0.16)",
    text: "#2a2824", text2: "#4a463f", text3: "#6b675e", muted: "#847f74", muted2: "#948f84", faint: "#a8a298",
    accent: "#c2562b",
  },
  {
    name: "Forest",
    bg: "#0d1411", bgStrip: "#101a15", bgRail: "#121d18", bgPanel: "#111b16",
    surface: "#16241d", surface2: "#192a21", surface3: "#1d3026", surface4: "#1b2d24",
    line: "rgba(255, 255, 255, 0.06)", line2: "rgba(255, 255, 255, 0.09)", line3: "rgba(255, 255, 255, 0.12)",
    text: "#e6ece8", text2: "#c2cec7", text3: "#97a59d", muted: "#7f8d85", muted2: "#707e76", faint: "#616f67",
    accent: "#5db98a",
  },
  {
    name: "Plum",
    bg: "#120e16", bgStrip: "#17121c", bgRail: "#1a1420", bgPanel: "#18121e",
    surface: "#221a2a", surface2: "#261d30", surface3: "#2b2136", surface4: "#291f34",
    line: "rgba(255, 255, 255, 0.06)", line2: "rgba(255, 255, 255, 0.09)", line3: "rgba(255, 255, 255, 0.12)",
    text: "#ebe6f0", text2: "#cdc6d6", text3: "#a59caf", muted: "#8d8497", muted2: "#7e7588", faint: "#6f6679",
    accent: "#9a7fd0",
  },
];

/** The default theme: the "Midnight" palette with the grid shown. */
const { name: _midnightName, ...midnightPalette } = MIDNIGHT;
export const DEFAULT_THEME: CanvasTheme = { ...midnightPalette, grid: true };

/** Swatch palettes for the two fine-tune roles (one bg + accent per preset). */
const BG_SWATCHES = THEME_PRESETS.map((p) => p.bg);
const ACCENT_SWATCHES = THEME_PRESETS.map((p) => p.accent);

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
      "Recolour the editor interface. Presets restyle the whole UI instantly; fine-tune the background and accent below. The shapes on the canvas keep their own colours.",
      "th-intro",
    ),
  );

  // --- presets ---
  body.append(label("PRESETS"));
  const presets = hEl("div", "", "th-presets");
  for (const p of THEME_PRESETS) {
    const active =
      p.bg.toLowerCase() === theme.bg.toLowerCase() &&
      p.accent.toLowerCase() === theme.accent.toLowerCase();
    const btn = hEl("button", "", "th-preset") as HTMLButtonElement;
    btn.type = "button";
    if (active) btn.classList.add("active");
    const chips = hEl("span", "", "th-preset-chips");
    for (const c of [p.bg, p.surface, p.accent]) {
      const chip = hEl("span", "", "th-preset-chip");
      chip.style.background = c;
      chips.append(chip);
    }
    btn.append(chips, hEl("span", p.name, "th-preset-name"));
    btn.addEventListener("click", () => cb.onApplyPreset(p));
    presets.append(btn);
  }
  body.append(presets);

  // --- per-role fine-tuning ---
  body.append(label("BACKGROUND"));
  body.append(swatchRow(BG_SWATCHES, theme.bg, (c) => cb.onChange({ bg: c })));

  body.append(label("ACCENT"));
  body.append(swatchRow(ACCENT_SWATCHES, theme.accent, (c) => cb.onChange({ accent: c })));

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
