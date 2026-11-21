import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Floating "back to top" control for the long public pages (landing + docs).
 * Reuses the Forward fast-forward brand mark (the `.ff-mark` glyph, i.e. the
 * same `--brand-mask` the brand marks use), rotated to point upward. Appears
 * once the reader has scrolled past the first screen and smooth-scrolls home;
 * while hidden it is out of the tab order too.
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
    <Button
      size="icon-lg"
      className={cn(
        "back-to-top fixed end-4 bottom-4 z-60 rounded-full shadow-lg transition-[opacity,translate,box-shadow] duration-200 before:rounded-full hover:-translate-y-0.5 motion-reduce:transition-none sm:end-6 sm:bottom-6",
        visible ? "opacity-100" : "pointer-events-none translate-y-2.5 opacity-0",
      )}
      aria-label="Back to top"
      tabIndex={visible ? undefined : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <span className="ff-mark size-4.5 -rotate-90 align-[0]" aria-hidden />
    </Button>
  );
}
