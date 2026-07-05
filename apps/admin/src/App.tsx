import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { Show, SignIn, useClerk, useUser } from "@clerk/react";
import { OverviewPage } from "./pages/OverviewPage.js";
import { OrgsPage } from "./pages/OrgsPage.js";
import { OrgDetailPage } from "./pages/OrgDetailPage.js";
import { UsersPage } from "./pages/UsersPage.js";
import { BillingPage } from "./pages/BillingPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { initials } from "./theme.js";
import { useTheme } from "./useTheme.js";

const NAV = [
  { to: "/overview", label: "Overview", icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" },
  { to: "/organizations", label: "Organizations", icon: "M3 21h18M5 21V8l7-4 7 4v13M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" },
  { to: "/users", label: "Users", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M17 3.13a4 4 0 0 1 0 7.75" },
  { to: "/billing", label: "Billing", icon: "M3 6h18v12H3zM3 10h18" },
  { to: "/projects", label: "Projects", icon: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" },
  { to: "/audit", label: "Audit log", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
];

// --- Toast (matches the design's transient confirmation banner) ---
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// Deploy environment shown in the topbar badge, from VITE_ENV (default development).
// Green = production, amber = staging, blue = development, so operators can tell at
// a glance which backend the console is mutating.
const DEV_BADGE = { label: "DEVELOPMENT", color: "var(--info)" };
const ENV_BADGE: Record<string, { label: string; color: string }> = {
  production: { label: "PRODUCTION", color: "var(--good)" },
  staging: { label: "STAGING", color: "var(--warn)" },
  development: DEV_BADGE,
};
function envBadge() {
  const raw = (import.meta.env.VITE_ENV ?? "development").toLowerCase();
  const key = raw === "prod" ? "production" : raw === "stage" ? "staging" : raw === "dev" ? "development" : raw;
  return ENV_BADGE[key] ?? DEV_BADGE;
}

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <div className="signin-shell">
          <div className="brand" style={{ padding: 0 }}>
            <div className="mark" />
            <span className="word">FORWARD</span>
          </div>
          <span className="console-tag" style={{ margin: 0 }}>STAFF CONSOLE</span>
          <p style={{ color: "var(--dim)" }}>Staff access only. Sign in to continue.</p>
          <SignIn routing="hash" />
        </div>
      </Show>
      <Show when="signed-in">
        <Shell />
      </Show>
    </>
  );
}

function Shell() {
  const { user } = useUser();
  const { theme, toggle } = useTheme();
  const { openUserProfile, signOut } = useClerk();
  const env = envBadge();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => {
    setToast(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const opName =
    user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Ops · You";
  const opInitials = initials(opName);

  return (
    <ToastCtx.Provider value={show}>
      <div className="shell shell-top">
        <header className="topbar">
          <div className="topbar-brand">
            <div className="mark" />
            <span className="word">FORWARD</span>
            <span className="staff-tag">STAFF</span>
          </div>
          <nav className="topnav ad-scroll">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `top-tab ${isActive ? "active" : ""}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggle}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? (
                // Sun — click to go light
                <svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                // Moon — click to go dark
                <svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <div className="prod" style={{ color: env.color }}>
              <span className="dot live" style={{ background: env.color }} />
              {env.label}
            </div>
            <button
              type="button"
              className="top-user"
              onClick={() => openUserProfile()}
              title="Manage your account"
              aria-label="Manage your account"
            >
              <span className="avatar op-avatar">{opInitials}</span>
              <div style={{ lineHeight: 1.2, textAlign: "left" }}>
                <div className="ellip" style={{ fontSize: 12.5, fontWeight: 500, maxWidth: 160 }}>{opName}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>superadmin</div>
              </div>
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => void signOut()}
              title="Sign out"
              aria-label="Sign out"
            >
              <svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </header>

        <div className="content ad-scroll">
          {toast && (
            <div className="toast">
              <span className="dot" style={{ background: "var(--accent)" }} />
              {toast}
            </div>
          )}
          <div className="content-inner">
            <Routes>
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/organizations" element={<OrgsPage />} />
              <Route path="/organizations/:id" element={<OrgDetailPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </ToastCtx.Provider>
  );
}
