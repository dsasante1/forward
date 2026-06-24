import { Link } from "react-router-dom";
import { Show } from "@clerk/react";
import "../landing.css";

/**
 * Public marketing surface at `/` (the only unauthenticated route besides
 * Clerk's /sign-in and /sign-up). The signed-in app lives under /app.
 *
 * Aesthetic: warm editorial / technical — a cream canvas in Space Grotesk +
 * JetBrains Mono with hand-built product mockups (canvas, VS Code panel,
 * timeline, infra graph). Ported from the "Forward Platform" design.
 */
export function LandingPage() {
  return (
    <div className="landing">
      <div className="l-dotgrid" aria-hidden />

      {/* ============ NAV ============ */}
      <nav className="l-wrap l-nav">
        <Link to="/" className="l-brand">
          <span className="l-brand-mark" aria-hidden />
          <span className="l-brand-name">FORWARD</span>
        </Link>
        <div className="l-nav-links">
          <a className="l-nav-link l-nav-hide" href="#surfaces">
            Surfaces
          </a>
          <a className="l-nav-link l-nav-hide" href="#layers">
            Layers
          </a>
          <a className="l-nav-link l-nav-hide" href="#teams">
            Teams
          </a>
          <a className="l-nav-link l-nav-hide" href="#pricing">
            Pricing
          </a>
          <Show when="signed-out">
            <Link className="l-nav-link" to="/sign-in">
              Sign in
            </Link>
            <Link className="l-btn l-btn-dark" to="/sign-up">
              Start free
            </Link>
          </Show>
          <Show when="signed-in">
            <Link className="l-btn l-btn-dark" to="/app">
              Open app
            </Link>
          </Show>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="l-wrap l-hero">
        <span className="l-hero-eyebrow">Design &amp; backend, one source of truth</span>
        <h1>Where the design and the system finally agree.</h1>
        <p className="l-hero-sub">
          Designers draw the interface on an open canvas. Backend developers
          annotate every element with live API, infrastructure and UML docs —
          straight from VS Code. Design, documentation and the work tracked
          against it, in one project.
        </p>
        <div className="l-hero-cta">
          <Show when="signed-out">
            <Link className="l-btn l-btn-lg l-btn-dark" to="/sign-up">
              Create your workspace <span className="l-arrow">→</span>
            </Link>
          </Show>
          <Show when="signed-in">
            <Link className="l-btn l-btn-lg l-btn-dark" to="/app">
              Go to your workspace <span className="l-arrow">→</span>
            </Link>
          </Show>
          <a className="l-btn l-btn-lg l-btn-outline" href="#surfaces">
            See how it works
          </a>
        </div>
      </header>

      {/* ============ HERO MOCKUP: canvas + annotation ============ */}
      <section className="l-wrap l-canvas-shell">
        <div className="l-mock l-mock-shadow">
          <div className="l-winbar">
            <div className="l-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="l-winbar-url">forward · checkout-flow / canvas</div>
            <div className="l-winbar-live">LIVE</div>
          </div>
          <div className="l-canvas-body">
            {/* layers rail */}
            <div className="l-rail">
              <div className="l-rail-h">LAYERS</div>
              <div className="l-layers">
                <div>Checkout screen</div>
                <div className="indent">Order summary</div>
                <div className="indent">Promo field</div>
                <div className="indent sel">
                  <span />
                  Pay button
                </div>
                <div className="indent">Footer note</div>
              </div>
              <div className="l-rail-h" style={{ marginTop: 24 }}>
                OVERLAYS
              </div>
              <div className="l-overlays">
                <div>
                  <i style={{ background: "var(--accent)" }} />
                  API binding
                </div>
                <div>
                  <i style={{ background: "var(--accent2)" }} />
                  Infrastructure
                </div>
                <div>
                  <i style={{ background: "var(--layer-tasks)" }} />
                  Tasks
                </div>
              </div>
            </div>
            {/* canvas */}
            <div className="l-canvas">
              <div className="l-frame">
                <div className="l-frame-title">Order summary</div>
                <div className="l-hr" />
                <div className="l-row">
                  <span>Subtotal</span>
                  <span>$148.00</span>
                </div>
                <div className="l-row">
                  <span>Tax</span>
                  <span>$11.84</span>
                </div>
                <div className="l-hr" />
                <div className="l-selbox">
                  <div className="l-paybtn">Pay $159.84</div>
                  <span className="l-handle tl" />
                  <span className="l-handle tr" />
                  <span className="l-handle bl" />
                  <span className="l-handle br" />
                </div>
              </div>
              {/* annotation popover */}
              <div className="l-popover">
                <div className="l-pop-head">
                  <i />
                  <span>POST /api/checkout</span>
                </div>
                <div className="l-pop-tabs">
                  <span className="on">API</span>
                  <span>INFRA</span>
                  <span>UML</span>
                </div>
                <div className="l-hr" style={{ margin: 0 }} />
                <div className="l-pop-body">
                  <p>
                    Creates an order and captures payment. Idempotent on{" "}
                    <span className="l-code-chip">Idempotency-Key</span>.
                  </p>
                  <div className="l-pop-codes">
                    <span className="l-tag l-tag-blue">201 Created</span>
                    <span className="l-tag l-tag-muted">402 Payment required</span>
                  </div>
                  <div className="l-pop-by">
                    <span
                      className="l-avatar l-avatar-sm"
                      style={{ background: "var(--accent2)" }}
                    >
                      M
                    </span>
                    annotated in VS Code · 2h ago
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ SURFACES ============ */}
      <section id="surfaces" className="l-wrap l-section">
        <div className="l-section-head">
          <div>
            <p className="l-kicker">Three surfaces, one contract</p>
            <h2 className="l-h2" style={{ maxWidth: "15ch" }}>
              Wherever you work, the truth follows.
            </h2>
          </div>
          <p className="l-lead" style={{ maxWidth: "38ch" }}>
            Every surface reads and writes the same project contract, so nothing
            drifts out of sync between design tools, your editor and your agents.
          </p>
        </div>
        <div className="l-surfaces">
          {SURFACES.map((s) => (
            <div className="l-surface" key={s.idx}>
              <div className="l-surface-idx">{s.idx}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ FOUR LAYERS ============ */}
      <section id="layers" className="l-wrap l-section">
        <p className="l-kicker">Four data layers</p>
        <h2 className="l-h2" style={{ maxWidth: "18ch", marginBottom: 22 }}>
          Separate by design. Linked on read.
        </h2>
        <p className="l-lead" style={{ maxWidth: "60ch", marginBottom: 52, fontSize: 17 }}>
          Each layer stands on its own and stays the single source of truth for
          itself. Tasks link softly into the others, so work tracks against what
          it's actually about — never forced into a foreign key.
        </p>
        <div className="l-layers-grid">
          {LAYERS.map((l) => (
            <div className="l-layer" key={l.num}>
              <div className="l-layer-dot" style={{ background: l.dot }} />
              <div className="l-layer-num">{l.num}</div>
              <h3>{l.title}</h3>
              <p>{l.body}</p>
              <div className="l-layer-tag">{l.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ FEATURE: TASKS ============ */}
      <section className="l-wrap l-section">
        <div className="l-feature media-left">
          <div className="l-feature-media l-mock l-mock-soft">
            <div className="l-list-head">
              <span className="t">Tasks</span>
              <span className="meta">checkout-flow · 12 open</span>
            </div>
            <div style={{ padding: "8px 0" }}>
              <div className="l-task">
                <span className="l-check open" />
                <span className="l-task-title">
                  Implement 402 decline state on Pay button
                </span>
                <span
                  className="l-link-tag"
                  style={{
                    background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  → API binding
                </span>
                <span
                  className="l-avatar l-avatar-md"
                  style={{ background: "var(--accent2)" }}
                >
                  AR
                </span>
              </div>
              <div className="l-task">
                <span className="l-check idle" />
                <span className="l-task-title">Add payments-db to infra graph</span>
                <span
                  className="l-link-tag"
                  style={{
                    background: "color-mix(in srgb, var(--accent2) 16%, transparent)",
                    color: "var(--accent2)",
                  }}
                >
                  → Infrastructure
                </span>
                <span
                  className="l-avatar l-avatar-md"
                  style={{ background: "var(--layer-tasks)" }}
                >
                  MA
                </span>
              </div>
              <div className="l-task done">
                <span className="l-check checked">✓</span>
                <span className="l-task-title">Draw order summary frame</span>
                <span
                  className="l-link-tag"
                  style={{ background: "rgba(28,26,21,0.06)", color: "var(--soft)" }}
                >
                  → Design
                </span>
                <span
                  className="l-avatar l-avatar-md"
                  style={{ background: "var(--layer-tasks)" }}
                >
                  MA
                </span>
              </div>
            </div>
          </div>
          <div className="l-feature-copy">
            <p className="l-kicker">Tasks for developers</p>
            <h2 className="l-h2-sm">Work that points at the real thing.</h2>
            <p>
              Set tasks for developers and link them softly to a design element,
              an API binding or an infra node. The tracker stays standalone, but
              every item knows exactly what it's about — so nothing gets done in
              the dark.
            </p>
          </div>
        </div>
      </section>

      {/* ============ FEATURE: VS CODE ============ */}
      <section className="l-wrap l-section">
        <div className="l-feature media-right">
          <div className="l-feature-copy">
            <p className="l-kicker">Annotate from VS&nbsp;Code</p>
            <h2 className="l-h2-sm">Backend docs, written where the backend lives.</h2>
            <p>
              Open the design element, write Markdown next to your code, and
              attach API, infrastructure and UML documentation in seconds. It
              syncs to the canvas the moment you save.
            </p>
            <div className="l-checks">
              <div>
                <span className="arr">→</span>
                <span>Docs-first — HTTP method and status hints are optional.</span>
              </div>
              <div>
                <span className="arr">→</span>
                <span>ETag-conditional polling keeps it cheap and always current.</span>
              </div>
              <div>
                <span className="arr">→</span>
                <span>Never leave the editor — resolve any element by id.</span>
              </div>
            </div>
          </div>
          {/* VS Code mockup (dark) */}
          <div className="l-feature-media l-vscode">
            <div className="l-vscode-bar">
              <div className="l-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="l-vscode-file">checkout.ts — forward</span>
            </div>
            <div className="l-vscode-body">
              <div className="l-code">
                <div>
                  <span className="ln">12</span>&nbsp;&nbsp;
                  <span className="kw">export async function</span>{" "}
                  <span className="fn">checkout</span>(req) {"{"}
                </div>
                <div>
                  <span className="ln">13</span>&nbsp;&nbsp;&nbsp;&nbsp;
                  <span className="kw">const</span> order ={" "}
                  <span className="kw">await</span> orders.create(req);
                </div>
                <div className="hl">
                  <span className="ln">14</span>&nbsp;&nbsp;&nbsp;&nbsp;
                  <span className="kw">await</span> payments.capture(order);
                  &nbsp;&nbsp;<span className="cm">{"// @forward"}</span>
                </div>
                <div>
                  <span className="ln">15</span>&nbsp;&nbsp;&nbsp;&nbsp;
                  <span className="kw">return</span> {"{ id: order.id };"}
                </div>
                <div>
                  <span className="ln">16</span>&nbsp;&nbsp;{"}"}
                </div>
              </div>
              <div className="l-fpanel">
                <div className="l-fpanel-head">
                  <span>FORWARD</span>
                  <i />
                </div>
                <div className="l-fpanel-el">element · Pay button</div>
                <div className="l-fpanel-ep">POST /api/checkout</div>
                <div className="l-fpanel-hr" />
                <div className="l-fpanel-doc">
                  ## Captures payment
                  <br />
                  Idempotent on key.
                  <br />
                  <span className="kw">- 201</span> created
                  <br />
                  <span className="kw">- 402</span> declined
                </div>
                <div className="l-fpanel-save">Save annotation</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FEATURE: TIMELINE ============ */}
      <section className="l-wrap l-section">
        <div className="l-feature media-left">
          <div className="l-feature-media l-mock l-mock-soft l-timeline">
            <div className="l-timeline-head">
              <span>HISTORY · PAY BUTTON</span>
              <span style={{ letterSpacing: 0 }}>8 revisions</span>
            </div>
            <div className="l-track">
              <div className="l-event">
                <span className="l-event-node accent" />
                <div className="l-event-title">
                  <b>Added 402 response</b>
                  <span
                    className="l-pill"
                    style={{
                      background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                      color: "var(--accent)",
                    }}
                  >
                    API
                  </span>
                </div>
                <div className="l-event-when">maya · 2h ago</div>
              </div>
              <div className="l-event">
                <span className="l-event-node" />
                <div className="l-event-title">
                  <b>Linked payments-db node</b>
                  <span
                    className="l-pill"
                    style={{
                      background: "color-mix(in srgb, var(--accent2) 16%, transparent)",
                      color: "var(--accent2)",
                    }}
                  >
                    INFRA
                  </span>
                </div>
                <div className="l-event-when">arjun · yesterday</div>
              </div>
              <div className="l-event">
                <span className="l-event-node" />
                <div className="l-event-title">
                  <b>Resized &amp; moved frame</b>
                  <span
                    className="l-pill"
                    style={{ background: "rgba(28,26,21,0.06)", color: "var(--soft)" }}
                  >
                    DESIGN
                  </span>
                </div>
                <div className="l-event-when">maya · 3 days ago</div>
              </div>
              <div className="l-event">
                <span className="l-event-node" />
                <div className="l-event-title">
                  <b style={{ color: "var(--soft)" }}>Created element</b>
                </div>
                <div className="l-event-when">maya · last week</div>
              </div>
            </div>
          </div>
          <div className="l-feature-copy">
            <p className="l-kicker">A timeline of every change</p>
            <h2 className="l-h2-sm">See how the work changed — and who changed it.</h2>
            <p>
              Every edit to a design element or its documentation is captured as
              a revision. Scrub the history to understand how a contract evolved,
              what a teammate touched, and why the system looks the way it does
              today.
            </p>
          </div>
        </div>
      </section>

      {/* ============ FEATURE: INFRA GRAPH ============ */}
      <section className="l-wrap l-section">
        <div className="l-feature media-right">
          <div className="l-feature-copy">
            <p className="l-kicker">Infrastructure &amp; UML, made visible</p>
            <h2 className="l-h2-sm">The distributed system, as a living overlay.</h2>
            <p>
              A project-scoped graph of nodes, edges and narrated flows sits over
              the design. Trace a request from the button a user taps all the way
              to the database it writes — UML and sequence docs attached to each
              hop.
            </p>
          </div>
          <div className="l-feature-media l-mock l-mock-soft l-infra">
            <InfraGraph />
          </div>
        </div>
      </section>

      {/* ============ ORG / TEAMS ============ */}
      <section id="teams" className="l-wrap l-section">
        <div className="l-feature media-right">
          <div className="l-feature-copy">
            <p className="l-kicker">For organizations</p>
            <h2 className="l-h2-sm">One place for the whole team.</h2>
            <p>
              Spin up an organization, invite designers and backend developers,
              and assign roles. Set tasks, manage seats, and keep the design, its
              documentation and the work tracked against it under one roof.
            </p>
            <div className="l-stats">
              <div>
                <div className="l-stat-n">SSO</div>
                <div className="l-stat-l">&amp; ROLE-BASED ACCESS</div>
              </div>
              <div>
                <div className="l-stat-n">Seats</div>
                <div className="l-stat-l">BILLING IN ONE PLACE</div>
              </div>
            </div>
          </div>
          {/* members mockup */}
          <div className="l-feature-media l-mock l-mock-soft">
            <div className="l-list-head">
              <span className="t">Members</span>
              <span
                style={{
                  background: "var(--ink)",
                  color: "#f1ece1",
                  fontSize: 12,
                  padding: "7px 13px",
                  borderRadius: 5,
                }}
              >
                Invite
              </span>
            </div>
            {MEMBERS.map((m) => (
              <div className="l-task" key={m.email}>
                <span
                  className="l-avatar l-avatar-lg"
                  style={{ background: m.color }}
                >
                  {m.initials}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{m.name}</div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--faint)",
                    }}
                  >
                    {m.email}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--muted)",
                    border: "1px solid rgba(28,26,21,0.16)",
                    padding: "4px 10px",
                    borderRadius: 5,
                  }}
                >
                  {m.role} ▾
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHY SIGN UP ============ */}
      <section className="l-wrap l-section">
        <p className="l-kicker">Why teams move to Forward</p>
        <h2 className="l-h2" style={{ maxWidth: "18ch" }}>
          Docs that keep up with the product.
        </h2>
        <div className="l-why">
          {BENEFITS.map((b) => (
            <div className="l-why-cell" key={b.num}>
              <div className="l-why-num">{b.num}</div>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section id="pricing" className="l-wrap l-section">
        <div className="l-section-head" style={{ marginBottom: 54 }}>
          <div>
            <p className="l-kicker">Pricing</p>
            <h2 className="l-h2" style={{ maxWidth: "16ch" }}>
              Start free. Grow into a team.
            </h2>
          </div>
          <p className="l-lead" style={{ maxWidth: "36ch" }}>
            Per editor, billed monthly. Designers and developers are both editors
            — viewers are always free.
          </p>
        </div>
        <div className="l-pricing-grid">
          {PLANS.map((p) => (
            <div className={`l-plan${p.featured ? " featured" : ""}`} key={p.name}>
              {p.featured && <div className="l-plan-badge">MOST POPULAR</div>}
              <div className="l-plan-name">{p.name}</div>
              <div className="l-plan-price">
                <b>{p.price}</b>
                {p.unit && <span>{p.unit}</span>}
              </div>
              <p className="l-plan-desc">{p.desc}</p>
              {p.contact ? (
                <a className="l-plan-cta" href="#start">
                  {p.cta}
                </a>
              ) : (
                <Link
                  className={`l-plan-cta${p.featured ? " accent" : ""}`}
                  to="/sign-up"
                >
                  {p.cta}
                </Link>
              )}
              <div className="l-plan-divider" />
              <div className="l-plan-feats">
                {p.feats.map((f) => (
                  <div key={f}>
                    <span className="ck">✓</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="l-pricing-note">
          All plans include unlimited viewers · annual billing saves 20%
        </p>
      </section>

      {/* ============ SIGNUP CTA ============ */}
      <section id="start" className="l-wrap l-cta-wrap">
        <div className="l-cta">
          <div className="l-cta-dots" aria-hidden />
          <div className="l-cta-inner">
            <h2>Put design and the system on the same page.</h2>
            <p>
              Create a workspace, invite your team, and bring the interface, its
              documentation and the work into one living picture.
            </p>
            <div className="l-cta-actions">
              <Show when="signed-out">
                <Link className="l-btn l-btn-lg l-btn-accent" to="/sign-up">
                  Start free <span className="l-arrow">→</span>
                </Link>
              </Show>
              <Show when="signed-in">
                <Link className="l-btn l-btn-lg l-btn-accent" to="/app">
                  Open your workspace <span className="l-arrow">→</span>
                </Link>
              </Show>
              <a className="l-btn l-btn-lg l-btn-ghost-light" href="#start">
                Talk to us
              </a>
            </div>
            <div className="l-cta-fine">No credit card · Free to start · MCP-native</div>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="l-wrap l-footer">
        <div className="l-footer-line" />
        <div className="l-footer-row">
          <div className="l-footer-brand">
            <div className="mk" aria-hidden />
            <span className="nm">FORWARD</span>
          </div>
          <div className="l-footer-links">
            <a href="#surfaces">Surfaces</a>
            <a href="#layers">Layers</a>
            <a href="#teams">Teams</a>
            <a href="#pricing">Pricing</a>
            <a href="#start">Start free</a>
          </div>
          <span className="l-footer-copy">© {new Date().getFullYear()} Forward</span>
        </div>
      </footer>
    </div>
  );
}

/* ---------- infra graph SVG ---------- */
function InfraGraph() {
  return (
    <svg
      viewBox="0 0 760 360"
      width="100%"
      style={{ height: "auto", display: "block" }}
      fontFamily="'JetBrains Mono', monospace"
      role="img"
      aria-label="Infrastructure graph: web client to api-gateway to checkout service and payments database"
    >
      <defs>
        <marker id="l-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="#9c9488" />
        </marker>
        <marker id="l-arrA" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--accent)" />
        </marker>
      </defs>
      {/* edges */}
      <g stroke="#b9af9c" strokeWidth="1.4" fill="none">
        <path d="M186 70 L300 70" markerEnd="url(#l-arr)" />
        <path d="M226 96 C260 150 260 150 300 196" markerEnd="url(#l-arr)" />
        <path d="M460 70 L560 70" markerEnd="url(#l-arr)" />
      </g>
      {/* highlighted narrated flow */}
      <g stroke="var(--accent)" strokeWidth="1.8" fill="none">
        <path d="M376 96 L376 196" markerEnd="url(#l-arrA)" />
        <path d="M460 222 L560 222" markerEnd="url(#l-arrA)" />
      </g>
      {/* nodes */}
      <g>
        <rect x="40" y="48" width="146" height="46" rx="7" fill="#fffdf8" stroke="#cdbfa6" />
        <text x="113" y="68" textAnchor="middle" fontSize="13" fill="#1c1a15">
          web client
        </text>
        <text x="113" y="83" textAnchor="middle" fontSize="10" fill="#9c9488">
          browser
        </text>

        <rect x="300" y="48" width="160" height="46" rx="7" fill="#fffdf8" stroke="#cdbfa6" />
        <text x="380" y="68" textAnchor="middle" fontSize="13" fill="#1c1a15">
          api-gateway
        </text>
        <text x="380" y="83" textAnchor="middle" fontSize="10" fill="#9c9488">
          edge
        </text>

        <rect x="560" y="48" width="160" height="46" rx="7" fill="#fffdf8" stroke="#cdbfa6" />
        <text x="640" y="68" textAnchor="middle" fontSize="13" fill="#1c1a15">
          events-queue
        </text>
        <text x="640" y="83" textAnchor="middle" fontSize="10" fill="#9c9488">
          async
        </text>

        <rect
          x="300"
          y="196"
          width="160"
          height="48"
          rx="7"
          fill="#fffdf8"
          stroke="var(--accent)"
          strokeWidth="1.6"
        />
        <text x="380" y="217" textAnchor="middle" fontSize="13" fill="#1c1a15">
          checkout-svc
        </text>
        <text x="380" y="232" textAnchor="middle" fontSize="10" fill="var(--accent)">
          on flow
        </text>

        <rect
          x="560"
          y="198"
          width="160"
          height="46"
          rx="7"
          fill="#fffdf8"
          stroke="var(--accent2)"
          strokeWidth="1.4"
        />
        <text x="640" y="218" textAnchor="middle" fontSize="13" fill="#1c1a15">
          payments-db
        </text>
        <text x="640" y="233" textAnchor="middle" fontSize="10" fill="var(--accent2)">
          postgres
        </text>
      </g>
      {/* flow caption */}
      <g>
        <rect
          x="40"
          y="280"
          width="220"
          height="34"
          rx="6"
          fill="color-mix(in srgb, var(--accent) 12%, transparent)"
        />
        <circle cx="60" cy="297" r="4" fill="var(--accent)" />
        <text x="74" y="301" fontSize="12" fill="#1c1a15">
          flow: place order · 4 hops
        </text>
      </g>
    </svg>
  );
}

/* ---------- content ---------- */
const SURFACES = [
  {
    idx: "01 / WEB CANVAS",
    title: "Draw it in the browser",
    body: "A Figma-lite editor that runs offline against a fixture or live against your database — no setup to start drawing.",
  },
  {
    idx: "02 / VS CODE",
    title: "Document it in your editor",
    body: "Annotate design elements with API, infra and UML docs without leaving VS Code. ETag-conditional polling keeps it cheap and current.",
  },
  {
    idx: "03 / MCP SERVER",
    title: "Hand it to an agent",
    body: "Full parity for any AI agent — resolve elements, document endpoints and edit the infra graph, all through the shared contract.",
  },
];

const LAYERS = [
  {
    num: "01",
    dot: "var(--layer-design)",
    title: "Design",
    body: "Frames, components and instances on an independent visual canvas, with absolute geometry and a parent hierarchy.",
    tag: "Primary artefact",
  },
  {
    num: "02",
    dot: "var(--layer-api)",
    title: "API binding",
    body: "An optional, docs-first annotation a backend dev attaches from VS Code. Markdown carries the meaning; HTTP hints are optional.",
    tag: "From VS Code",
  },
  {
    num: "03",
    dot: "var(--layer-infra)",
    title: "Infrastructure",
    body: "A project-scoped graph of nodes, edges and narrated flows — the distributed system rendered as a separate overlay.",
    tag: "Graph overlay",
  },
  {
    num: "04",
    dot: "var(--layer-tasks)",
    title: "Tasks",
    body: "A standalone work tracker that links softly into the other layers, so every item tracks against the thing it's about.",
    tag: "Linked on read",
  },
];

const MEMBERS = [
  {
    initials: "MA",
    name: "Maya Adebayo",
    email: "maya@acme.dev",
    role: "Admin",
    color: "var(--accent2)",
  },
  {
    initials: "AR",
    name: "Arjun Rao",
    email: "arjun@acme.dev",
    role: "Developer",
    color: "var(--layer-tasks)",
  },
  {
    initials: "TL",
    name: "Tomas Lind",
    email: "invited · pending",
    role: "Designer",
    color: "var(--layer-infra)",
  },
];

const BENEFITS = [
  {
    num: "01",
    title: "One source of truth",
    body: "Design, documentation and tasks live in one project — they stop drifting apart the day you start.",
  },
  {
    num: "02",
    title: "Docs that can't go stale",
    body: "Annotations live next to the element they describe and version with it, change by change.",
  },
  {
    num: "03",
    title: "Editor-native",
    body: "Backend devs document straight from VS Code — no context-switch, no second tool to keep open.",
  },
  {
    num: "04",
    title: "AI-ready by default",
    body: "An MCP server gives any agent full parity to read elements and edit the infra graph.",
  },
  {
    num: "05",
    title: "Soft links, not foreign keys",
    body: "Each layer stays the source of truth for itself; tasks reference the others without coupling them.",
  },
  {
    num: "06",
    title: "History you can trust",
    body: "A timeline of every change — by whom and when — so decisions are never a mystery.",
  },
];

const PLANS = [
  {
    name: "Solo",
    price: "$0",
    unit: "/ forever",
    desc: "For individual developers documenting a side project or evaluating Forward.",
    cta: "Start free",
    featured: false,
    contact: false,
    feats: [
      "1 editor, unlimited viewers",
      "2 projects",
      "Web canvas & VS Code annotation",
      "14-day change history",
    ],
  },
  {
    name: "Team",
    price: "$20",
    unit: "/ editor / mo",
    desc: "For product teams keeping design, docs and tasks in sync across the whole codebase.",
    cta: "Start 14-day trial",
    featured: true,
    contact: false,
    feats: [
      "Everything in Solo, plus:",
      "Unlimited projects & editors",
      "Infrastructure & UML graph",
      "Tasks & member management",
      "Full change history & MCP server",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    desc: "For organizations that need SSO, control over data residency and a dedicated contact.",
    cta: "Talk to us",
    featured: false,
    contact: true,
    feats: [
      "Everything in Team, plus:",
      "SSO & SCIM provisioning",
      "Role-based access control",
      "Audit log & data residency",
      "Priority support & SLA",
    ],
  },
];
