import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { Show, SignIn, useUser } from "@clerk/react";
import { OverviewPage } from "./pages/OverviewPage.js";
import { OrgsPage } from "./pages/OrgsPage.js";
import { OrgDetailPage } from "./pages/OrgDetailPage.js";
import { UsersPage } from "./pages/UsersPage.js";
import { BillingPage } from "./pages/BillingPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { initials } from "./theme.js";

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

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <div className="signin-shell">
          <div className="brand" style={{ padding: 0 }}>
            <div className="diamond" />
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
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => {
    setToast(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const opInitials = initials(
    user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Ops",
  );

  return (
    <ToastCtx.Provider value={show}>
      <div className="shell shell-top">
        <header className="topbar">
          <div className="topbar-brand">
            <div className="diamond" />
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
            <div className="prod">
              <span className="dot live" />
              PRODUCTION
            </div>
            <div className="top-user">
              <span className="avatar op-avatar">{opInitials}</span>
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Ops · You</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>superadmin</div>
              </div>
            </div>
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
