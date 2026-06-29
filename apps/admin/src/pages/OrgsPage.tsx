import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminApi, type AdminOrg, type Plan } from "../api.js";
import { useAsync } from "../useAsync.js";
import { States } from "../States.js";
import { C, PLAN_LABEL, ago, planBadge, statusBadge } from "../theme.js";

const COLS = ["Organization", "Plan", "Seats", "Proj", "MRR", "Status", "Last active"];
const GRID = "2.3fr 1fr 1.3fr 0.7fr 0.9fr 1fr 0.9fr";
const PLAN_FILTERS: [string, string][] = [["all", "All"], ["solo", "Solo"], ["team", "Team"], ["enterprise", "Ent"]];
const STATUS_FILTERS: [string, string][] = [["all", "All"], ["active", "Active"], ["suspended", "Suspended"]];

/** Organizations list — search + plan/status filters, click a row to drill in. */
export function OrgsPage() {
  const api = useAdminApi();
  const nav = useNavigate();
  const state = useAsync(() => api.listOrgs(), []);
  const [q, setQ] = useState("");
  const [planF, setPlanF] = useState("all");
  const [statusF, setStatusF] = useState("all");

  const list = useMemo(() => {
    const rows = state.data ?? [];
    const ql = q.toLowerCase();
    return rows.filter((o) => {
      const status = o.suspendedAt ? "suspended" : "active";
      if (planF !== "all" && o.plan !== planF) return false;
      if (statusF !== "all" && status !== statusF) return false;
      if (ql && !(o.name.toLowerCase().includes(ql) || (o.ownerEmail ?? "").toLowerCase().includes(ql) || (o.slug ?? "").toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [state.data, q, planF, statusF]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Organizations</h1>
          <div className="page-sub">{state.data?.length ?? 0} workspaces · {list.length} shown</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="searchbox">
          <SearchIcon />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, owner, slug…" />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {PLAN_FILTERS.map(([k, l]) => (
            <button key={k} className={`pill ${planF === k ? "active" : ""}`} onClick={() => setPlanF(k)}>{l}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 22, background: C.border2 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {STATUS_FILTERS.map(([k, l]) => (
            <button key={k} className={`pill ${statusF === k ? "active" : ""}`} onClick={() => setStatusF(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card tbl">
        <div className="tbl-head" style={{ gridTemplateColumns: GRID }}>
          {COLS.map((c) => <div key={c} className="th">{c}</div>)}
        </div>
        <States state={state} />
        {list.map((o) => <OrgRow key={o.id} o={o} onOpen={() => nav(`/organizations/${o.id}`)} />)}
        {state.data && list.length === 0 && <div className="empty">No organizations match these filters.</div>}
      </div>
    </div>
  );
}

function OrgRow({ o, onOpen }: { o: AdminOrg; onOpen: () => void }) {
  const status = o.suspendedAt ? C.bad : C.good;
  const pct = o.seatLimit ? Math.min(100, Math.round((o.memberCount / o.seatLimit) * 100)) : 0;
  const seatColor = pct >= 100 ? C.bad : pct >= 85 ? C.warn : C.accent;
  return (
    <div className="tbl-row click" style={{ gridTemplateColumns: GRID }} onClick={onOpen}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
        <span className="dot" style={{ background: status }} />
        <div style={{ minWidth: 0 }}>
          <div className="ellip" style={{ fontSize: 14, fontWeight: 500 }}>{o.name}</div>
          <div className="mono" style={{ fontSize: 11, color: C.faint }}>{o.ownerEmail ?? o.ownerName ?? "no owner"}</div>
        </div>
      </div>
      <div><span style={planBadge(o.plan)}>{PLAN_LABEL[o.plan as Plan]}</span></div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span className="mono" style={{ fontSize: 12, color: C.dim, width: 46 }}>{o.memberCount}{o.seatLimit ? ` / ${o.seatLimit}` : ""}</span>
        <div style={{ width: 60, height: 5, borderRadius: 3, background: C.border2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: seatColor }} />
        </div>
      </div>
      <div className="mono" style={{ fontSize: 13, color: C.dim }}>{o.projectCount}</div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 500, color: C.faint }}>—</div>
      <div><span style={statusBadge(status)}>{o.suspendedAt ? "Suspended" : "Active"}</span></div>
      <div className="mono" style={{ fontSize: 11.5, color: C.faint, textAlign: "right" }}>{ago(o.updatedAt)}</div>
    </div>
  );
}

export function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  );
}
