import { Link } from "react-router-dom";
import { Show } from "@clerk/react";
import { BackToTop } from "../components/BackToTop";
import "../landing.css";

/**
 * Public marketing surface at `/` (the only unauthenticated route besides
 * Clerk's /sign-in and /sign-up). The signed-in app lives under /app.
 *
 * Aesthetic: warm editorial / technical — a cream canvas in Space Grotesk +
 * JetBrains Mono with hand-built product mockups (canvas, VS Code panel,
 * infra graph, ER model, timeline). Ported from the "Forward Platform" design.
 */
export function LandingPage() {
  return (
    <div className="landing">
      <div className="l-dotgrid" aria-hidden />

      {/* ============ NAV ============ */}
      <div className="l-nav-bar">
        <nav className="l-wrap l-nav">
          <Link to="/" className="l-brand">
            <span className="l-brand-mark" aria-hidden />
            <span className="l-brand-name">FORWARD</span>
          </Link>
          <div className="l-nav-links">
            <a className="l-nav-link l-nav-hide" href="#capabilities">
              Capabilities
            </a>
            <a className="l-nav-link l-nav-hide" href="#surfaces">
              Surfaces
            </a>
            <a className="l-nav-link l-nav-hide" href="#teams">
              Teams
            </a>
            <a className="l-nav-link l-nav-hide" href="#pricing">
              Pricing
            </a>
            <Link className="l-nav-link l-nav-hide" to="/docs">
              Docs
            </Link>
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
      </div>

      {/* ============ HERO ============ */}
      <header className="l-wrap l-hero">
        <h1>Design. Document. Deliver. All in sync.</h1>
        <p className="l-hero-sub">
          Forward brings your UI design, backend docs, architecture, data models,
          and project work together in one place — so your team stays aligned and
          ship better software, faster.
        </p>
        <div className="l-hero-cta">
          <Show when="signed-out">
            <Link className="l-btn l-btn-lg l-btn-dark" to="/sign-up">
              Create your workspace <span className="l-arrow ff-mark" aria-hidden />
            </Link>
          </Show>
          <Show when="signed-in">
            <Link className="l-btn l-btn-lg l-btn-dark" to="/app">
              Go to your workspace <span className="l-arrow ff-mark" aria-hidden />
            </Link>
          </Show>
          <a className="l-btn l-btn-lg l-btn-outline" href="#capabilities">
            Explore capabilities
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
            <div className="l-winbar-live">
              <span className="l-live-dot" />3 EDITING
            </div>
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
                  API docs
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
                  <span className="on">DOCS</span>
                  <span>INFRA</span>
                  <span>FLOW</span>
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

      {/* ============ AUDIENCE STRIP ============ */}
      <section className="l-wrap l-audience-shell">
        <div className="l-audience">
          <span className="l-audience-label">A single source of truth for</span>
          <div className="l-audience-list">
            <span>Designers</span>
            <span>Frontend developers</span>
            <span>Backend developers</span>
            <span>Engineering teams</span>
            <span className="accent">AI coding agents</span>
          </div>
        </div>
      </section>

      {/* ============ SURFACES ============ */}
      <section id="surfaces" className="l-wrap l-section">
        <div className="l-section-head">
          <div>
            <p className="l-kicker">Three surfaces, full parity</p>
            <h2 className="l-h2" style={{ maxWidth: "15ch" }}>
              Author from wherever you work.
            </h2>
          </div>
          <p className="l-lead" style={{ maxWidth: "38ch" }}>
            Web app, VS Code and MCP server all read and write the same project —
            nothing drifts out of sync between design, editor and agents.
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

      {/* ============ CAPABILITIES BENTO ============ */}
      <section id="capabilities" className="l-wrap l-section">
        <p className="l-kicker">The building blocks</p>
        <h2 className="l-h2" style={{ maxWidth: "18ch", marginBottom: 16 }}>
          Every engineering artifact, connected to the UI.
        </h2>
        <p className="l-lead" style={{ maxWidth: "58ch", marginBottom: 52, fontSize: 17 }}>
          Six kinds of knowledge, each a first-class layer on the shared canvas —
          never scattered across separate tools, never out of date.
        </p>

        <div className="l-bento">
          {/* Design canvas — wide feature */}
          <div className="l-bento-cell span-7 row">
            <div className="l-bento-copy">
              <div className="l-bento-eyebrow">Design canvas</div>
              <h3>A design editor, built in.</h3>
              <p>
                Frames, rectangles, ellipses, text, reusable components and
                instances — with absolute positioning, nesting, styling and a
                clear hierarchy, right inside the dashboard.
              </p>
            </div>
            <div className="l-bento-art">
              <svg
                viewBox="0 0 150 130"
                width="150"
                fill="none"
                stroke="rgba(28,26,21,0.4)"
                strokeWidth="1.2"
                role="img"
              >
                <title>Design canvas layout illustration</title>
                <rect x="6" y="6" width="138" height="118" rx="3" stroke="rgba(28,26,21,0.2)" />
                <rect x="20" y="20" width="60" height="44" rx="2" />
                <rect x="28" y="30" width="30" height="6" rx="1" stroke="var(--accent)" />
                <rect x="28" y="42" width="44" height="4" rx="1" stroke="rgba(28,26,21,0.3)" />
                <rect x="28" y="50" width="36" height="4" rx="1" stroke="rgba(28,26,21,0.3)" />
                <rect x="96" y="20" width="34" height="34" rx="2" stroke="var(--accent)" />
                <circle cx="113" cy="37" r="7" stroke="var(--accent)" />
                <rect x="20" y="78" width="110" height="34" rx="2" />
                <line x1="30" y1="90" x2="120" y2="90" />
                <line x1="30" y1="100" x2="90" y2="100" stroke="rgba(28,26,21,0.28)" />
              </svg>
            </div>
          </div>

          {/* API documentation */}
          <div className="l-bento-cell span-5">
            <Icon>
              <path d="M8 6l-4 6 4 6" />
              <path d="M16 6l4 6-4 6" />
              <line x1="13" y1="5" x2="11" y2="19" />
            </Icon>
            <h3>API documentation</h3>
            <p>
              Attach framework-agnostic Markdown docs to any element — from VS Code
              or the MCP server. Endpoints stay tied to the interface they power.
            </p>
          </div>

          {/* Infrastructure */}
          <div className="l-bento-cell span-4">
            <Icon>
              <circle cx="6" cy="7" r="2.4" />
              <circle cx="18" cy="8" r="2.4" />
              <circle cx="12" cy="18" r="2.4" />
              <path d="M7.8 8.4l2.6 8M16.4 9.6l-3 7M8.2 7.3h7.6" />
            </Icon>
            <h3 className="sm">Infrastructure diagrams</h3>
            <p>
              Your architecture as a project-wide graph — apps, services,
              databases, caches, queues, DevOps and integrations — overlaid on the
              canvas.
            </p>
          </div>

          {/* Narrated flows */}
          <div className="l-bento-cell span-4">
            <Icon>
              <circle cx="5" cy="6" r="2" />
              <circle cx="19" cy="6" r="2" />
              <circle cx="12" cy="18" r="2" />
              <path d="M7 6h10M17.4 7.7L13 16M11 16L6.6 7.7" strokeDasharray="1 3" />
            </Icon>
            <h3 className="sm">Narrated system flows</h3>
            <p>
              Step-by-step walkthroughs rendered as numbered paths across the
              graph. Link steps to endpoints and export to Mermaid sequence
              diagrams.
            </p>
          </div>

          {/* Data models */}
          <div className="l-bento-cell span-4">
            <Icon>
              <rect x="3" y="4" width="8" height="16" rx="1" />
              <line x1="3" y1="9" x2="11" y2="9" />
              <rect x="16" y="7" width="5" height="10" rx="1" />
              <path d="M11 12h5" />
            </Icon>
            <h3 className="sm">Data models</h3>
            <p>
              Entity-relationship diagrams with tables, fields and crow's-foot
              relationships. Export as Mermaid{" "}
              <span className="l-code-chip">erDiagram</span>.
            </p>
          </div>

          {/* Task management — full-width strip */}
          <div className="l-bento-cell span-12 l-task-strip">
            <div className="l-bento-copy">
              <div className="l-bento-eyebrow">Task management</div>
              <h3>Track the work next to the system it belongs to.</h3>
              <p>
                Status, priority, type, assignees, dependencies, comments, activity
                history and Gantt. Every task can link to a design element, a
                system flow or an API endpoint — full traceability from planning to
                implementation.
              </p>
              <div className="l-chips">
                <span>Dependencies</span>
                <span>Gantt</span>
                <span>Linked traceability</span>
              </div>
            </div>
            <div className="l-task-mock">
              <div className="l-list-head">
                <span className="t">Tasks</span>
                <span className="meta">checkout-flow · 12 open</span>
              </div>
              <div className="l-task">
                <span className="l-check open" />
                <span className="l-task-title">Implement 402 decline state</span>
                <span
                  className="l-link-tag"
                  style={{
                    background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  → endpoint
                </span>
              </div>
              <div className="l-task">
                <span className="l-check idle" />
                <span className="l-task-title">Add payments-db to graph</span>
                <span
                  className="l-link-tag"
                  style={{
                    background: "color-mix(in srgb, var(--accent2) 16%, transparent)",
                    color: "var(--accent2)",
                  }}
                >
                  → infra
                </span>
              </div>
              <div className="l-task done">
                <span className="l-check checked">✓</span>
                <span className="l-task-title">Draw order summary frame</span>
                <span
                  className="l-link-tag"
                  style={{ background: "rgba(28,26,21,0.06)", color: "var(--soft)" }}
                >
                  → design
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ DEEP DIVE: VS CODE ============ */}
      <section className="l-wrap l-section">
        <div className="l-feature media-right">
          <div className="l-feature-copy">
            <p className="l-kicker">Documentation where it appears in the UI</p>
            <h2 className="l-h2-sm">Backend docs, written where the backend lives.</h2>
            <p>
              Open a design element, write Markdown next to your code, and attach
              documentation from the VS Code extension — or let an AI agent do it
              through the MCP server. Every API endpoint stays associated with the
              interface it powers.
            </p>
            <div className="l-checks">
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>Framework-agnostic — just a title and Markdown.</span>
              </div>
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>Syncs to the canvas the moment you save.</span>
              </div>
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>Resolve any element by id, without leaving the editor.</span>
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

      {/* ============ DEEP DIVE: INFRA + FLOWS ============ */}
      <section className="l-wrap l-section">
        <div className="l-feature media-right">
          <div className="l-feature-copy">
            <p className="l-kicker">Architecture &amp; narrated flows</p>
            <h2 className="l-h2-sm">The distributed system, as a living overlay.</h2>
            <p>
              Visualize frontend apps, backend services, databases, caches, queues
              and integrations as one project-wide graph. Then narrate a flow —
              registration, auth, checkout — as a numbered path across it, and
              export it as a Mermaid sequence diagram.
            </p>
          </div>
          <div className="l-feature-media l-mock l-mock-soft l-infra">
            <InfraGraph />
          </div>
        </div>
      </section>

      {/* ============ DEEP DIVE: DATA MODELS ============ */}
      <section className="l-wrap l-section">
        <div className="l-feature media-left">
          <div className="l-feature-media l-mock l-mock-soft l-ermock">
            <div className="l-er-head">
              <span>DATA MODEL · COMMERCE</span>
              <span className="l-er-export">export erDiagram</span>
            </div>
            <div className="l-er-row">
              <div className="l-entity">
                <div className="l-entity-name">users</div>
                <div className="l-entity-fields">
                  <div>
                    <span className="pk">id</span>
                    <span className="ty">uuid PK</span>
                  </div>
                  <div>
                    <span>email</span>
                    <span className="ty">text</span>
                  </div>
                  <div>
                    <span>name</span>
                    <span className="ty">text</span>
                  </div>
                </div>
              </div>
              <div className="l-er-rel">
                <svg width="74" height="34" viewBox="0 0 74 34" fill="none" stroke="var(--accent)" strokeWidth="1.4" role="img">
                  <title>one-to-many relationship</title>
                  <line x1="4" y1="17" x2="58" y2="17" />
                  <path d="M4 11v12" />
                  <path d="M70 17L58 11M70 17L58 23M70 17H58" />
                  <text x="30" y="12" fontFamily="var(--mono)" fontSize="10" fill="#9c9488" stroke="none" textAnchor="middle">
                    1 : N
                  </text>
                </svg>
              </div>
              <div className="l-entity">
                <div className="l-entity-name">orders</div>
                <div className="l-entity-fields">
                  <div>
                    <span className="pk">id</span>
                    <span className="ty">uuid PK</span>
                  </div>
                  <div>
                    <span className="fk">user_id</span>
                    <span className="ty">uuid FK</span>
                  </div>
                  <div>
                    <span>total</span>
                    <span className="ty">numeric</span>
                  </div>
                  <div>
                    <span>status</span>
                    <span className="ty">enum</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="l-feature-copy">
            <p className="l-kicker">Data models</p>
            <h2 className="l-h2-sm">Entities, fields and relationships that version with you.</h2>
            <p>
              Design and maintain entity-relationship diagrams with tables, fields
              and crow's-foot relationships. Export them as Mermaid{" "}
              <span className="l-code-chip" style={{ fontSize: 15 }}>
                erDiagram
              </span>{" "}
              definitions — easy to review, version and drop straight into
              technical docs.
            </p>
          </div>
        </div>
      </section>

      {/* ============ PROJECT MEMORY ============ */}
      <section className="l-wrap l-section">
        <p className="l-kicker">Never lose the thread</p>
        <h2 className="l-h2" style={{ maxWidth: "18ch", marginBottom: 18 }}>
          The project remembers everything.
        </h2>
        <p className="l-lead" style={{ maxWidth: "56ch", marginBottom: 46, fontSize: 17 }}>
          Every change to a design element or its documentation is captured as a
          revision — and every edit to the docs is a reviewable, git-style diff.
        </p>
        <div className="l-memory">
          {/* timeline mockup */}
          <div className="l-mock l-mock-soft l-timeline">
            <div className="l-timeline-head">
              <span>HISTORY TIMELINE · PAY BUTTON</span>
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
                    DOCS
                  </span>
                </div>
                <div className="l-event-when">maya · 2h ago · diff +6 / −1</div>
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
          {/* API-doc diff — the highlighted revision, expanded */}
          <div className="l-mock l-mock-soft l-diff" aria-hidden>
            <div className="l-diff-head">
              <span className="l-diff-file">API BINDING · PAY BUTTON</span>
              <div className="l-diff-meta">
                <span className="l-diff-ver">v7 → v8</span>
                <span className="l-diff-add">+6</span>
                <span className="l-diff-del">−1</span>
              </div>
            </div>
            <div className="l-diff-title">
              <span className="k">title</span>
              <span className="v">POST /api/checkout</span>
            </div>
            <div className="l-diff-body">
              <div className="l-diff-line">
                <span className="g"> </span>## Captures payment
              </div>
              <div className="l-diff-line">
                <span className="g"> </span>Creates an order and captures payment.
              </div>
              <div className="l-diff-line add">
                <span className="g">+</span>Idempotent on{" "}
                <span className="l-diff-code">Idempotency-Key</span>.
              </div>
              <div className="l-diff-line">
                <span className="g"> </span>Responses:
              </div>
              <div className="l-diff-line">
                <span className="g"> </span>- 201 Created
              </div>
              <div className="l-diff-line add">
                <span className="g">+</span>- 402 Payment required
              </div>
              <div className="l-diff-line del">
                <span className="g">−</span>- 500 Server error
              </div>
            </div>
            <div className="l-diff-foot">
              <span>maya · 2h ago</span>
              <span
                className="l-pill"
                style={{
                  background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                  color: "var(--accent)",
                }}
              >
                DOCS
              </span>
            </div>
          </div>
        </div>
        {/* checkpoints + realtime — full-width row */}
        <div className="l-memory-cards">
            <div className="l-info-card">
              <Icon>
                <path d="M6 3v18" />
                <path d="M6 4h12l-2.5 4L18 12H6" />
              </Icon>
              <h3>Checkpoints</h3>
              <p>
                Capture named snapshots of the entire workspace at milestones — each
                with notes and per-layer change summaries. Restore any previous
                state whenever you need to.
              </p>
            </div>
            <div className="l-info-card">
              <Icon>
                <path d="M4 4l7 16 2.5-6.5L20 11z" />
                <path d="M14 14l5 5" />
              </Icon>
              <h3>Real-time collaboration</h3>
              <p>
                Live two-way updates between the web app, the VS Code extension and
                AI agents. A change made on any surface is reflected everywhere at
                once.
              </p>
            </div>
          </div>
      </section>

      {/* ============ AI-NATIVE BAND ============ */}
      <section className="l-wrap l-section">
        <div className="l-aiband">
          <div className="l-aiband-dots" aria-hidden />
          <div className="l-aiband-copy">
            <p className="l-kicker" style={{ color: "var(--accent)" }}>
              AI-native development
            </p>
            <h2 className="l-aiband-h">Agents are first-class collaborators.</h2>
            <p>
              Through the Model Context Protocol server, AI assistants create,
              update and maintain documentation, architecture, tasks and every
              other artifact — exactly as human contributors do, with the same
              tools and the same source of truth.
            </p>
          </div>
          <div className="l-aiband-stat">
            <div className="n">~30</div>
            <div className="l">
              MCP tools,
              <br />
              full parity
            </div>
          </div>
        </div>
      </section>

      {/* ============ TEAMS & ORG ============ */}
      <section id="teams" className="l-wrap l-section">
        <div className="l-feature media-right">
          <div className="l-feature-copy">
            <p className="l-kicker">Teams &amp; organizations</p>
            <h2 className="l-h2-sm">Secure multi-tenant collaboration.</h2>
            <p>
              Run organizations with multiple projects and role-based permissions. A
              Clerk-authenticated backend plus a platform administration console
              with audit logging keep every workspace accountable.
            </p>
            <div className="l-orgfeats">
              {ORG_FEATURES.map((f) => (
                <div className="l-orgfeat" key={f}>
                  <span className="dot" />
                  {f}
                </div>
              ))}
            </div>
          </div>
          {/* members mockup */}
          <div className="l-feature-media l-mock l-mock-soft">
            <div className="l-list-head">
              <span className="t">Members · Acme</span>
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

      {/* ============ WHY ============ */}
      <section className="l-wrap l-section">
        <p className="l-kicker">Why Forward</p>
        <h2 className="l-h2" style={{ maxWidth: "20ch", marginBottom: 26 }}>
          Make the interface the anchor for everything.
        </h2>
        <p className="l-lead" style={{ maxWidth: "62ch", marginBottom: 0, fontSize: 17 }}>
          Modern teams keep designs, API docs, infrastructure, data models, tasks
          and AI workflows in disconnected tools — and as the project evolves, they
          drift out of sync. Forward keeps every artifact connected to the interface
          it supports.
        </p>
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
        <div className="l-section-head" style={{ marginBottom: 52 }}>
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
            <h2>One source of truth, from design through delivery.</h2>
            <p>
              Create a workspace, invite your team, and bring design, documentation,
              architecture and the work into one living picture.
            </p>
            <div className="l-cta-actions">
              <Show when="signed-out">
                <Link className="l-btn l-btn-lg l-btn-accent" to="/sign-up">
                  Start free <span className="l-arrow ff-mark" aria-hidden />
                </Link>
              </Show>
              <Show when="signed-in">
                <Link className="l-btn l-btn-lg l-btn-accent" to="/app">
                  Open your workspace <span className="l-arrow ff-mark" aria-hidden />
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
            <a href="#capabilities">Capabilities</a>
            <a href="#surfaces">Surfaces</a>
            <a href="#teams">Teams</a>
            <a href="#pricing">Pricing</a>
            <Link to="/docs">Docs</Link>
            <a href="#start">Start free</a>
          </div>
          <span className="l-footer-copy">© {new Date().getFullYear()} Forward</span>
        </div>
      </footer>
      <BackToTop />
    </div>
  );
}

/* ---------- small line icon ---------- */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="l-icon"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
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
      <title>Infrastructure graph: web client to api-gateway to checkout service and payments database</title>
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
          width="238"
          height="34"
          rx="6"
          fill="color-mix(in srgb, var(--accent) 12%, transparent)"
        />
        <circle cx="60" cy="297" r="4" fill="var(--accent)" />
        <text x="74" y="301" fontSize="12" fill="#1c1a15">
          flow: place order · 4 hops → Mermaid
        </text>
      </g>
    </svg>
  );
}

