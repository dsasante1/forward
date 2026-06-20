import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";

/**
 * The project's API documentation: every design element that has an `apiBinding`
 * is an endpoint a backend dev documented. We list those, since the binding's
 * `title` + `description` (Markdown) carry the meaning, with the HTTP hints when
 * present. The per-element version history is available via `api.timeline`.
 */
export function DocsTab({ projectId }: { projectId: string }) {
  const api = useApi();
  const { data: elements, loading, error } = useAsync(
    () => api.listElements(projectId),
    [api, projectId],
  );

  const documented = elements?.filter((el) => el.apiBinding) ?? [];

  return (
    <section className="tab-body">
      {loading && <p className="muted">Loading documentation…</p>}
      {error && <p className="error">{error}</p>}
      {elements && documented.length === 0 && (
        <p className="muted">
          No documented endpoints yet. Backend devs attach API docs to design
          elements from the VS Code extension or the MCP server.
        </p>
      )}

      <ul className="list">
        {documented.map((el) => {
          const b = el.apiBinding!;
          return (
            <li key={el.id} className="doc-row">
              <div className="doc-head">
                {b.method && <span className="method">{b.method}</span>}
                <span className="doc-title">{b.title}</span>
                {b.endpoint && <code className="endpoint">{b.endpoint}</code>}
              </div>
              {b.description && <p className="doc-desc">{b.description}</p>}
              {b.parameters.length > 0 && (
                <p className="muted small">
                  Params: {b.parameters.join(", ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
