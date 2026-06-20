import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";

/** Landing page: the projects the signed-in user belongs to, plus "new project". */
export function ProjectsPage() {
  const api = useApi();
  const { data: projects, loading, error, reload } = useAsync(
    () => api.listProjects(),
    [api],
  );

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string>();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setCreateError(undefined);
    try {
      await api.createProject(name.trim());
      setName("");
      reload();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
      </div>

      <form className="row" onSubmit={create}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          maxLength={120}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
      {createError && <p className="error">{createError}</p>}

      {loading && <p className="muted">Loading projects…</p>}
      {error && <p className="error">{error}</p>}
      {projects && projects.length === 0 && (
        <p className="muted">No projects yet — create your first one above.</p>
      )}

      <ul className="cards">
        {projects?.map((p) => (
          <li key={p.id} className="card">
            <Link to={`/projects/${p.id}`} className="card-title">
              {p.name}
            </Link>
            <span className={`badge ${p.role}`}>{p.role ?? "member"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
