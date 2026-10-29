import { useState, type ReactNode } from "react";
import { BackToTop } from "../components/BackToTop.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { DEMO_PATH, DOCS_PATH, GITHUB_URL, MARKETPLACE_URL, NPM_URL } from "../site.js";
import "../landing.css";

/**
 * Public landing page at `/`. Forward is open source and git-native: a project
 * is plain JSON in `.forward/` inside the team's own repository, so there is
 * nothing to sign into here, only docs, the live demo and the source.
 *
 * Aesthetic: mono & lime editorial / technical — near-black on off-white (or
 * the reverse in dark mode) with a lime accent, in Space Grotesk +
 * JetBrains Mono with hand-built product mockups (canvas, VS Code panel,
 * capture terminal, infra graph, ER model, timeline).
 */

/** The one command that sets a repository up (README "Quick start"). */
const INSTALL_LINE = "npx -y -p forward-mcp forward init";

export function LandingPage() {
  return (
    <div className="landing">
      <div className="l-dotgrid" aria-hidden />

      {/* ============ NAV ============ */}
      <div className="l-nav-bar">
        <nav className="l-wrap l-nav">
          <a href="/" className="l-brand">
            <span className="l-brand-mark" aria-hidden />
            <span className="l-brand-name">FORWARD</span>
          </a>
          <div className="l-nav-links">
            <a className="l-nav-link l-nav-hide" href="#capabilities">
              Capabilities
            </a>
            <a className="l-nav-link l-nav-hide" href="#from-code">
              From code
            </a>
            <a className="l-nav-link l-nav-hide" href="#git">
              Git-native
            </a>
            <a className="l-nav-link l-nav-hide" href="#open-source">
              Open source
            </a>
            <a className="l-nav-link" href={DOCS_PATH}>
              Docs
            </a>
            <a className="l-nav-link l-nav-hide" href={GITHUB_URL}>
              GitHub
            </a>
            <ThemeToggle />
            <a className="l-btn l-btn-dark" href={DEMO_PATH}>
              Live demo
            </a>
          </div>
        </nav>
      </div>

      {/* ============ HERO ============ */}
      <header className="l-wrap l-hero">
        <div className="l-hero-eyebrow">Open source · lives in your repo</div>
        <h1>Design. Document. Deliver. All in sync.</h1>
        <p className="l-hero-sub">
          Designers draw the UI. Backend developers and their AI agents attach API
          docs, architecture, data models and tasks to it. Everything is plain
          JSON in <span className="l-code-chip">.forward/</span> inside your own
          git repository, versioned and reviewed with the code it describes.
        </p>
        <div className="l-hero-cta">
          <a className="l-btn l-btn-lg l-btn-dark" href={DEMO_PATH}>
            Try the live demo <span className="l-arrow ff-mark" aria-hidden />
          </a>
          <a className="l-btn l-btn-lg l-btn-outline" href={`${DOCS_PATH}#getting-started`}>
            Get started
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
            <div className="l-winbar-url">127.0.0.1:4747 · checkout-flow / canvas</div>
            <div className="l-winbar-live">
              <span className="l-live-dot" />LIVE SYNC
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
                    documented in VS Code · 2h ago
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
            <p className="l-kicker">Three surfaces, one contract</p>
            <h2 className="l-h2" style={{ maxWidth: "15ch" }}>
              Author from wherever you work.
            </h2>
          </div>
          <p className="l-lead" style={{ maxWidth: "38ch" }}>
            The canvas, VS Code and the MCP server all read and write the same
            files in <span className="l-code-chip">.forward/</span>, so nothing
            drifts between design, editor and agents.
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
          Separate layers that each attach to the design or link to it by id,
          stored one file per record so they merge cleanly and diff readably in a
          pull request.
        </p>

        <div className="l-bento">
          {/* Design canvas — wide feature */}
          <div className="l-bento-cell span-7 row">
            <div className="l-bento-copy">
              <div className="l-bento-eyebrow">Design canvas</div>
              <h3>A design editor, built in.</h3>
              <p>
                Frames, rectangles, ellipses, text, reusable components and
                instances, with absolute positioning, nesting and styling. Run it
                locally with <span className="l-code-chip">forward serve</span>{" "}
                or open it inside VS Code.
              </p>
            </div>
            <div className="l-bento-art">
              <svg
                viewBox="0 0 150 130"
                width="150"
                fill="none"
                stroke="color-mix(in srgb, var(--ink) 40%, transparent)"
                strokeWidth="1.2"
                role="img"
              >
                <title>Design canvas layout illustration</title>
                <rect x="6" y="6" width="138" height="118" rx="3" stroke="color-mix(in srgb, var(--ink) 20%, transparent)" />
                <rect x="20" y="20" width="60" height="44" rx="2" />
                <rect x="28" y="30" width="30" height="6" rx="1" stroke="var(--accent)" />
                <rect x="28" y="42" width="44" height="4" rx="1" stroke="color-mix(in srgb, var(--ink) 30%, transparent)" />
                <rect x="28" y="50" width="36" height="4" rx="1" stroke="color-mix(in srgb, var(--ink) 30%, transparent)" />
                <rect x="96" y="20" width="34" height="34" rx="2" stroke="var(--accent)" />
                <circle cx="113" cy="37" r="7" stroke="var(--accent)" />
                <rect x="20" y="78" width="110" height="34" rx="2" />
                <line x1="30" y1="90" x2="120" y2="90" />
                <line x1="30" y1="100" x2="90" y2="100" stroke="color-mix(in srgb, var(--ink) 28%, transparent)" />
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
              Attach framework-agnostic Markdown docs to any element, from VS Code,
              an AI agent or the canvas. Endpoints stay tied to the interface they
              power, with an append-only history of every edit.
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
              Your architecture as a project-wide graph (frontends, backends,
              databases, caches, queues, services, DevOps and external
              dependencies) overlaid on the canvas.
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
              graph. Tie a step to an endpoint and render the flow as a Mermaid
              sequence diagram.
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
              relationships, serialized to a Mermaid{" "}
              <span className="l-code-chip">erDiagram</span>.
            </p>
          </div>

          {/* Task management — full-width strip */}
          <div className="l-bento-cell span-12 l-task-strip">
            <div className="l-bento-copy">
              <div className="l-bento-eyebrow">Task management</div>
              <h3>Track the work next to the system it belongs to.</h3>
              <p>
                Status, priority, type, assignees, dependencies, comments and an
                activity feed. Every task can link to a design
                element, a system flow or an API endpoint, so work always tracks
                against the thing it's about.
              </p>
              <div className="l-chips">
                <span>Dependencies</span>
                <span>Activity feed</span>
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
                  style={{ background: "color-mix(in srgb, var(--ink) 6%, transparent)", color: "var(--soft)" }}
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
              Pick a design element, write Markdown next to your code, and attach
              it from the VS Code extension, or let an AI agent do it through the
              MCP server. Every API endpoint stays associated with the interface
              it powers.
            </p>
            <div className="l-checks">
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>Framework-agnostic: just a title and Markdown.</span>
              </div>
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>Saved as a file in .forward/, committed with the code.</span>
              </div>
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>Pin code to its element with an @adc anchor comment.</span>
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
              <span className="l-vscode-file">checkout.ts — shop</span>
            </div>
            <div className="l-vscode-body">
              <div className="l-code">
                <div className="hl">
                  <span className="ln">11</span>&nbsp;&nbsp;
                  <span className="cm">{"// @adc el_pay_button"}</span>
                </div>
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
                <div>
                  <span className="ln">14</span>&nbsp;&nbsp;&nbsp;&nbsp;
                  <span className="kw">await</span> payments.capture(order);
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
                <div className="l-fpanel-save">Save documentation</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ DEEP DIVE: DESIGNS FROM CODE ============ */}
      <section id="from-code" className="l-wrap l-section">
        <div className="l-feature media-left">
          {/* capture terminal mockup (dark) */}
          <div className="l-feature-media l-vscode">
            <div className="l-vscode-bar">
              <div className="l-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="l-vscode-file">terminal — shop</span>
            </div>
            <div className="l-vscode-body">
              <div className="l-code">
                <div>
                  <span className="kw">$</span> forward capture --browsers
                </div>
                <div>
                  <span className="cm">chrome · edge · playwright (project)</span>
                </div>
                <div>&nbsp;</div>
                <div className="hl">
                  <span className="kw">$</span> forward capture http://localhost:5173 / /login
                </div>
                <div>
                  <span className="fn">/</span> <span className="cm">→ frame · boxes · text</span>
                </div>
                <div>
                  <span className="fn">/login</span> <span className="cm">→ frame · boxes · text</span>
                </div>
                <div>
                  <span className="cm">drafts marked ‹/› from code</span>
                </div>
                <div>&nbsp;</div>
                <div>
                  <span className="cm">{"# Firefox or Safari: paste a DevTools snippet"}</span>
                </div>
                <div>
                  <span className="kw">$</span> forward capture --script --route /login
                </div>
              </div>
            </div>
          </div>
          <div className="l-feature-copy">
            <p className="l-kicker">Designs from frontend code</p>
            <h2 className="l-h2-sm">Built the screen first? Forward draws it for you.</h2>
            <p>
              <span className="l-code-chip" style={{ fontSize: 15 }}>
                forward capture
              </span>{" "}
              renders your running app and reads back what the browser actually
              painted: one frame per route, a box for everything that paints, text
              for every run of text. React dev builds also report components, so
              repeated ones become a component plus instances.
            </p>
            <div className="l-checks">
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>
                  Uses the Chromium browser you already have (Chrome, Edge, Brave,
                  Chromium, Vivaldi or Opera) headless with a throwaway profile, or
                  the project's Playwright. Nothing is downloaded.
                </span>
              </div>
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>
                  No browser at all, say in CI? The forward-capture companion
                  brings its own headless Chromium.
                </span>
              </div>
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>
                  Results are drafts marked "from code". Re-running updates them in
                  place, an edited draft is never overwritten, and API docs never
                  move on a guess.
                </span>
              </div>
              <div>
                <span className="arr ff-mark" aria-hidden />
                <span>
                  Any browser works with --script: paste the snippet into DevTools
                  and import the snapshot it saves.
                </span>
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
              and integrations as one project-wide graph. Then narrate a flow
              (registration, auth, checkout) as a numbered path across it, and
              render it as a Mermaid sequence diagram.
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
              <span className="l-er-export">Mermaid erDiagram</span>
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
                  <text x="30" y="12" fontFamily="var(--mono)" fontSize="10" fill="var(--faint)" stroke="none" textAnchor="middle">
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
              and crow's-foot relationships. They serialize to Mermaid{" "}
              <span className="l-code-chip" style={{ fontSize: 15 }}>
                erDiagram
              </span>{" "}
              definitions, and each entity is its own JSON file, easy to review in
              a pull request and version with the schema it describes.
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
          Every edit to an element's API docs is an append-only history entry with
          a reviewable, git-style diff, and the project timeline is built from your
          git log, so commit messages show up in it too.
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
                <div className="l-event-when">maya via claude · 2h ago · diff +6 / −1</div>
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
                    style={{ background: "color-mix(in srgb, var(--ink) 6%, transparent)", color: "var(--soft)" }}
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
              <span>maya via claude · 2h ago</span>
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
        {/* checkpoints + catch-up — full-width row */}
        <div className="l-memory-cards">
          <div className="l-info-card">
            <Icon>
              <path d="M6 3v18" />
              <path d="M6 4h12l-2.5 4L18 12H6" />
            </Icon>
            <h3>Checkpoints</h3>
            <p>
              Save named snapshots of the whole canvas (design and infrastructure)
              at milestones, each with a note and per-layer change counts. Restore
              any of them whenever you need to.
            </p>
          </div>
          <div className="l-info-card">
            <Icon>
              <path d="M4 12h12" />
              <path d="M12 6l6 6-6 6" />
              <path d="M20 5v14" />
            </Icon>
            <h3>Catch-up digest</h3>
            <p>
              Pick a baseline, or a git ref with{" "}
              <span className="l-code-chip">forward diff origin/main</span>, and get
              the endpoints to integrate, modify and remove, plus a summary of
              everything else that changed.
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
              AI-agent first
            </p>
            <h2 className="l-aiband-h">Agents are first-class collaborators.</h2>
            <p>
              Claude Code, Codex, Cursor, Copilot or any MCP client gets the same
              tools as the canvas: documentation, architecture, data models, tasks
              and the design itself. Agents without MCP run the very same tools
              from the shell, and every write is stamped with your git name plus
              the agent that made it.
            </p>
          </div>
          <div className="l-aiband-stat">
            <div className="n">39</div>
            <div className="l">
              MCP tools,
              <br />
              full parity
            </div>
          </div>
        </div>
      </section>

      {/* ============ GIT IS THE ACCESS CONTROL ============ */}
      <section id="git" className="l-wrap l-section">
        <div className="l-feature media-right">
          <div className="l-feature-copy">
            <p className="l-kicker">Git-native</p>
            <h2 className="l-h2-sm">Git is the sync, the history and the access control.</h2>
            <p>
              There is no central server or database. Whoever can push to your
              repository can change the project, and changes reach the rest of the
              team the way code does: through commits, pull requests and merges.
              The contributor roster is read straight from git.
            </p>
            <div className="l-orgfeats">
              {GIT_FEATURES.map((f) => (
                <div className="l-orgfeat" key={f}>
                  <span className="dot" />
                  {f}
                </div>
              ))}
            </div>
          </div>
          {/* contributors mockup */}
          <div className="l-feature-media l-mock l-mock-soft">
            <div className="l-list-head">
              <span className="t">Contributors</span>
              <span className="meta">from git history · read-only</span>
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
          and AI workflows in disconnected tools, and as the project evolves they
          drift out of sync. Forward keeps every artifact connected to the
          interface it supports, in the repository it describes.
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

      {/* ============ OPEN SOURCE ============ */}
      <section id="open-source" className="l-wrap l-section">
        <div className="l-section-head">
          <div>
            <p className="l-kicker">Open source</p>
            <h2 className="l-h2" style={{ maxWidth: "16ch" }}>
              Free, Apache-2.0, and yours.
            </h2>
          </div>
          <p className="l-lead" style={{ maxWidth: "38ch" }}>
            Forward is open source under the Apache 2.0 license. Your project is
            plain JSON in <span className="l-code-chip">.forward/</span> in your own
            repository: there is nothing to host and nothing to lock you in.
          </p>
        </div>
        <div className="l-surfaces">
          {OPEN_SOURCE.map((s) => (
            <div className="l-surface" key={s.idx}>
              <div className="l-surface-idx">{s.idx}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
        <div className="l-hero-cta">
          <a className="l-btn l-btn-lg l-btn-dark" href={`${DOCS_PATH}#getting-started`}>
            Get started <span className="l-arrow ff-mark" aria-hidden />
          </a>
          <a className="l-btn l-btn-lg l-btn-outline" href={DEMO_PATH}>
            Live demo
          </a>
          <a className="l-btn l-btn-lg l-btn-outline" href={GITHUB_URL}>
            GitHub
          </a>
        </div>
      </section>

      {/* ============ CLOSING CTA ============ */}
      <section id="start" className="l-wrap l-cta-wrap">
        <div className="l-cta">
          <div className="l-cta-dots" aria-hidden />
          <div className="l-cta-inner">
            <h2>One source of truth, from design through delivery.</h2>
            <p>
              Run this in the root of your repository. It creates .forward/, the
              agent configs and the GitHub workflow; commit them and your team,
              the canvas and your agents are in sync.
            </p>
            <InstallLine />
            <div className="l-cta-actions">
              <a className="l-btn l-btn-lg l-btn-accent" href={DOCS_PATH}>
                Read the docs <span className="l-arrow ff-mark" aria-hidden />
              </a>
              <a className="l-btn l-btn-lg l-btn-ghost-light" href={NPM_URL}>
                forward-mcp on npm
              </a>
              <a className="l-btn l-btn-lg l-btn-ghost-light" href={MARKETPLACE_URL}>
                VS Code extension
              </a>
            </div>
            <div className="l-cta-fine">Apache-2.0 · Node 22+ · MCP-native</div>
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
            <a href="#from-code">From code</a>
            <a href="#git">Git-native</a>
            <a href="#open-source">Open source</a>
            <a href={DOCS_PATH}>Docs</a>
            <a href={DEMO_PATH}>Live demo</a>
            <a href={GITHUB_URL}>GitHub</a>
          </div>
          <span className="l-footer-copy">Apache-2.0 · Forward</span>
        </div>
      </footer>
      <BackToTop />
    </div>
  );
}

/* ---------- copyable install command ---------- */
function InstallLine() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(INSTALL_LINE).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };
  return (
    <div className="l-install">
      <code>
        <span className="l-install-prompt" aria-hidden>
          $
        </span>
        {INSTALL_LINE}
      </code>{" "}
      <button type="button" className="l-install-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ---------- small line icon ---------- */
function Icon({ children }: { children: ReactNode }) {
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
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--faint)" />
        </marker>
        <marker id="l-arrA" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--accent)" />
        </marker>
      </defs>
      {/* edges */}
      <g stroke="var(--edge)" strokeWidth="1.4" fill="none">
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
        <rect x="40" y="48" width="146" height="46" rx="7" fill="var(--panel-bright)" stroke="var(--swatch)" />
        <text x="113" y="68" textAnchor="middle" fontSize="13" fill="var(--ink)">
          web client
        </text>
        <text x="113" y="83" textAnchor="middle" fontSize="10" fill="var(--faint)">
          browser
        </text>

        <rect x="300" y="48" width="160" height="46" rx="7" fill="var(--panel-bright)" stroke="var(--swatch)" />
        <text x="380" y="68" textAnchor="middle" fontSize="13" fill="var(--ink)">
          api-gateway
        </text>
        <text x="380" y="83" textAnchor="middle" fontSize="10" fill="var(--faint)">
          edge
        </text>

        <rect x="560" y="48" width="160" height="46" rx="7" fill="var(--panel-bright)" stroke="var(--swatch)" />
        <text x="640" y="68" textAnchor="middle" fontSize="13" fill="var(--ink)">
          events-queue
        </text>
        <text x="640" y="83" textAnchor="middle" fontSize="10" fill="var(--faint)">
          async
        </text>

        <rect
          x="300"
          y="196"
          width="160"
          height="48"
          rx="7"
          fill="var(--panel-bright)"
          stroke="var(--accent)"
          strokeWidth="1.6"
        />
        <text x="380" y="217" textAnchor="middle" fontSize="13" fill="var(--ink)">
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
          fill="var(--panel-bright)"
          stroke="var(--accent2)"
          strokeWidth="1.4"
        />
        <text x="640" y="218" textAnchor="middle" fontSize="13" fill="var(--ink)">
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
        <text x="74" y="301" fontSize="12" fill="var(--ink)">
          flow: place order · 4 hops → Mermaid
        </text>
      </g>
    </svg>
  );
}

