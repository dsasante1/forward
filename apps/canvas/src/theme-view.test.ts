import { describe, expect, it } from "vitest";
import css from "./canvas.css?raw";
import { DEFAULT_THEME, THEME_PRESETS, foregroundOn, upgradeSavedTheme } from "./theme-view.js";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("theme presets", () => {
  it("keep every secondary text colour at WCAG AA (4.5:1) on every chrome surface", () => {
    const failures: string[] = [];
    for (const p of THEME_PRESETS) {
      for (const role of ["text3", "muted", "muted2", "faint"] as const) {
        for (const surface of ["bg", "bgStrip", "bgRail", "bgPanel", "surface3"] as const) {
          const ratio = contrast(p[role], p[surface]);
          if (ratio < 4.5) failures.push(`${p.name} ${role} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("mirror the Midnight defaults in the canvas.css :host block", () => {
    expect(css).toContain(`--muted-2: ${DEFAULT_THEME.muted2};`);
    expect(css).toContain(`--faint: ${DEFAULT_THEME.faint};`);
    expect(css).toContain(`--primary-foreground: ${foregroundOn(DEFAULT_THEME.accent)};`);
  });
});

describe("foregroundOn", () => {
  it("picks the more legible of near-black and white for each preset accent", () => {
    for (const p of THEME_PRESETS) {
      const fg = foregroundOn(p.accent);
      const other = fg === "#ffffff" ? "#15161b" : "#ffffff";
      expect(contrast(fg, p.accent), p.name).toBeGreaterThanOrEqual(contrast(other, p.accent));
    }
    expect(foregroundOn("#d06a40")).toBe("#15161b");
    expect(foregroundOn("#386eae")).toBe("#ffffff");
  });

  it("falls back to near-black for a colour it can't read", () => {
    expect(foregroundOn("rebeccapurple")).toBe("#15161b");
  });
});

describe("upgradeSavedTheme", () => {
  it("lifts a palette saved with the old preset text colours", () => {
    const saved = { bg: "#f4f1ea", text3: "#6b675e", muted: "#847f74", muted2: "#948f84", faint: "#a8a298" };
    expect(upgradeSavedTheme(saved)).toEqual({
      bg: "#f4f1ea",
      text3: "#5b5750",
      muted: "#635f56",
      muted2: "#65625a",
      faint: "#69655e",
    });
  });

  it("leaves current and hand-picked colours alone", () => {
    const saved = { muted2: DEFAULT_THEME.muted2, faint: "#123456", accent: "#d06a40" };
    expect(upgradeSavedTheme(saved)).toEqual(saved);
  });
});
