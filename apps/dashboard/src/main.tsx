import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY (see .env.example)");
}

// Drive Clerk's widgets (UserButton, OrgSwitcher, SignIn/Up) from the same CSS
// variables as the rest of the app, so they follow the light/dark theme. The
// values are live `var()` references — the browser re-resolves them against
// `<html data-theme>` when the theme changes, no re-render needed.
const clerkAppearance = {
  variables: {
    colorPrimary: "var(--accent)",
    colorText: "var(--text)",
    colorTextSecondary: "var(--muted)",
    colorBackground: "var(--panel-bright)",
    colorInputBackground: "var(--panel-bright)",
    colorInputText: "var(--text)",
    colorNeutral: "rgb(var(--ink-rgb))",
    colorDanger: "var(--danger)",
    fontFamily: "var(--sans)",
    borderRadius: "8px",
  },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      appearance={clerkAppearance}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ClerkProvider>
  </React.StrictMode>,
);
