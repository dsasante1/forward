import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "forward-admin-theme";

/** The user's explicitly-persisted choice, or null if they haven't picked. */
function savedTheme(): ThemeMode | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* localStorage may be unavailable (private mode) — treat as no choice. */
  }
  return null;
}

/**
 * Resolve the theme to start with: an explicit saved choice wins, otherwise
 * fall back to the OS preference, otherwise the dark STAFF CONSOLE default.
 */
export function initialTheme(): ThemeMode {
  const saved = savedTheme();
  if (saved) return saved;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

/** Set the `data-theme` attribute the CSS custom properties key off. */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", mode);
}

/**
 * Stateful theme toggle. Reads the attribute already applied at boot (see
 * main.tsx) so the first render matches the painted theme, then keeps the DOM
 * in sync on change. Persistence happens only on an explicit `toggle()` — until
 * the user picks, the console follows the OS preference, including live changes.
 */
export function useTheme(): { theme: ThemeMode; toggle: () => void } {
  const [theme, setTheme] = useState<ThemeMode>(
    () => (document.documentElement.getAttribute("data-theme") as ThemeMode | null) ?? initialTheme(),
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow the OS while the user hasn't made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => {
      if (savedTheme()) return; // an explicit toggle always wins
      setTheme(e.matches ? "light" : "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: ThemeMode = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore persistence failure */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
