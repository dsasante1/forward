import { useNavigate } from "react-router-dom";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { AsyncStates } from "./AsyncStates.js";

/**
 * The project's API documentation: every design element that has an `apiBinding`
 * is an endpoint a backend dev documented. We list those, since the binding's
 * `title` + `description` (Markdown) carry the meaning, with the HTTP hints when
 * present. The per-element version history is available via `api.timeline`.
 */
export function DocsTab({ projectId }: { projectId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const state = useAsync(() => api.listElements(projectId), [api, projectId]);
  const documented = state.data?.filter((el) => el.apiBinding) ?? [];

  /**
   * Open the embedded web canvas for this project, focusing one element when
   * `elementId` is given. In-app navigation (same origin + Clerk session) — the
   * canvas route authenticates with the live session, so no token travels in URLs.
   */
  const openInCanvas = (elementId?: string) => {
    const base = `/app/projects/${projectId}/canvas`;
    navigate(elementId ? `${base}?el=${encodeURIComponent(elementId)}` : base);
  };

  return (
    <section className="tab-body">
      <div className="docs-toolbar">
        <button
          type="button"
          onClick={() => openInCanvas()}
          title="Open this project on the web canvas"
        >
          Open project in canvas <span className="ff-mark" aria-hidden />
        </button>
      </div>

      <AsyncStates
        state={state}
        loadingText="Loading documentation…"
        isEmpty={() => documented.length === 0}
        empty={
          <p className="muted">
            No documented endpoints yet. Backend devs attach API docs to design
            elements from the VS Code extension or the MCP server.
          </p>
        }
      />

      <ul className="list">
        {documented.map((el) => {
          const b = el.apiBinding!;
          return (
            <li key={el.id} className="doc-row">
              <div className="doc-head">
                <span className="doc-title">{b.title}</span>
                <button
                  type="button"
                  className="link canvas-link"
                  onClick={() => openInCanvas(el.id)}
                  title="Open this element on the web canvas"
                >
                  Open in canvas <span className="ff-mark" aria-hidden />
                </button>
              </div>
              {b.description && <p className="doc-desc">{b.description}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
