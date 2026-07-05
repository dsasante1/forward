import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAdminApi, type Plan } from "../api.js";
import { useAsync } from "../useAsync.js";
import { States } from "../States.js";
import { useToast } from "../App.js";
import {
  C,
  PLAN_LABEL,
  ago,
  hexA,
  initials,
  planBadge,
  statusBadge,
  uColor,
} from "../theme.js";

/** Org drill-down: header actions (impersonate, suspend, plan), stats, members, projects. */
export function OrgDetailPage() {
  const { id = "" } = useParams();
  const api = useAdminApi();
  const nav = useNavigate();
  const toast = useToast();
  const state = useAsync(() => api.orgDetail(id), [id]);
  const [busy, setBusy] = useState(false);
  const d = state.data;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      state.reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ownerId = d?.members.find((m) => m.role === "admin")?.userId;

  const impersonate = async () => {
    if (!ownerId) return alert("This org has no admin to impersonate.");
    try {
      const res = await api.impersonate(ownerId);
      await navigator.clipboard?.writeText(res.token).catch(() => undefined);
      toast(`Impersonation token for ${res.email ?? ownerId} copied`);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const changePlan = async () => {
    if (!d) return;
    const plan = window.prompt("Plan (solo / team / enterprise):", d.plan)?.trim() as Plan | undefined;
    if (!plan || !["solo", "team", "enterprise"].includes(plan)) return;
    const seatsRaw = window.prompt("Seat limit (blank = unlimited):", d.seatLimit?.toString() ?? "");
    if (seatsRaw === null) return;
    const seatLimit = seatsRaw.trim() === "" ? null : Number(seatsRaw);
    await run(() => api.setOrgPlan(id, { plan, seatLimit }), "Plan updated");
  };

  return (
    <div>
      <div onClick={() => nav("/organizations")} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, letterSpacing: "0.06em", color: C.faint, cursor: "pointer", marginBottom: 20 }}>
        ←&nbsp; ALL ORGANIZATIONS
      </div>

      <States state={state} />
      {d && (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 18, marginBottom: 24, flexWrap: "wrap" }}>
            <div style={{ width: 54, height: 54, borderRadius: 13, background: C.accentSoft, border: `1px solid ${C.accentLine}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 600, color: C.accent, flex: "none" }}>{initials(d.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
                <h1 className="page-title" style={{ margin: 0 }}>{d.name}</h1>
                <span style={planBadge(d.plan)}>{PLAN_LABEL[d.plan]}</span>
                <span style={statusBadge(d.suspendedAt ? C.bad : C.good)}>{d.suspendedAt ? "Suspended" : "Active"}</span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: C.faint, marginTop: 7 }}>
                forward.app/{d.slug ?? d.id} · owner {d.ownerEmail ?? d.ownerName ?? "—"} · {d.region ?? "no region"} · since {new Date(d.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 9, flexWrap: "wrap" }}>
              <button className="btn" onClick={impersonate}>Impersonate owner</button>
              <button className="btn" onClick={changePlan} disabled={busy}>Change plan</button>
              <button
                className={`btn ${d.suspendedAt ? "good" : "danger"}`}
                disabled={busy}
                onClick={() => run(() => api.suspendOrg(id, !d.suspendedAt), d.suspendedAt ? `Reactivated ${d.name}` : `Suspended ${d.name}`)}
              >
                {d.suspendedAt ? "Reactivate" : "Suspend org"}
              </button>
            </div>
          </div>

          {/* stat strip */}
          <div className="kpi-grid">
            <Stat label="SEATS" value={`${d.memberCount}${d.seatLimit ? `/${d.seatLimit}` : ""}`} sub={d.seatLimit ? (d.memberCount >= d.seatLimit ? "at limit" : `${d.seatLimit - d.memberCount} available`) : "unlimited"} />
            <Stat label="PROJECTS" value={String(d.projectCount)} sub={`${d.projects.length} shown`} />
            <Stat label="MRR" value="—" sub="billing not connected" />
            <Stat label="PLAN" value={PLAN_LABEL[d.plan]} sub={d.region ?? "—"} />
          </div>

          <div className="two-col">
            {/* members */}
            <div className="card card-pad">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
                <div className="section-title">Members</div>
                <span className="mono" style={{ fontSize: 11, color: C.faint }}>{d.members.length}</span>
              </div>
              {d.members.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>No members mirrored (needs the Clerk webhook).</div>}
              {d.members.map((m) => (
                <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span className="avatar" style={{ width: 28, height: 28, fontSize: 10, background: uColor(m.name ?? m.email) }}>{initials(m.name ?? m.email)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{m.name ?? m.email ?? m.userId}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: C.faint }}>{m.email ?? "—"}</div>
                  </div>
                  <span style={{ ...badgeRole(m.role) }}>{m.role}</span>
                </div>
              ))}
            </div>
            {/* projects */}
            <div className="card card-pad">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
                <div className="section-title">Projects</div>
                <span className="mono" style={{ fontSize: 11, color: C.faint }}>{d.projects.length}</span>
              </div>
              {d.projects.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>No projects in this org.</div>}
              {d.projects.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span className="dot" style={{ background: C.good }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: C.faint }}>{p.memberCount} members</div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: C.faint }}>{ago(p.updatedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: C.faint }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 600, marginTop: 9, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 5 }}>{sub}</div>
    </div>
  );
}

function badgeRole(role: string) {
  const color = role === "admin" ? "#8a6db0" : "#8a8378";
  return { fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, padding: "3px 9px", borderRadius: 5, whiteSpace: "nowrap" as const, color, background: hexA(color, 0.15) };
}
