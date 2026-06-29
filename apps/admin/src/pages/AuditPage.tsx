import { useMemo, useState } from "react";
import { useAdminApi } from "../api.js";
import { useAsync } from "../useAsync.js";
import { States } from "../States.js";
import { C, auditType, hexA, initials, uColor } from "../theme.js";

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["access", "Access"],
  ["billing", "Billing"],
  ["system", "System"],
  ["data", "Data"],
];

/** The global, tamper-evident staff audit trail, filterable by category. */
export function AuditPage() {
  const api = useAdminApi();
  const state = useAsync(() => api.audit({ limit: 200 }), []);
  const [f, setF] = useState("all");

  const list = useMemo(() => {
    const rows = state.data ?? [];
    return rows.filter((a) => f === "all" || auditType(a.action).key === f);
  }, [state.data, f]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Audit log</h1>
        <div className="page-sub">Every privileged action taken in the staff console.</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={`pill ${f === k ? "active" : ""}`} onClick={() => setF(k)}>{l}</button>
        ))}
      </div>
      <div className="card tbl">
        <States state={state} />
        {list.map((a) => {
          const t = auditType(a.action);
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
              <span className="avatar" style={{ width: 30, height: 30, fontSize: 10, background: uColor(a.actorId) }}>{initials(a.actorId)}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, padding: "3px 9px", borderRadius: 5, color: t.color, background: hexA(t.color, 0.15) }}>{t.label}</span>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
                <span className="mono" style={{ fontWeight: 500 }}>{a.actorId}</span>{" "}
                <span style={{ color: C.dim }}>{a.action}</span>{" "}
                <span className="mono" style={{ fontSize: 12.5, color: C.accent }}>{a.targetType}/{a.targetId}</span>
                {a.detail ? <span style={{ color: C.dim }}> — {a.detail}</span> : null}
              </div>
              <span className="mono" style={{ fontSize: 11.5, color: C.faint, flex: "none" }}>{rel(a.ts)}</span>
            </div>
          );
        })}
        {state.data && list.length === 0 && <div className="empty">No audit entries for this filter.</div>}
      </div>
    </div>
  );
}

function rel(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
