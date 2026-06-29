import { useMemo, useState } from "react";
import { useAdminApi, type AdminUser } from "../api.js";
import { useAsync } from "../useAsync.js";
import { States } from "../States.js";
import { useToast } from "../App.js";
import { SearchIcon } from "./OrgsPage.js";
import { C, ago, hexA, initials, statusBadge, uColor } from "../theme.js";

const COLS = ["User", "Organization", "Role", "Status", "Last seen", ""];
const GRID = "2fr 1.4fr 0.8fr 0.9fr 0.9fr 1.4fr";
const ROLE_FILTERS: [string, string][] = [["all", "All"], ["staff", "Staff"], ["admin", "Admin"], ["member", "Member"]];

/** Cross-tenant users — search + role filters, with suspend / admin / impersonate. */
export function UsersPage() {
  const api = useAdminApi();
  const toast = useToast();
  const state = useAsync(() => api.listUsers(), []);
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo(() => {
    const rows = state.data ?? [];
    const ql = q.toLowerCase();
    return rows.filter((u) => {
      const role = u.role ?? "";
      if (roleF !== "all" && role !== roleF) return false;
      if (ql && !((u.name ?? "").toLowerCase().includes(ql) || (u.email ?? "").toLowerCase().includes(ql) || (u.orgName ?? "").toLowerCase().includes(ql) || u.id.includes(ql))) return false;
      return true;
    });
  }, [state.data, q, roleF]);

  const act = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id);
    try {
      await fn();
      if (ok) toast(ok);
      state.reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const impersonate = async (u: AdminUser) => {
    try {
      const res = await api.impersonate(u.id);
      await navigator.clipboard?.writeText(res.token).catch(() => undefined);
      toast(`Impersonation token for ${u.name ?? u.email ?? u.id} copied`);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Users</h1>
        <div className="page-sub">{list.length} of {state.data?.length ?? 0} people across all organizations.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="searchbox">
          <SearchIcon />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, org…" />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ROLE_FILTERS.map(([k, l]) => (
            <button key={k} className={`pill ${roleF === k ? "active" : ""}`} onClick={() => setRoleF(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="card tbl">
        <div className="tbl-head" style={{ gridTemplateColumns: GRID }}>
          {COLS.map((c, i) => <div key={i} className="th">{c}</div>)}
        </div>
        <States state={state} />
        {list.map((u) => {
          const status = u.suspendedAt ? C.bad : C.good;
          return (
            <div key={u.id} className="tbl-row" style={{ gridTemplateColumns: GRID }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                <span className="avatar" style={{ width: 30, height: 30, fontSize: 11, background: uColor(u.name ?? u.email) }}>{initials(u.name ?? u.email)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="ellip" style={{ fontSize: 13.5, fontWeight: 500 }}>{u.name ?? u.email ?? u.id}</div>
                  <div className="mono" style={{ fontSize: 11, color: C.faint }}>{u.email ?? u.id}</div>
                </div>
              </div>
              <div className="ellip" style={{ fontSize: 13, color: C.dim }}>{u.orgName ?? "—"}</div>
              <div>{u.role ? <span style={roleBadge(u.role)}>{u.role}</span> : <span style={{ color: C.faint }}>—</span>}</div>
              <div><span style={statusBadge(status)}>{u.suspendedAt ? "Suspended" : "Active"}</span></div>
              <div className="mono" style={{ fontSize: 11.5, color: C.faint }}>{ago(u.lastSeenAt)}</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button className="linkbtn" disabled={busy === u.id} onClick={() => act(u.id, () => api.suspendUser(u.id, !u.suspendedAt), u.suspendedAt ? "Restored" : "Suspended")}>{u.suspendedAt ? "Restore" : "Suspend"}</button>
                <button className="linkbtn" disabled={busy === u.id} onClick={() => act(u.id, () => api.setPlatformAdmin(u.id, !u.isPlatformAdmin), u.isPlatformAdmin ? "Admin revoked" : "Admin granted")}>{u.isPlatformAdmin ? "Revoke" : "Make admin"}</button>
                <button className="linkbtn" disabled={busy === u.id} onClick={() => impersonate(u)}>Impersonate</button>
              </div>
            </div>
          );
        })}
        {state.data && list.length === 0 && <div className="empty">No users match these filters.</div>}
      </div>
    </div>
  );
}

function roleBadge(role: string) {
  const map: Record<string, string> = { staff: "#d06a40", admin: "#8a6db0", member: "#8a8378" };
  const color = map[role] ?? "#8a8378";
  return { fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, padding: "3px 9px", borderRadius: 5, whiteSpace: "nowrap" as const, color, background: hexA(color, 0.15) };
}
