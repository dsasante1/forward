import { useAdminApi } from "../api.js";
import { useAsync } from "../useAsync.js";
import { States } from "../States.js";
import { C, PLAN_COLOR, PLAN_LABEL } from "../theme.js";

/**
 * Billing — no payment provider is wired yet, so revenue figures are unavailable.
 * We still render the screen's structure (plan distribution is real) and show an
 * honest empty state where MRR / invoices would be, rather than faking numbers.
 */
export function BillingPage() {
  const api = useAdminApi();
  const ov = useAsync(() => api.overview(), []);
  const d = ov.data;
  const total = d ? d.planDistribution.reduce((a, p) => a + p.count, 0) : 0;

  const KPIS = [
    { label: "MRR", value: "—" },
    { label: "ARR (RUN RATE)", value: "—" },
    { label: "NET REVENUE RETENTION", value: "—" },
    { label: "FAILED PAYMENTS", value: "—" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Billing</h1>
        <div className="page-sub">Subscriptions, invoices and recurring revenue.</div>
      </div>

      <div className="kpi-grid">
        {KPIS.map((k) => (
          <div key={k.label} className="card kpi">
            <div className="kpi-label">{k.label}</div>
            <div style={{ fontSize: 27, fontWeight: 600, marginTop: 10, letterSpacing: "-0.02em", color: C.faint }}>{k.value}</div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6 }}>not connected</div>
          </div>
        ))}
      </div>

      {/* plan distribution is real even without billing */}
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ marginBottom: 14 }}>Organizations by plan</div>
        <States state={ov} />
        {d && (
          <>
            <div style={{ display: "flex", height: 13, borderRadius: 7, overflow: "hidden", marginBottom: 14 }}>
              {d.planDistribution.map((p) => (
                <div key={p.plan} style={{ width: total ? `${Math.round((p.count / total) * 100)}%` : "0%", background: PLAN_COLOR[p.plan] }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
              {d.planDistribution.map((p) => (
                <div key={p.plan} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: PLAN_COLOR[p.plan] }} />
                  <span style={{ fontSize: 13, color: C.dim }}>{PLAN_LABEL[p.plan]}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{p.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ padding: "50px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Billing isn’t connected</div>
        <div style={{ fontSize: 13.5, color: C.dim, maxWidth: 460, margin: "0 auto" }}>
          Connect a payment provider to see MRR, ARR, invoices and revenue retention. Plans and seat limits can be set manually per organization in the meantime.
        </div>
      </div>
    </div>
  );
}
