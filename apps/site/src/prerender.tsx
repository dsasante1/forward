import { renderToString } from "react-dom/server";
import { DocsPage } from "./pages/DocsPage.js";
import { LandingPage } from "./pages/LandingPage.js";

/** Each built page (path under dist/) and the markup that replaces its `<!--app-html-->`. */
export const pages: Record<string, () => string> = {
  "index.html": () => renderToString(<LandingPage />),
  "docs/index.html": () => renderToString(<DocsPage />),
};
