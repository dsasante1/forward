import { useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { mountCanvas, ServerSource } from "forward-canvas/embed";
import { useApi } from "../api/client";

const BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

/**
 * Full-screen route that embeds the Forward web canvas for one project. Unlike the
 * standalone canvas, this builds a server-backed source with the *live Clerk
 * session* (a token provider, so each request is freshly authed) — no token ever
 * travels in the URL. `?el=` focuses one element (used by the docs tab links).
 *
 * The canvas owns its own chrome (breadcrumb + the bottom-right "Back to project"
 * pill); this host only feeds it the project name and a navigate handler, since
 * routing belongs to the dashboard.
 */
export function CanvasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [params] = useSearchParams();
  const focusEl = params.get("el");
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const api = useApi();
  const hostRef = useRef<HTMLDivElement>(null);

  // Keep stable getters so Clerk/router re-renders don't remount the canvas.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (!hostRef.current || !projectId) return;
    let handle: { destroy: () => void } | undefined;
    let cancelled = false;
    void (async () => {
      // Best-effort breadcrumb: resolve the project name before mounting so the
      // canvas paints `forward / <name> / canvas` in one go (no remount).
      let projectName: string | null = null;
      try {
        const projects = await apiRef.current.listProjects();
        projectName = projects.find((p) => p.id === projectId)?.name ?? null;
      } catch {
        /* leave the breadcrumb without a project segment */
      }
      const host = hostRef.current;
      if (cancelled || !host) return;
      const source = new ServerSource(BASE_URL, projectId, () =>
        getTokenRef.current(),
      );
      handle = mountCanvas({
        container: host,
        source,
        focusElementId: focusEl,
        projectId,
        projectName,
        onBack: () => navigateRef.current(`/app/projects/${projectId}`),
      });
    })();
    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, [projectId, focusEl]);

  if (!projectId) return <p className="error">Missing project id.</p>;

  return (
    <div className="canvas-page">
      <div ref={hostRef} className="canvas-host" />
    </div>
  );
}
