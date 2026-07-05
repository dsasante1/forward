import { useNavigate } from "react-router-dom";
import { useAdminApi, type Alert } from "../api.js";
import { useAsync } from "../useAsync.js";
import { States } from "../States.js";
import {
  C,
  PLAN_COLOR,
  PLAN_LABEL,
  auditType,
  hexA,
  spark,
} from "../theme.js";

/** Platform health overview: KPI trends, alerts, plan split, signups, activity. */
export function OverviewPage() {
  const api = useAdminApi();
  const nav = useNavigate();
  const ov = useAsync(() => api.overview(), []);
  const feed = useAsync(() => api.audit({ scope: "platform", limit: 6 }), []);
  const d = ov.data;

  const totalPlans = d ? d.planDistribution.reduce((a, p) => a + p.count, 0) : 0;
  const maxBar = d ? Math.max(1, ...d.orgTrend.perWeek) : 1;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Overview</h1>
        <div className="page-sub">Platform health across every organization on Forward.</div>
      </div>

      <States state={ov} />
      {d && (
        <>
          {/* KPIs */}
          <div className="kpi-grid">
            <Kpi
              label="ORGANIZATIONS"
              value={d.counts.orgs.toLocaleString()}
              series={d.orgTrend.cumulative}
              delta={`▲ +${sum(d.orgTrend.perWeek)} last 12 wk`}
            />
            <Kpi
              label="ACTIVE EDITORS"
              value={d.counts.activeEditors.toLocaleString()}
              series={d.userTrend.cumulative}
              delta={`▲ +${sum(d.userTrend.perWeek)} new users`}
            />
            <Kpi
              label="MRR"
              value={d.mrr == null ? "—" : `$${d.mrr.toLocaleString()}`}
              series={[]}
              delta="Billing not connected"
              deltaColor={C.faint}
            />
          </div>

          <div className="two-col wide-left" style={{ marginBottom: 14 }}>
            {/* alerts */}
            <div className="card card-pad">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div className="section-title">Needs attention</div>
                <span className="mono" style={{ fontSize: 11, color: C.faint }}>{d.alerts.length} open</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {d.alerts.length === 0 && (
                  <div style={{ color: C.dim, fontSize: 13 }}>All clear — nothing needs attention.</div>
                )}
                {d.alerts.map((a, i) => (
                  <AlertRow key={i} a={a} onClick={() => nav(`/organizations/${a.orgId}`)} />
                ))}
              </div>
            </div>
            {/* plan split + signups */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="card card-pad">
                <div className="section-title" style={{ marginBottom: 14 }}>Plan distribution</div>
                <div style={{ display: "flex", height: 11, borderRadius: 6, overflow: "hidden", marginBottom: 14 }}>
                  {d.planDistribution.map((p) => (
                    <div key={p.plan} style={{ width: pct(p.count, totalPlans), background: PLAN_COLOR[p.plan] }} />
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {d.planDistribution.map((p) => (
                    <div key={p.plan} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: PLAN_COLOR[p.plan] }} />
                      <span style={{ flex: 1, color: C.dim }}>{PLAN_LABEL[p.plan]}</span>
                      <span style={{ fontWeight: 500 }}>{p.count}</span>
                      <span className="mono" style={{ fontSize: 11, color: C.faint, width: 38, textAlign: "right" }}>{pct(p.count, totalPlans)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card card-pad">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
                  <div className="section-title">New orgs / week</div>
                  <span className="mono" style={{ fontSize: 11, color: C.faint }}>12 wk</span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 60 }}>
                  {d.orgTrend.perWeek.map((v, i) => (
                    <div key={i} style={{ flex: 1, height: `${Math.round((v / maxBar) * 100)}%`, minHeight: 2, borderRadius: "3px 3px 0 0", background: i === d.orgTrend.perWeek.length - 1 ? C.accent : C.accentLine }} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* activity feed */}
          <div className="card card-pad">
            <div className="section-title" style={{ marginBottom: 6 }}>Recent activity</div>
            <States state={feed} />
            {feed.data && feed.data.length === 0 && (
              <div style={{ color: C.dim, fontSize: 13, padding: "10px 0" }}>No staff activity yet.</div>
            )}
            {feed.data?.map((a) => {
              const t = auditType(a.action);
              return (
                <div key={a.id} className="feed-row">
                  <span className="dot" style={{ background: t.color }} />
                  <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.08em", color: t.color, width: 90, flex: "none", textTransform: "uppercase" }}>{t.label}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
                    <strong>{a.actorId === undefined ? "—" : shortActor(a.actorId)}</strong>{" "}
                    {a.action} <span className="mono" style={{ color: C.accent }}>{a.targetId}</span>
                    {a.detail ? ` — ${a.detail}` : ""}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: C.faint, flex: "none" }}>{rel(a.ts)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, series, delta, deltaColor }: { label: string; value: string; series: number[]; delta: string; deltaColor?: string }) {
  const s = spark(series);
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginTop: 11 }}>
        <div className="kpi-value">{value}</div>
        {s.line && (
          <svg width="92" height="30" viewBox="0 0 120 30" preserveAspectRatio="none" style={{ flex: "none" }}>
            <path d={s.area} fill={C.accentSoft} />
            <path d={s.line} fill="none" stroke={C.accent} strokeWidth="1.7" />
          </svg>
        )}
      </div>
      <div style={{ marginTop: 11, fontSize: 12.5, color: deltaColor ?? C.good }}>{delta}</div>
    </div>
  );
}

function AlertRow({ a, onClick }: { a: Alert; onClick: () => void }) {
  const color = a.severity === "error" ? C.bad : C.warn;
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 9, background: C.panel2, border: `1px solid ${C.border}`, cursor: "pointer" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{a.title}</div>
        <div style={{ fontSize: 12, color: C.dim }}>{a.sub}</div>
      </div>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.08em", padding: "3px 7px", borderRadius: 5, color, background: hexA(color, 0.15), textTransform: "uppercase" }}>{a.type}</span>
      <span style={{ color: C.faint, fontSize: 15 }}>›</span>
    </div>
  );
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
const shortActor = (id: string) => (id.length > 14 ? id.slice(0, 12) + "…" : id);
function rel(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
