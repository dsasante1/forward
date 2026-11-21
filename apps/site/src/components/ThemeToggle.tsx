import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_KEY } from "../site.js";

/**
 * Light/dark switch for the landing + docs navs. The page follows the OS
 * preference until the reader picks one here; the choice is kept in
 * localStorage and re-applied before first paint by the inline script in each
 * page's <head>. Stateless, so the prerendered markup always matches: which
 * icon shows is decided in CSS (styles.css `.theme-icon-*`).
 */
export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked (private mode, site data off): the switch still applies to this page.
    }
  };

  return (
    <Button variant="outline" size="icon" aria-label="Toggle dark theme" title="Toggle dark theme" onClick={toggle}>
      <MoonIcon className="theme-icon-moon" aria-hidden="true" />
      <SunIcon className="theme-icon-sun" aria-hidden="true" />
    </Button>
  );
}