/* ---------- content ---------- */
const SURFACES = [
  {
    idx: "01 / WEB CANVAS",
    title: "The full dashboard",
    body: "Draw interfaces, model architecture, run flows, design data and track work — all in the browser, in one place.",
  },
  {
    idx: "02 / VS CODE",
    title: "Document in your editor",
    body: "Backend developers attach framework-agnostic API documentation to any design element without leaving the code.",
  },
  {
    idx: "03 / MCP SERVER",
    title: "Hand it to an agent",
    body: "Around 30 tools with full feature parity, so any AI assistant can create and maintain every artifact.",
  },
];

const ORG_FEATURES = [
  "Multiple projects",
  "Role-based permissions",
  "Email invitations",
  "API tokens",
  "Platform admin console",
  "Clerk authentication",
];

const MEMBERS = [
  {
    initials: "UA",
    name: "Uncle Akrobeto",
    email: "uncle@acme.dev",
    role: "Admin",
    color: "var(--accent2)",
  },
  {
    initials: "AD",
    name: "Abeeku Djokoto",
    email: "abeeku@acme.dev",
    role: "Developer",
    color: "var(--layer-tasks)",
  },
  {
    initials: "AK",
    name: "Ama Kubolor",
    email: "invited · pending",
    role: "Designer",
    color: "var(--layer-infra)",
  },
];

