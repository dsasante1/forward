import { Routes, Route, Navigate } from "react-router-dom";
import { Show, RedirectToSignIn } from "@clerk/react";
import { Layout } from "./components/Layout.js";
import { LandingPage } from "./pages/LandingPage.js";
import { SignInPage } from "./pages/SignInPage.js";
import { SignUpPage } from "./pages/SignUpPage.js";
import { AcceptInvitePage } from "./pages/AcceptInvitePage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { ProjectPage } from "./pages/ProjectPage.js";
import { CanvasPage } from "./pages/CanvasPage.js";
import { AccountPage } from "./pages/AccountPage.js";

/** Gate protected routes: Clerk redirects to /sign-in when there's no session. */
function Protected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public marketing surface. */}
      <Route path="/" element={<LandingPage />} />

      {/* Clerk owns signup / login / reset / MFA / email verification. */}
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />

      {/* Public: gates sign-in itself, then redeems the invite token. */}
      <Route path="/invite/:token" element={<AcceptInvitePage />} />

      {/* Full-screen canvas for a project (no dashboard chrome). */}
      <Route
        path="/app/projects/:projectId/canvas"
        element={
          <Protected>
            <CanvasPage />
          </Protected>
        }
      />

      {/* The signed-in app lives under /app. */}
      <Route
        path="/app"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
