import { useMemo, useState } from "react";
import { useAdminApi } from "../api.js";
import { useAsync } from "../useAsync.js";
import { States } from "../States.js";
import { useToast } from "../App.js";
import { SearchIcon } from "./OrgsPage.js";
import { C, ago } from "../theme.js";

const COLS = ["Project", "Organization", "Last active", ""];
const GRID = "1.6fr 1.4fr 1fr 0.6fr";

/** Cross-tenant projects — search + delete. */
export function ProjectsPage() {
  const api = useAdminApi();
  const toast = useToast();
  const state = useAsync(() => api.listProjects(), []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo(() => {
    const rows = state.data ?? [];
    const ql = q.toLowerCase();
    return rows.filter(
      (p) => !ql || p.name.toLowerCase().includes(ql) || (p.organizationName ?? "").toLowerCase().includes(ql),
    );
  }, [state.data, q]);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" and all its data? This cannot be undone.`)) return;
    setBusy(id);
    try {
      await api.deleteProject(id);
      toast(`Deleted ${name}`);
      state.reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Projects</h1>
        <div className="page-sub">{list.length} of {state.data?.length ?? 0} design + API projects across orgs.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="searchbox">
          <SearchIcon />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project or org…" />
        </div>
      </div>
      <div className="card tbl">
        <div className="tbl-head" style={{ gridTemplateColumns: GRID }}>
          {COLS.map((c, i) => <div key={i} className="th">{c}</div>)}
        </div>
        <States state={state} />
        {list.map((p) => (
          <div key={p.id} className="tbl-row" style={{ gridTemplateColumns: GRID }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span className="dot" style={{ background: C.good }} />
              <span className="mono ellip" style={{ fontSize: 13.5 }}>{p.name}</span>
            </div>
            <div className="ellip" style={{ fontSize: 13, color: C.dim }}>{p.organizationName ?? "—"}</div>
            <div className="mono" style={{ fontSize: 11.5, color: C.faint }}>{ago(p.updatedAt)}</div>
            <div style={{ textAlign: "right" }}>
              <button className="linkbtn" style={{ color: C.bad }} disabled={busy === p.id} onClick={() => remove(p.id, p.name)}>Delete</button>
            </div>
          </div>
        ))}
        {state.data && list.length === 0 && <div className="empty">No projects match these filters.</div>}
      </div>
    </div>
  );
}
