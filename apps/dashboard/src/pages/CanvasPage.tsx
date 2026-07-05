import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { mountCanvas, ServerSource } from "forward-canvas/embed";
import { useApi } from "../api/client";
import { realtimeEnabled, useProjectRealtime } from "../api/realtime";

const BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

// With the realtime channel attached, pushes carry the latency and the poll
// loops are only the reconciliation fallback — so they can tick rarely instead
// of hammering the server 7×/2s per open canvas. Without realtime (env not
// configured) the old tight poll remains the freshness path.
const PUSH_POLL_MS = 30_000;
const FALLBACK_POLL_MS = 2_000;

/**
 * Full-screen route that embeds the Forward web canvas for one project. Unlike the
 * standalone canvas, this builds a server-backed source with the *live Clerk
 * session* (a token provider, so each request is freshly authed) — no token ever
 * travels in the URL. `?el=` focuses one element (used by the docs tab links).
 *
 * Live sync: this host resolves the project's (member-only) realtime channel and
 * forwards every ChangeEvent into the source's `notifyChange`, which re-fetches
 * exactly the affected layer.
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

  // The mounted source, so realtime events can poke it without remounting.
  const sourceRef = useRef<ServerSource | null>(null);
  const [channel, setChannel] = useState<string | undefined>();

  useEffect(() => {
    if (!projectId || !realtimeEnabled()) return;
    let cancelled = false;
    void apiRef.current
      .realtimeChannel(projectId)
      .then((rt) => {
        if (!cancelled) setChannel(rt.channel);
      })
      .catch(() => {
        /* no channel → the poll fallback keeps the canvas fresh */
      });
    return () => {
      cancelled = true;
      setChannel(undefined);
    };
  }, [projectId]);

  useProjectRealtime(channel, (e) => {
    sourceRef.current?.notifyChange(e.resource);
  });

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
      const source = new ServerSource(
        BASE_URL,
        projectId,
        () => getTokenRef.current(),
        realtimeEnabled() ? PUSH_POLL_MS : FALLBACK_POLL_MS,
      );
      sourceRef.current = source;
      handle = mountCanvas({
        container: host,
        source,
        focusElementId: focusEl,
        projectId,
        projectName,
        onBack: () => navigateRef.current(`/app/projects/${projectId}`),
        onNavigateHome: () => navigateRef.current(`/app`),
        onNavigateProject: () => navigateRef.current(`/app/projects/${projectId}`),
      });
    })();
    return () => {
      cancelled = true;
      sourceRef.current = null;
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