const BENEFITS = [
  {
    num: "01",
    title: "One source of truth",
    body: "Design, documentation, architecture and tasks live in one project — they stop drifting apart the day you start.",
  },
  {
    num: "02",
    title: "Docs that can't go stale",
    body: "Documentation lives next to the element it describes and versions with it, change by change.",
  },
  {
    num: "03",
    title: "Editor-native",
    body: "Backend devs document straight from VS Code — no context-switch, no second tool to keep open.",
  },
  {
    num: "04",
    title: "AI-ready by default",
    body: "An MCP server gives any agent full parity to read elements and maintain every artifact.",
  },
  {
    num: "05",
    title: "Traceable end to end",
    body: "Tasks link to design, flows and endpoints, so work always tracks against the thing it's about.",
  },
  {
    num: "06",
    title: "History you can trust",
    body: "A timeline and checkpoints record every change — by whom and when — so decisions are never a mystery.",
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
      "Canvas, docs, data models",
      "14-day change history",
    ],
  },
  {
    name: "Team",
    price: "$20",
    unit: "/ editor / mo",
    desc: "For product teams keeping design, docs, architecture and tasks in sync across the codebase.",
    cta: "Start 14-day trial",
    featured: true,
    contact: false,
    feats: [
      "Everything in Solo, plus:",
      "Unlimited projects & editors",
      "Infrastructure, flows & UML",
      "Checkpoints & full history",
      "MCP server & member management",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    desc: "For organizations that need SSO, audit logging, data residency and a dedicated contact.",
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
