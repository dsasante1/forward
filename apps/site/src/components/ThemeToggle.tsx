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
    <button type="button" className="theme-toggle" aria-label="Toggle dark theme" title="Toggle dark theme" onClick={toggle}>
      <svg className="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" strokeLinejoin="round" />
      </svg>
      <svg className="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}
