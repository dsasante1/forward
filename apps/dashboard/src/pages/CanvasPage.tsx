import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { mountCanvas, ServerSource } from "forward-canvas/embed";

const BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

/**
 * Full-screen route that embeds the Forward web canvas for one project. Unlike the
 * standalone canvas, this builds a server-backed source with the *live Clerk
 * session* (a token provider, so each request is freshly authed) — no token ever
 * travels in the URL. `?el=` focuses one element (used by the docs tab links).
 */
export function CanvasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [params] = useSearchParams();
  const focusEl = params.get("el");
  const { getToken } = useAuth();
  const hostRef = useRef<HTMLDivElement>(null);

  // Keep a stable token getter so Clerk re-renders don't remount the canvas.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !projectId) return;
    const source = new ServerSource(BASE_URL, projectId, () =>
      getTokenRef.current(),
    );
    const handle = mountCanvas({ container: host, source, focusElementId: focusEl });
    return () => handle.destroy();
  }, [projectId, focusEl]);

  if (!projectId) return <p className="error">Missing project id.</p>;

  return (
    <div className="canvas-page">
      <Link to={`/app/projects/${projectId}`} className="canvas-back">
        ← Back to project
      </Link>
      <div ref={hostRef} className="canvas-host" />
    </div>
  );
}
