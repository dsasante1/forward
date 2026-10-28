import type { ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "../styles.css";

/** Hydrate the prerendered page, or render it fresh (the Vite dev server serves the bare template). */
export function mount(page: ReactNode) {
  const root = document.getElementById("root")!;
  if (root.firstElementChild) hydrateRoot(root, page);
  else createRoot(root).render(page);
}