/* ---------- content ---------- */
const SURFACES = [
  {
    idx: "01 / CANVAS",
    title: "Draw and review",
    body: "Draw interfaces, model architecture, narrate flows, design data and track work in the browser, served locally from your repository.",
  },
  {
    idx: "02 / VS CODE",
    title: "Document in your editor",
    body: "Backend developers attach framework-agnostic API documentation to any design element without leaving the code.",
  },
  {
    idx: "03 / MCP + CLI",
    title: "Hand it to an agent",
    body: "39 tools with full parity, over MCP or straight from the shell, so any AI assistant or script can create and maintain every artifact.",
  },
];

const GIT_FEATURES = [
  "Push access is edit access",
  "Roster from git contributors",
  "Reviewed in pull requests",
  "Timeline from git log",
  "Canvas server on loopback only",
  "Random per-session key",
];

const MEMBERS = [
  {
    initials: "UA",
    name: "Uncle Akrobeto",
    email: "uncle@example.com",
    color: "var(--accent2)",
  },
  {
    initials: "AD",
    name: "Abeeku Djokoto",
    email: "abeeku@example.com",
    color: "var(--layer-tasks)",
  },
  {
    initials: "AK",
    name: "Ama Kubolor",
    email: "ama@example.com",
    color: "var(--layer-infra)",
  },
];

