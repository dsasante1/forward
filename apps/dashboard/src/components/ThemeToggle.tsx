import { useEffect, useState } from "react";

/**
 * Three-way theme control (System / Light / Dark) for the topbar.
 *
 * The choice is written to `<html data-theme>` and persisted in localStorage
 * under `THEME_KEY`. `styles.css` reads the attribute: `dark` forces the dark
 * palette, `system` (or an absent attribute) follows the OS via
 * `prefers-color-scheme`, and `light` (the base `:root`) forces light. The
 * pre-paint script in `index.html` applies the stored choice before first
 * paint so there is no light-mode flash; this component keeps the two in sync.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "forward-theme";

function readStored(): ThemeChoice {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** Reflect the choice onto the document root so the CSS variables switch. */
export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice;
}

const OPTIONS: { value: ThemeChoice; label: string; icon: JSX.Element }[] = [
  {
    value: "system",
    label: "System theme",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="4" width="18" height="13" rx="1.5" />
        <path d="M8 20h8M12 17v3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Light theme",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark theme",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    typeof window === "undefined" ? "system" : readStored(),
  );

  useEffect(() => {
    applyTheme(choice);
    localStorage.setItem(THEME_KEY, choice);
  }, [choice]);

  return (
    <div className="theme-seg" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={choice === opt.value}
          aria-label={opt.label}
          title={opt.label}
          className={`theme-seg-btn${choice === opt.value ? " active" : ""}`}
          onClick={() => setChoice(opt.value)}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
