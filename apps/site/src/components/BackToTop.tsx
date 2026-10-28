import { useEffect, useState } from "react";

/**
 * Floating "back to top" control for the long public pages (landing + docs).
 * Reuses the Forward fast-forward brand mark (the `.ff-mark` glyph, i.e. the
 * same `--brand-mask` the brand marks use), rotated to point upward. Appears
 * once the reader has scrolled past the first screen and smooth-scrolls home.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      className={`back-to-top${visible ? " is-visible" : ""}`}
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <span className="ff-mark back-to-top-mark" aria-hidden />
    </button>
  );
}