const BENEFITS = [
  {
    num: "01",
    title: "One source of truth",
    body: "Design, documentation, architecture and tasks live in one .forward/ folder next to the code, so they stop drifting apart.",
  },
  {
    num: "02",
    title: "Docs that can't go stale",
    body: "Documentation lives next to the element it describes and versions with it, change by change, in the same commits as the code.",
  },
  {
    num: "03",
    title: "Editor-native",
    body: "Backend devs document straight from VS Code: no context switch, no second tool to keep open.",
  },
  {
    num: "04",
    title: "AI-ready by default",
    body: "An MCP server and a CLI give any agent full parity to read elements and maintain every artifact.",
  },
  {
    num: "05",
    title: "Traceable end to end",
    body: "Tasks link to design, flows and endpoints, so work always tracks against the thing it's about.",
  },
  {
    num: "06",
    title: "History you can trust",
    body: "Git history, per-element doc history and checkpoints record every change, by whom and when, so decisions are never a mystery.",
  },
];

const OPEN_SOURCE = [
  {
    idx: "01 / LICENSE",
    title: "Apache 2.0, free",
    body: "Use it, fork it, change it. Every surface (canvas, CLI, MCP server, VS Code extension) lives in one repository.",
  },
  {
    idx: "02 / STORAGE",
    title: "Plain JSON in your repo",
    body: "One file per record in .forward/, validated against one schema. Merges stay clean and pull-request diffs stay readable.",
  },
  {
    idx: "03 / SYNC",
    title: "Git does the rest",
    body: "No server to run and no database to back up. Git is the sync, the history and the access control.",
  },
];
