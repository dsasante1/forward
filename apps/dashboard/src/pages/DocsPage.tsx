import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Show } from "@clerk/react";
import { BackToTop } from "../components/BackToTop";
import "../docs.css";

/**
 * Public documentation surface at `/docs` — a sibling of the landing page,
 * outside the protected /app tree so logged-out evaluators (and crawlers) can
 * read it. Single long page with anchor sections; a sticky sidebar drives
 * navigation and an IntersectionObserver highlights the active section.
 *
 * Same warm editorial aesthetic as the landing page (docs.css mirrors the
 * landing tokens). Content tracks the seven data layers and three authoring
 * surfaces the product is actually built around (see CLAUDE.md).
 */

/** Sidebar groups → sections. Ids must match the <Section id> below. */
const NAV: { group: string; items: { id: string; label: string }[] }[] = [
  {
    group: "Start here",
    items: [
      { id: "getting-started", label: "Getting started" },
      { id: "concepts", label: "Core concepts" },
    ],
  },
  {
    group: "Working in Forward",
    items: [
      { id: "canvas", label: "The design canvas" },
      { id: "api-docs", label: "API documentation" },
      { id: "infra", label: "Infrastructure & flows" },
      { id: "data-models", label: "Data models" },
      { id: "tasks", label: "Task management" },
      { id: "history", label: "History & checkpoints" },
    ],
  },
  {
    group: "Surfaces",
    items: [
      { id: "vscode", label: "VS Code extension" },
      { id: "agents", label: "AI agents (MCP)" },
    ],
  },
  {
    group: "Teams & workflow",
    items: [
      { id: "teams", label: "Teams & access" },
      { id: "workflow", label: "Automation & sync" },
    ],
  },
  {
    group: "Reference",
    items: [{ id: "reference", label: "Commands & settings" }],
  },
];

const ALL_IDS = NAV.flatMap((g) => g.items.map((i) => i.id));

export function DocsPage() {
  const [active, setActive] = useState<string>(ALL_IDS[0] ?? "");

  // Scroll-spy: mark the section nearest the top of the viewport as active.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    for (const id of ALL_IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="docs">
      {/* ---------- top nav ---------- */}
      <div className="d-nav-bar">
        <nav className="d-nav">
          <Link to="/" className="d-brand">
            <span className="d-brand-mark" aria-hidden />
            <span className="d-brand-name">FORWARD</span>
            <span className="d-brand-tag">Docs</span>
          </Link>
          <div className="d-nav-right">
            <Link to="/" className="d-nav-link d-nav-hide">
              Home
            </Link>
            <a className="d-nav-link d-nav-hide" href="#getting-started">
              Getting started
            </a>
            <Show when="signed-out">
              <Link to="/sign-up" className="d-btn">
                Start free <span className="ff-mark" aria-hidden />
              </Link>
            </Show>
            <Show when="signed-in">
              <Link to="/app" className="d-btn">
                Open app <span className="ff-mark" aria-hidden />
              </Link>
            </Show>
          </div>
        </nav>
      </div>

      <div className="d-shell">
        {/* ---------- left sidebar ---------- */}
        <aside className="d-side" aria-label="Documentation sections">
          <details className="d-nav-collapse">
            <summary className="d-side-summary">Documentation menu</summary>
            <div className="d-side-body">
              {NAV.map((g) => (
                <div className="d-side-group" key={g.group}>
                  <p className="d-side-group-h">{g.group}</p>
                  {g.items.map((it) => (
                    <a
                      key={it.id}
                      href={`#${it.id}`}
                      className={`d-side-link${active === it.id ? " active" : ""}`}
                    >
                      {it.label}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </aside>

        {/* ---------- content ---------- */}
        <main className="d-main">
          <header className="d-hero">
            <p className="d-kicker">Documentation</p>
            <h1>Everything you can do with Forward.</h1>
            <p>
              Forward keeps your UI design, backend documentation, architecture,
              data models and project work in one place — authored from the web
              app, VS Code, or an AI agent. This guide walks through every layer
              and every surface.
            </p>
          </header>

          {/* ===== GETTING STARTED ===== */}
          <Section
            id="getting-started"
            kicker="Start here"
            title="Getting started"
            sub="Create a workspace, spin up your first project, and understand the vocabulary the rest of these docs use."
          >
            <ol className="d-steps">
              <li>
                <strong>Create your workspace.</strong> Sign up and an{" "}
                <strong>organization</strong> is created for you — the top
                tenancy tier that holds your projects and members.
              </li>
              <li>
                <strong>Create a project.</strong> A <strong>project</strong> is
                the unit of isolation: its own design canvas, docs, architecture,
                data model, tasks and history. You become its <em>owner</em>.
              </li>
              <li>
                <strong>Invite your team.</strong> Add designers and developers
                as members with a role (see{" "}
                <a href="#teams">Teams &amp; access</a>).
              </li>
              <li>
                <strong>Pick how you'll author.</strong> Draw in the web canvas,
                document from the <a href="#vscode">VS Code extension</a>, or hand
                a project to an <a href="#agents">AI agent</a> — all three read
                and write the same project.
              </li>
            </ol>

            <h3>Around the dashboard</h3>
            <p>
              Inside a project you'll find three tabs plus the canvas:
            </p>
            <ul>
              <li>
                <strong>Tasks</strong> — the tracker: list and Gantt views (see{" "}
                <a href="#tasks">Task management</a>).
              </li>
              <li>
                <strong>Docs</strong> — every design element with API
                documentation, listed as endpoints; each one links straight into
                the canvas, focused on that element.
              </li>
              <li>
                <strong>Members</strong> — the roster: roles and invites (see{" "}
                <a href="#teams">Teams &amp; access</a>).
              </li>
              <li>
                <strong>Canvas</strong> — the full-screen design editor (see{" "}
                <a href="#canvas">The design canvas</a>).
              </li>
            </ul>
            <p>
              Your <strong>Account</strong> page holds personal settings and the{" "}
              <strong>Extension tokens</strong> panel, where you generate the{" "}
              <code className="d-code">fwd_pat_…</code> tokens the VS Code
              extension and MCP server sign in with.
            </p>

            <h3>The project id is a tenancy namespace</h3>
            <p>
              Every project has an id like <code className="d-code">project_xyz</code>.
              It is the namespace
              that scopes who can see and edit a workspace. When you connect the
              VS Code extension or the MCP server, its project id must match the
              project you want to share elements with.
            </p>
            <div className="d-note accent">
              <span>
                <b>Roles at a glance —</b> <em>viewer</em> reads,{" "}
                <em>editor</em> reads and writes the data layers, and{" "}
                <em>owner</em> also manages the member roster and invites. A
                project always keeps at least one owner.
              </span>
            </div>
          </Section>

          {/* ===== CORE CONCEPTS ===== */}
          <Section
            id="concepts"
            kicker="Mental model"
            title="Core concepts"
            sub="Forward is built from seven intentionally-separate layers. The design layer is primary and stands on its own; every other layer is optional and either attaches to a design element or links to one by id."
          >
            <p>
              Understanding these seven layers makes the rest of the product
              obvious — every feature is one of them, and every surface (web, VS
              Code, agent) speaks the same shapes.
            </p>
            <Figure caption="fig 1 — the design layer stands alone; a binding attaches to an element; everything else is project-scoped and links by id.">
              <LayersFigure />
            </Figure>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Layer</th>
                    <th>What it is</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Design</td>
                    <td>
                      The frames, shapes, text, components and instances a
                      designer draws — with geometry and a parent/child
                      hierarchy. The primary artifact; everything else hangs off
                      it.
                    </td>
                  </tr>
                  <tr>
                    <td>API binding</td>
                    <td>
                      An optional title + Markdown description attached to a
                      design element. Docs-first and framework-agnostic — an
                      endpoint is never a first-class canvas object.
                    </td>
                  </tr>
                  <tr>
                    <td>Infrastructure</td>
                    <td>
                      A project-wide graph of nodes (apps, services, databases,
                      caches, queues) and edges, rendered as an overlay.
                    </td>
                  </tr>
                  <tr>
                    <td>Flows</td>
                    <td>
                      Narrated, ordered hops across the infra graph; a hop can tie
                      to an endpoint. Exports to a Mermaid sequence diagram.
                    </td>
                  </tr>
                  <tr>
                    <td>Entities (ER/UML)</td>
                    <td>
                      A project-wide data model of tables, fields and crow's-foot
                      relations. Exports to a Mermaid <code className="d-code">erDiagram</code>.
                    </td>
                  </tr>
                  <tr>
                    <td>Tasks</td>
                    <td>
                      A tracker of work items that can each link into any other
                      layer — an element, a flow or an endpoint.
                    </td>
                  </tr>
                  <tr>
                    <td>Checkpoints</td>
                    <td>
                      Named, restorable snapshots of the whole canvas, each with a
                      note and per-layer change counts.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              A related, project-scoped <strong>Agents layer</strong> lets you{" "}
              <em>document</em> the MCP servers and AI agents your project builds
              or consumes (see <a href="#agents">AI agents</a>) — distinct from the
              seven above but modelled the same way.
            </p>
            <p>
              On top of the layers sit the <strong>timelines</strong>: a
              per-element history of documentation changes and a unified project
              event feed. Together they power the History view, doc diffs and the
              catch-up digest (see <a href="#history">History &amp; checkpoints</a>
              ).
            </p>
          </Section>

          {/* ===== CANVAS ===== */}
          <Section
            id="canvas"
            kicker="Design layer"
            title="The design canvas"
            sub="An editor embedded right in the dashboard. Draw the interface, then let every other layer attach to what you drew."
          >
            <p>The
              canvas is where the design layer lives and where the infra, API and
              task overlays render on top of it.
            </p>
            <Figure caption="fig 2 — the canvas shell: toolbar rail, layers tree, a selected element with its API badge, and the drawer.">
              <CanvasFigure />
            </Figure>

            <h3>Element types</h3>
            <p>Every element you draw is one of six types:</p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>type</th>
                    <th>What it is</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>frame</td>
                    <td>A container / screen — establishes hierarchy; nest anything inside it.</td>
                  </tr>
                  <tr>
                    <td>rectangle</td>
                    <td>A generic box — buttons, cards, inputs.</td>
                  </tr>
                  <tr>
                    <td>ellipse</td>
                    <td>A circle / oval, drawn within its bounding box.</td>
                  </tr>
                  <tr>
                    <td>text</td>
                    <td>A text label.</td>
                  </tr>
                  <tr>
                    <td>component</td>
                    <td>A reusable master definition.</td>
                  </tr>
                  <tr>
                    <td>instance</td>
                    <td>A placed copy of a component (links back via <code className="d-code">componentId</code>).</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>What an element stores</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>id, type, name</td>
                    <td>Identity and the element type above.</td>
                  </tr>
                  <tr>
                    <td>x, y, width, height</td>
                    <td>Absolute geometry in canvas space.</td>
                  </tr>
                  <tr>
                    <td>rotation</td>
                    <td>Degrees clockwise about the element's center (default 0).</td>
                  </tr>
                  <tr>
                    <td>parentId</td>
                    <td>The containing element, or <code className="d-code">null</code> at the top level — this is the layer tree.</td>
                  </tr>
                  <tr>
                    <td>text</td>
                    <td>Text content (for text elements).</td>
                  </tr>
                  <tr>
                    <td>style</td>
                    <td>Fill, stroke (width/style, per-side), corner radius (uniform or per-corner), font size/weight/family/color.</td>
                  </tr>
                  <tr>
                    <td>componentId</td>
                    <td>For an instance: the source component's id.</td>
                  </tr>
                  <tr>
                    <td>apiBinding</td>
                    <td>The optional backend documentation attached to this element (see below).</td>
                  </tr>
                  <tr>
                    <td>updatedAt</td>
                    <td>ISO-8601 timestamp of the last write (stamped by the server).</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Because geometry is absolute and hierarchy is a plain{" "}
              <code className="d-code">parentId</code>, the layer rail reflects a
              real tree. Select an element to open its API drawer, inspect its
              overlays, or view its history.
            </p>

            <h3>Toolbar, overlays &amp; view controls</h3>
            <p>
              The left rail doesn't hold drawing tools — shapes come from the
              keyboard or the right-click menu. Instead it toggles the panels and
              overlays that sit on top of the design:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>Toggle</th><th>Opens</th></tr>
                </thead>
                <tbody>
                  <tr><td>Layers</td><td>The design-tree sidebar (the element hierarchy).</td></tr>
                  <tr><td>Docs</td><td>Endpoint badges on documented elements + the API drawer.</td></tr>
                  <tr><td>Infra</td><td>The infrastructure graph overlay and its editing drawer.</td></tr>
                  <tr><td>Data</td><td>The entity/ER overlay and its editing drawer.</td></tr>
                  <tr><td>UML</td><td>The Mermaid diagram pane (sequence, component, ER exports).</td></tr>
                  <tr><td>Agents</td><td>The agent / MCP-server wiring diagram.</td></tr>
                  <tr><td>History</td><td>The project timeline panel (see <a href="#history">History</a>).</td></tr>
                  <tr><td>Tasks</td><td>The task-tracker panel.</td></tr>
                  <tr><td>Theme</td><td>The view-theme editor — per-user, stored locally, never shared.</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              A zoom bar (−&nbsp;/&nbsp;+&nbsp;/&nbsp;<strong>Fit</strong>) sits in
              the top bar, and a <strong>live-sync</strong> indicator shows the
              realtime connection to the Forward backend. Right-click anywhere on
              the canvas for the <strong>Add element</strong> menu — the same
              catalog the keyboard shortcuts arm, nested at the point you clicked.
            </p>

            <h3>Drawing &amp; keyboard shortcuts</h3>
            <p>
              Select is the default mode. Press a tool key, then drag on the
              canvas to size the new element (single-key shortcuts;
              they're ignored while you're typing in a field):
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>Key</th><th>Action</th></tr>
                </thead>
                <tbody>
                  <tr><td>V</td><td>Select / move.</td></tr>
                  <tr><td>F</td><td>Draw a frame.</td></tr>
                  <tr><td>R</td><td>Draw a rectangle.</td></tr>
                  <tr><td>O</td><td>Draw an ellipse.</td></tr>
                  <tr><td>T</td><td>Add text.</td></tr>
                  <tr><td>⌘S / Ctrl+S</td><td>Save a checkpoint (opens the save modal — see <a href="#history">Checkpoints</a>).</td></tr>
                  <tr><td>Delete / Backspace</td><td>Delete the selected element.</td></tr>
                  <tr><td>Escape</td><td>Deselect / close the open dialog.</td></tr>
                </tbody>
              </table>
            </div>
            <div className="d-note">
              <span>
                The canvas is embedded by the dashboard, not a standalone app.
                Diagrams (infra, flows, ER) render with Mermaid inside the same
                view.
              </span>
            </div>
          </Section>

          {/* ===== API DOCS ===== */}
          <Section
            id="api-docs"
            kicker="API binding layer"
            title="API documentation"
            sub="Attach framework-agnostic Markdown docs to any design element — so an endpoint stays tied to the interface it powers, and the docs can't drift away from the UI."
          >
            <p>
              An <strong>API binding</strong> is just a{" "}
              <code className="d-code">title</code> and a Markdown{" "}
              <code className="d-code">description</code>. Most elements never get
              one; the ones that do become the anchor for backend documentation.
              You can author bindings from the canvas, but the intended home is
              the <a href="#vscode">VS Code extension</a> and the{" "}
              <a href="#agents">MCP server</a> — where the backend actually lives.
            </p>
            <Figure caption="fig 3 — a binding: two fields on an element. The Markdown body carries the meaning; every edit becomes a diff.">
              <BindingFigure />
            </Figure>
            <h3>The binding shape</h3>
            <p>A binding is deliberately tiny — two fields:</p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>title</td>
                    <td>A one-line label, e.g. <code className="d-code">POST /api/checkout</code>.</td>
                  </tr>
                  <tr>
                    <td>description</td>
                    <td>The full Markdown body — request/response shape, status codes, notes. Anything the reader needs.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              That's it. There's no enforced HTTP method or path — you can write{" "}
              <code className="d-code">GET</code>,{" "}
              <code className="d-code">POST</code>,{" "}
              <code className="d-code">PUT</code>,{" "}
              <code className="d-code">PATCH</code> or{" "}
              <code className="d-code">DELETE</code> in the title, or document a
              GraphQL resolver, a gRPC call, a CLI command or a background job the
              same way. The Markdown carries the meaning.
            </p>
            <h3>Why docs-first</h3>
            <ul>
              <li>
                <strong>Framework-agnostic.</strong> There's no OpenAPI import or
                route scanner to keep happy — the Markdown carries the meaning.
              </li>
              <li>
                <strong>Tied to the UI.</strong> The doc is attached to the
                element it describes, so it's discoverable from the design.
              </li>
              <li>
                <strong>Versioned.</strong> Every edit is captured as a
                reviewable, git-style diff (see{" "}
                <a href="#history">History</a>).
              </li>
            </ul>
          </Section>

          {/* ===== INFRA & FLOWS ===== */}
          <Section
            id="infra"
            kicker="Infrastructure & flow layers"
            title="Infrastructure & flows"
            sub="Model your architecture as one project-wide graph, then narrate how a request travels across it."
          >
            <h3>The infrastructure graph</h3>
            <p>
              Add <strong>nodes</strong> and connect them with{" "}
              <strong>edges</strong>. Unlike the design layer, the infra graph is
              project-scoped and isn't attached to any one element; it renders as
              its own overlay and serializes to a Mermaid component diagram. Each
              node has a <strong>kind</strong> that drives its colour and icon:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>kind</th>
                    <th>Represents</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>frontend</td><td>Web / mobile client.</td></tr>
                  <tr><td>backend</td><td>API server / app service.</td></tr>
                  <tr><td>database</td><td>SQL / NoSQL store.</td></tr>
                  <tr><td>cache</td><td>Redis, Memcached…</td></tr>
                  <tr><td>queue</td><td>Kafka, SQS, RabbitMQ…</td></tr>
                  <tr><td>service</td><td>Internal microservice.</td></tr>
                  <tr><td>devops</td><td>CI/CD, container, IaC, monitoring.</td></tr>
                  <tr><td>external</td><td>Third-party / SaaS dependency.</td></tr>
                  <tr><td>group</td><td>A container box that visually groups other nodes.</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              A node carries a <code className="d-code">label</code>, an optional{" "}
              <code className="d-code">tech</code> tag (e.g. "v15", "Node 20"), a
              Markdown <code className="d-code">description</code>, geometry, and a{" "}
              <code className="d-code">parentId</code> to nest it inside a group.
              An edge is just <code className="d-code">from</code> →{" "}
              <code className="d-code">to</code> node ids with an optional label.
            </p>

            <h3>Narrated flows</h3>
            <p>
              A <strong>flow</strong> has a name, a Markdown overview and an
              ordered list of <strong>steps</strong>. Each step is a hop from one
              infra node to another — "place order", "sign in", "checkout" — and
              can carry an <code className="d-code">endpointId</code> that ties the
              arrow to a documented endpoint (turning a generic arrow into "called
              by <code className="d-code">POST /auth/verify</code>"). Every step
              has a <strong>call style</strong>:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>kind</th>
                    <th>Meaning</th>
                    <th>Mermaid arrow</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>sync</td><td>A request that waits for a response.</td><td><code className="d-code">-&gt;&gt;</code></td></tr>
                  <tr><td>async</td><td>Fire-and-forget / a publish.</td><td><code className="d-code">-)</code></td></tr>
                  <tr><td>reply</td><td>A response back to the caller.</td><td><code className="d-code">--&gt;&gt;</code></td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Flows render as numbered arrows across the graph and export to a
              Mermaid <code className="d-code">sequenceDiagram</code> you can drop
              straight into a design doc.
            </p>
            <Figure caption="fig 4 — a narrated flow over the infra graph: numbered hops, one tied to a documented endpoint.">
              <FlowFigure />
            </Figure>
          </Section>

          {/* ===== DATA MODELS ===== */}
          <Section
            id="data-models"
            kicker="Entity layer"
            title="Data models"
            sub="Entity-relationship diagrams with tables, fields and crow's-foot cardinality — versioned with the rest of the project."
          >
            <p>
              Define <strong>entities</strong> (tables with fields) and{" "}
              <strong>relations</strong> between them. Like infra, the data model
              is its own project-scoped graph.
            </p>
            <Figure caption="fig 5 — two entities and a crow's-foot relation: USER places zero-or-many ORDERs.">
              <ErFigure />
            </Figure>

            <h3>Fields &amp; keys</h3>
            <p>
              Each entity holds a list of <strong>fields</strong>, and every field
              has a name, a free-form <code className="d-code">type</code> (e.g.
              "uuid", "varchar", "int"), an optional note, and zero or more key
              roles:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>key</th><th>Role</th></tr>
                </thead>
                <tbody>
                  <tr><td>PK</td><td>Primary key.</td></tr>
                  <tr><td>FK</td><td>Foreign key.</td></tr>
                  <tr><td>UK</td><td>Unique key.</td></tr>
                </tbody>
              </table>
            </div>

            <h3>Relationships (crow's-foot)</h3>
            <p>
              A relation is directed (<code className="d-code">from</code> →{" "}
              <code className="d-code">to</code> entity), carries a verb label, and
              has a cardinality at <em>each</em> end:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>cardinality</th><th>Meaning</th></tr>
                </thead>
                <tbody>
                  <tr><td>zero-or-one</td><td>Optional single (<code className="d-code">|o</code>).</td></tr>
                  <tr><td>exactly-one</td><td>Required single (<code className="d-code">||</code>).</td></tr>
                  <tr><td>zero-or-many</td><td>Optional many (<code className="d-code">{"}o"}</code>).</td></tr>
                  <tr><td>one-or-many</td><td>Required many (<code className="d-code">{"}|"}</code>).</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              An <code className="d-code">identifying</code> flag picks the line
              style — solid when the child can't exist without the parent, dashed
              otherwise. Export the whole model as a Mermaid{" "}
              <code className="d-code">erDiagram</code> — easy to review in a pull
              request, version alongside code, and keep next to the API docs and
              architecture it supports.
            </p>
          </Section>

          {/* ===== TASKS ===== */}
          <Section
            id="tasks"
            kicker="Task layer"
            title="Task management"
            sub="Track the work next to the system it belongs to. Every task can link to a design element, a flow or an endpoint — full traceability from planning to implementation."
          >
            <h3>Status, type &amp; priority</h3>
            <p>Three independent enums classify every task:</p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>Field</th><th>Values</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>status</td>
                    <td><code className="d-code">todo</code> · <code className="d-code">in_progress</code> · <code className="d-code">blocked</code> · <code className="d-code">done</code></td>
                  </tr>
                  <tr>
                    <td>type</td>
                    <td><code className="d-code">bug</code> · <code className="d-code">feature</code> · <code className="d-code">task</code> · <code className="d-code">milestone</code> (a zero-duration marker, drawn as a diamond)</td>
                  </tr>
                  <tr>
                    <td>priority</td>
                    <td><code className="d-code">low</code> · <code className="d-code">medium</code> · <code className="d-code">high</code> · <code className="d-code">urgent</code></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>What a task carries</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>Field</th><th>Meaning</th></tr>
                </thead>
                <tbody>
                  <tr><td>key, title</td><td>A short human key (e.g. <code className="d-code">FWD-12</code>) and the title.</td></tr>
                  <tr><td>description</td><td>Free-form Markdown detail.</td></tr>
                  <tr><td>labels</td><td>Free-form label names (e.g. "backend").</td></tr>
                  <tr><td>assignees, reporter</td><td>Members doing the work, and who filed it.</td></tr>
                  <tr><td>dueDate</td><td>An ISO date or a short label like "Jun 24".</td></tr>
                  <tr><td>dependsOn</td><td>Ids of tasks that should finish before this one starts (finish-to-start) — drives the Gantt dependency connectors.</td></tr>
                  <tr><td>elementId</td><td>Optional link to the design element the task concerns.</td></tr>
                  <tr><td>flowId</td><td>Optional link to the narrated flow it implements.</td></tr>
                  <tr><td>endpointId</td><td>Optional link to the element whose apiBinding defines the endpoint.</td></tr>
                  <tr><td>activity</td><td>Chronological feed of comments and events (oldest first).</td></tr>
                  <tr><td>createdAt, updatedAt</td><td>Server-stamped timestamps.</td></tr>
                </tbody>
              </table>
            </div>
            <div className="d-note">
              <span>
                All three layer links are independent and optional, and they're{" "}
                <b>soft references</b> — a task may briefly point at a deleted
                element; the app tolerates that rather than blocking you.
              </span>
            </div>

            <h3>Views</h3>
            <p>
              Work the list in the project's Tasks tab, or switch to the{" "}
              <strong>Gantt</strong> view to see scheduling and dependencies laid
              out over time. Because tasks link into the other layers, you always
              know which design, flow or endpoint a piece of work maps to.
            </p>
            <Figure caption="fig 6 — the Gantt view: dependsOn draws finish-to-start connectors; milestones are zero-duration diamonds.">
              <GanttFigure />
            </Figure>
          </Section>

          {/* ===== HISTORY ===== */}
          <Section
            id="history"
            kicker="Timelines & snapshots"
            title="History & checkpoints"
            sub="The project remembers everything — every documentation edit is a reviewable diff, and you can snapshot and restore the whole workspace."
          >
            <h3>The History timeline</h3>
            <p>
              Two timelines drive it: an append-only, per-element history of API
              documentation, and a unified project event feed. Forward flattens
              them into one chronological stream, lays it out as a git-graph, and
              colours each event by the layer it came from:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>domain</th><th>Source</th></tr>
                </thead>
                <tbody>
                  <tr><td>design</td><td>Design-element changes.</td></tr>
                  <tr><td>api</td><td>API binding (documentation) changes.</td></tr>
                  <tr><td>infra</td><td>Infrastructure node/edge changes.</td></tr>
                  <tr><td>uml</td><td>Narrated flow changes.</td></tr>
                  <tr><td>agent</td><td>Agent / MCP-server node changes.</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Each event records its action —{" "}
              <code className="d-code">created</code>,{" "}
              <code className="d-code">modified</code> or{" "}
              <code className="d-code">deleted</code> — plus the author, timestamp
              and a one-line detail, so you can see who changed what, when, across
              every layer.
            </p>
            <Figure caption="fig 7 — the History git-graph, coloured by layer, beside a doc diff with a breaking-change flag.">
              <HistoryFigure />
            </Figure>

            <h3>Doc diffs</h3>
            <p>
              Each edit to an API binding is a <strong>git-style diff</strong> — a
              title change plus a line-level Markdown diff between two versions.
              Expand any revision to review exactly what moved: added rows are
              green, removed rows red, and a <code className="d-code">+a −r</code>{" "}
              badge summarizes the change on the collapsed card. A diff can also be
              flagged <strong>breaking</strong>, which surfaces a warning callout
              so consumers know clients may need changes. Even a{" "}
              <em>deleted</em> endpoint stays labelled, because each entry stores a
              snapshot of the method/path/title at write time.
            </p>

            <h3>Catch-up digest</h3>
            <p>
              Pick a baseline (say, "since last release") and Forward collapses the
              event stream into a digest of what's <em>to integrate</em>,{" "}
              <em>to modify</em> and <em>to remove</em> — the fast way for a
              frontend dev to catch up on backend changes.
            </p>

            <h3>Checkpoints</h3>
            <p>
              A checkpoint is a deliberate, whole-canvas save: a title, a Markdown
              note, and a frozen copy of the design + infra graph you can restore
              later. Create one from the canvas with the <strong>Save</strong>{" "}
              button or <strong>⌘S / Ctrl+S</strong>. Each is tagged{" "}
              <code className="d-code">milestone</code>,{" "}
              <code className="d-code">checkpoint</code> or{" "}
              <code className="d-code">wip</code>, and its card shows per-layer
              change counts (e.g. <span className="d-pill" style={{ background: "rgba(28,26,21,0.06)", color: "var(--soft)" }}>DESIGN +8</span>{" "}
              <span className="d-pill" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}>API +3</span>).
            </p>
            <div className="d-note">
              <span>
                A restore rewinds the shared design + infra graph only — your
                per-user view settings (theme, grid) aren't touched, and the
                server assembles the snapshot from the truly-persisted canvas, not
                whatever a client had in memory.
              </span>
            </div>
          </Section>

          {/* ===== VS CODE ===== */}
          <Section
            id="vscode"
            kicker="Surface · editor"
            title="VS Code extension"
            sub="Document the backend where the backend lives. Attach Markdown docs to design elements without leaving your editor."
          >
            <ol className="d-steps">
              <li>
                <strong>Install the extension.</strong> Search for{" "}
                <em>Forward</em> in the VS Code Extensions panel (or on Open VSX)
                and install it.
              </li>
              <li>
                <strong>Point it at Forward.</strong> Set{" "}
                <code className="d-code">forward.apiBaseUrl</code> to the Forward
                API URL shown in your account settings.
              </li>
              <li>
                <strong>Sign in with a PAT.</strong> Run{" "}
                <code className="d-code">forward.signIn</code> and paste a personal
                access token (<code className="d-code">fwd_pat_…</code>) generated
                from your account. It's stored in VS Code SecretStorage.
              </li>
              <li>
                <strong>Select a project.</strong> Run{" "}
                <code className="d-code">forward.selectProject</code> to choose
                which project this workspace documents.
              </li>
              <li>
                <strong>Document.</strong> Use the{" "}
                <code className="d-code">forward.*</code> commands to connect an
                endpoint to an element, edit infra/flows, and file or update
                tasks — all from the editor.
              </li>
            </ol>
            <Figure caption="fig 9 — Forward in VS Code: the command palette filtered to forward.*, a deterministic @adc anchor in the source, and the signed-in status bar.">
              <VscodeFigure />
            </Figure>
            <div className="d-note accent">
              <span>
                <b>What's a PAT?</b> A <code className="d-code">fwd_pat_…</code>{" "}
                token is a long-lived, user-scoped stand-in for a login session
                that headless surfaces use. The server resolves it to you and
                applies your access. Generate and revoke them under{" "}
                <b>Account → Extension tokens</b> in the dashboard.
              </span>
            </div>
            <p>
              Everything you write syncs to the canvas the moment you save, and
              real-time updates flow both ways between the editor, the web app and
              any connected agent.
            </p>
          </Section>

          {/* ===== AGENTS / MCP ===== */}
          <Section
            id="agents"
            kicker="Surface · AI agents"
            title="AI agents (MCP server)"
            sub="Give any AI assistant full parity with the canvas and the extension through the Model Context Protocol server — 37 scoped tools over the same project."
          >
            <p>
              The Forward MCP server exposes 37 tools so an agent can create and
              maintain every artifact — documentation, architecture, data models,
              tasks, even the member roster — exactly as a human contributor does,
              against the same source of truth. The agent only ever sees the
              scoped tools; the full list is in the{" "}
              <a href="#reference">reference</a>.
            </p>
            <h3>Connect it</h3>
            <p>
              The MCP server authenticates with the same{" "}
              <code className="d-code">fwd_pat_…</code> PAT model as the extension;
              the only difference is delivery — the process reads three ambient
              environment variables since no human is present to paste a token:
            </p>
            <pre className="d-pre">
              <code>
                <span className="c"># environment for the Forward MCP server</span>
                {"\n"}FORWARD_API_BASE_URL=<span className="t">&lt;Forward API URL from account settings&gt;</span>
                {"\n"}FORWARD_PROJECT_ID=<span className="t">project_xyz</span>
                {"\n"}FORWARD_API_TOKEN=<span className="t">fwd_pat_…</span>
              </code>
            </pre>
            <p>
              Register the server with your agent host (Claude Desktop, Claude
              Code, or any MCP client). From there the agent can resolve elements
              by fuzzy feature matching, drop deterministic source anchors, and
              document what it builds — the same jobs a backend dev does in VS
              Code.
            </p>
            <Figure caption="fig 10 — an agent working through forward-mcp: fuzzy element resolution, then documenting and closing out the task it implemented.">
              <McpFigure />
            </Figure>
            <div className="d-note">
              <span>
                Because all three surfaces write through the same central server,
                nothing drifts: an agent's change appears in the web canvas and
                the extension instantly.
              </span>
            </div>

            <h3>Document the agents your project uses</h3>
            <p>
              Beyond <em>connecting</em> an agent, Forward has an Agents layer for{" "}
              <em>documenting</em> the AI surface your project builds or consumes —
              its own project-scoped graph, like infrastructure. You can model:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>Node</th><th>What it captures</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>MCP server</td>
                    <td>
                      A label, transport (<code className="d-code">stdio</code> ·{" "}
                      <code className="d-code">http</code> ·{" "}
                      <code className="d-code">sse</code>), origin (
                      <code className="d-code">built</code> by your project vs{" "}
                      <code className="d-code">consumed</code> third-party), and the
                      list of tools it exposes.
                    </td>
                  </tr>
                  <tr>
                    <td>MCP tool</td>
                    <td>
                      A name + Markdown description; an optional{" "}
                      <code className="d-code">endpointId</code> ties the tool to
                      the documented endpoint it wraps.
                    </td>
                  </tr>
                  <tr>
                    <td>Agent</td>
                    <td>
                      A label, the <code className="d-code">model</code> it runs on,
                      a diffable <code className="d-code">systemPrompt</code>, and
                      the ids of the MCP servers it's wired to.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The Markdown bodies here — a tool's description, an agent's system
              prompt — version and diff in the History timeline exactly like an API
              binding, so your agent definitions get the same reviewable history as
              the rest of the project.
            </p>
          </Section>

          {/* ===== TEAMS ===== */}
          <Section
            id="teams"
            kicker="Access control"
            title="Teams & access"
            sub="Organizations are the top tenancy tier; projects are the unit of isolation, each with its own member roster and per-project roles."
          >
            <h3>Roles</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Can do</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>viewer</td>
                    <td>Read every layer of the project.</td>
                  </tr>
                  <tr>
                    <td>editor</td>
                    <td>Read and write the data layers (design, docs, infra, tasks…).</td>
                  </tr>
                  <tr>
                    <td>owner</td>
                    <td>
                      Everything an editor can, plus manage the member roster and
                      send invites. A project always keeps at least one owner.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h3>Managing a workspace</h3>
            <ul>
              <li>
                <strong>Invites.</strong> Owners invite members by email; the
                invitee signs in and redeems the invite to join.
              </li>
              <li>
                <strong>API tokens.</strong> Generate{" "}
                <code className="d-code">fwd_pat_…</code> personal access tokens
                for the extension and MCP server under{" "}
                <strong>Account → Extension tokens</strong>, and revoke them when
                they're no longer needed.
              </li>
              <li>
                <strong>Org &amp; platform admin.</strong> Organizations manage
                projects and membership; a separate platform-admin console gives
                staff a cross-tenant view with an audit trail.
              </li>
            </ul>
            <p>
              Access is enforced by the central server: membership and role are
              checked on every request, and realtime change events are broadcast
              only to members of a project.
            </p>
          </Section>

          {/* ===== AUTOMATION & SYNC ===== */}
          <Section
            id="workflow"
            kicker="Fit it to your process"
            title="Automation & sync"
            sub="Forward is built to slot into how your team already ships — keeping frontend and backend aligned automatically, and letting agents do documentation work as part of your development and release cycle."
          >
            <h3>Everything stays in sync, in real time</h3>
            <p>
              A change made on any surface — the web canvas, the VS Code
              extension or an AI agent — is reflected everywhere at once. You
              don't run a sync step; documenting an endpoint in your editor
              updates the canvas the moment you save, and vice-versa. This is the
              core promise: design and backend docs never drift apart.
            </p>
            <Figure caption="fig 8 — every surface writes through the central server; changes broadcast to project members in realtime.">
              <SyncFigure />
            </Figure>

            <h3>Catch up on what changed</h3>
            <p>
              At review time, in standup, or when a frontend dev picks up new
              work, use the <strong>catch-up digest</strong>: pick a baseline
              (say, "since our last release") and Forward summarizes what's{" "}
              <em>to integrate</em>, <em>to modify</em> and <em>to remove</em>{" "}
              across every endpoint — so nobody hunts through diffs by hand. Pair
              it with a <a href="#history">checkpoint</a> at each release so your
              baselines line up with your own milestones.
            </p>

            <h3>Put an agent in the loop</h3>
            <p>
              Because the <a href="#agents">MCP server</a> authenticates with an
              ambient <code className="d-code">fwd_pat_…</code> token, it runs
              headless — in a background agent, a scripted job, or a step in your
              own pipeline. A common pattern: after a backend change lands, an
              agent opens the affected element, updates its API documentation, and
              files or closes the linked <a href="#tasks">task</a> — keeping the
              docs current without a human writing them.
            </p>

            <h3>Document endpoints from your CI/CD pipeline</h3>
            <p>
              The key to running documentation in CI is the in-code{" "}
              <code className="d-code">@adc</code> anchor: a comment a developer
              drops next to the code that implements a design element, pinning the
              link in the source itself. Unlike fuzzy matching, an anchor is
              unambiguous and re-runnable — exactly what an unattended pipeline
              needs, with no confirm step.
            </p>
            <pre className="d-pre">
              <code>
                <span className="c">{"// @adc el_login_submit"}</span>
                {"\n"}app.post(<span className="t">"/api/v1/login"</span>, loginHandler)
              </code>
            </pre>
            <ol className="d-steps">
              <li>
                <strong>Anchor the code.</strong> As endpoints are built, tag each
                handler with <code className="d-code">@adc &lt;elementId&gt;</code>{" "}
                (any comment syntax works). The{" "}
                <code className="d-code">resolve_anchors</code> tool scans changed
                files and resolves every anchor to its design element.
              </li>
              <li>
                <strong>Store a PAT as a pipeline secret.</strong> Mint a dedicated{" "}
                <code className="d-code">fwd_pat_…</code> token (ideally for a
                CI-bot member, so timeline authorship reads clearly) and expose it
                as <code className="d-code">FORWARD_API_TOKEN</code> alongside{" "}
                <code className="d-code">FORWARD_API_BASE_URL</code> and{" "}
                <code className="d-code">FORWARD_PROJECT_ID</code>.
              </li>
              <li>
                <strong>Run a headless agent on merge.</strong> Add a job on your
                main branch that runs an MCP-capable agent with a prompt like:{" "}
                <em>
                  "For each changed file containing an @adc anchor, read the
                  implementation and update its Forward documentation, with a
                  one-line changeLog referencing the commit."
                </em>{" "}
                The agent resolves the anchors, reads existing docs with{" "}
                <code className="d-code">get_documentation</code>, and writes with{" "}
                <code className="d-code">write_documentation</code> — so only
                touched, anchored endpoints are re-documented, and every update
                lands in the element's version history.
              </li>
              <li>
                <strong>Add guardrails.</strong> A PR-time check can run{" "}
                <code className="d-code">resolve_anchors</code> and fail on anchors
                pointing at deleted or mistyped elements, and a scheduled job can
                post the <code className="d-code">get_catchup_digest</code> output
                to chat so the frontend team sees what changed since their last
                integration baseline.
              </li>
            </ol>
            <pre className="d-pre">
              <code>
                <span className="c"># e.g. GitHub Actions — runs after merge to main</span>
                {"\n"}docs-sync:
                {"\n"}  steps:
                {"\n"}    - run: claude -p <span className="t">"Update Forward docs for endpoints changed in this commit (use @adc anchors)"</span>
                {"\n"}      env:
                {"\n"}        FORWARD_API_BASE_URL: <span className="t">{"$"}{"{{ vars.FORWARD_API_BASE_URL }}"}</span>
                {"\n"}        FORWARD_PROJECT_ID: <span className="t">{"$"}{"{{ vars.FORWARD_PROJECT_ID }}"}</span>
                {"\n"}        FORWARD_API_TOKEN: <span className="t">{"$"}{"{{ secrets.FORWARD_API_TOKEN }}"}</span>
              </code>
            </pre>
            <p>
              The net effect: developers annotate code once with{" "}
              <code className="d-code">@adc</code>, and every merge keeps the
              canvas docs, version history and catch-up digest current — without
              anyone opening the dashboard.
            </p>

            <h3>Automate safely with scoped tokens</h3>
            <ul>
              <li>
                Generate a dedicated <code className="d-code">fwd_pat_…</code>{" "}
                token for each automated environment, so you can revoke one
                without disturbing the others.
              </li>
              <li>
                A token carries its owner's access, so an automation only ever
                touches the projects that person is a member of.
              </li>
              <li>
                Point automation at a single project with{" "}
                <code className="d-code">FORWARD_PROJECT_ID</code> — the same
                config the interactive tools use.
              </li>
            </ul>

            <div className="d-note accent">
              <span>
                <b>Tip —</b> tie a checkpoint to each release of your project.
                It's a restorable snapshot of the whole workspace, and it gives
                the catch-up digest a natural "since last release" baseline.
              </span>
            </div>
          </Section>

          {/* ===== REFERENCE ===== */}
          <Section
            id="reference"
            kicker="Reference"
            title="Commands & settings"
            sub="Quick lookup for the VS Code commands, extension settings and MCP environment variables."
          >
            <h3>VS Code settings</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>forward.apiBaseUrl</td>
                    <td>URL of the Forward server the extension talks to.</td>
                  </tr>
                  <tr>
                    <td>forward.projectId</td>
                    <td>The project this workspace documents (set via the picker).</td>
                  </tr>
                  <tr>
                    <td>forward.openCanvasOnStartup</td>
                    <td>Open the design canvas panel automatically when VS Code starts.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h3>VS Code commands</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>forward.signIn</td>
                    <td>Sign in — paste a <code className="d-code">fwd_pat_…</code> access token.</td>
                  </tr>
                  <tr>
                    <td>forward.signOut</td>
                    <td>Sign out and clear the stored token.</td>
                  </tr>
                  <tr>
                    <td>forward.selectProject</td>
                    <td>Choose which project this workspace documents.</td>
                  </tr>
                  <tr>
                    <td>forward.openCanvas</td>
                    <td>Open the design canvas.</td>
                  </tr>
                  <tr>
                    <td>forward.connectEndpoint</td>
                    <td>Document an API on a design element.</td>
                  </tr>
                  <tr>
                    <td>forward.removeDocumentation</td>
                    <td>Remove API documentation from an element.</td>
                  </tr>
                  <tr>
                    <td>forward.showHistory</td>
                    <td>Show an endpoint's documentation history.</td>
                  </tr>
                  <tr>
                    <td>forward.catchUp</td>
                    <td>Catch up on endpoint changes since a baseline.</td>
                  </tr>
                  <tr>
                    <td>forward.addInfraNode</td>
                    <td>Add an infrastructure node.</td>
                  </tr>
                  <tr>
                    <td>forward.linkInfraNodes</td>
                    <td>Link two infrastructure nodes with an edge.</td>
                  </tr>
                  <tr>
                    <td>forward.removeInfraNode</td>
                    <td>Remove an infrastructure node.</td>
                  </tr>
                  <tr>
                    <td>forward.addFlow</td>
                    <td>Add a narrated flow (sequence diagram).</td>
                  </tr>
                  <tr>
                    <td>forward.addFlowStep</td>
                    <td>Add a step to a flow.</td>
                  </tr>
                  <tr>
                    <td>forward.removeFlow</td>
                    <td>Remove a flow.</td>
                  </tr>
                  <tr>
                    <td>forward.addMcpServer</td>
                    <td>Add an MCP server to the Agents layer.</td>
                  </tr>
                  <tr>
                    <td>forward.removeMcpServer</td>
                    <td>Remove an MCP server node.</td>
                  </tr>
                  <tr>
                    <td>forward.addAgent</td>
                    <td>Add an agent to the Agents layer.</td>
                  </tr>
                  <tr>
                    <td>forward.removeAgent</td>
                    <td>Remove an agent node.</td>
                  </tr>
                  <tr>
                    <td>forward.createTask</td>
                    <td>Create a task.</td>
                  </tr>
                  <tr>
                    <td>forward.updateTaskStatus</td>
                    <td>Update a task's status.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h3>MCP environment variables</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>FORWARD_API_BASE_URL</td>
                    <td>URL of the Forward server.</td>
                  </tr>
                  <tr>
                    <td>FORWARD_PROJECT_ID</td>
                    <td>Tenancy namespace the agent operates in.</td>
                  </tr>
                  <tr>
                    <td>FORWARD_API_TOKEN</td>
                    <td>The <code className="d-code">fwd_pat_…</code> PAT the server resolves to its owner.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>MCP tools</h3>
            <p>
              The 37 tools the Forward MCP server exposes to an agent, by area:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Tools</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Design</td>
                    <td>
                      <code className="d-code">list_design_elements</code>{" "}
                      <code className="d-code">find_element</code>{" "}
                      <code className="d-code">resolve_anchors</code>{" "}
                      <code className="d-code">create_element</code>{" "}
                      <code className="d-code">update_element</code>{" "}
                      <code className="d-code">delete_element</code>
                    </td>
                  </tr>
                  <tr>
                    <td>API docs</td>
                    <td>
                      <code className="d-code">get_documentation</code>{" "}
                      <code className="d-code">write_documentation</code>{" "}
                      <code className="d-code">remove_documentation</code>{" "}
                      <code className="d-code">get_history</code>{" "}
                      <code className="d-code">get_catchup_digest</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Infrastructure</td>
                    <td>
                      <code className="d-code">list_infra</code>{" "}
                      <code className="d-code">write_infra_node</code>{" "}
                      <code className="d-code">connect_infra</code>{" "}
                      <code className="d-code">remove_infra_node</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Flows</td>
                    <td>
                      <code className="d-code">list_flows</code>{" "}
                      <code className="d-code">write_flow</code>{" "}
                      <code className="d-code">add_flow_step</code>{" "}
                      <code className="d-code">remove_flow</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Data models</td>
                    <td>
                      <code className="d-code">list_entities</code>{" "}
                      <code className="d-code">write_entity</code>{" "}
                      <code className="d-code">relate_entities</code>{" "}
                      <code className="d-code">remove_entity</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Agents layer</td>
                    <td>
                      <code className="d-code">list_agents</code>{" "}
                      <code className="d-code">write_mcp_server</code>{" "}
                      <code className="d-code">write_agent</code>{" "}
                      <code className="d-code">remove_mcp_server</code>{" "}
                      <code className="d-code">remove_agent</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Tasks</td>
                    <td>
                      <code className="d-code">list_tasks</code>{" "}
                      <code className="d-code">get_task</code>{" "}
                      <code className="d-code">create_task</code>{" "}
                      <code className="d-code">update_task</code>{" "}
                      <code className="d-code">comment_task</code>{" "}
                      <code className="d-code">delete_task</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Members</td>
                    <td>
                      <code className="d-code">list_members</code>{" "}
                      <code className="d-code">add_member</code>{" "}
                      <code className="d-code">remove_member</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="d-note accent" style={{ marginTop: 28 }}>
              <span>
                <b>Ready to start?</b>{" "}
                <Show when="signed-out">
                  <Link to="/sign-up">Create a workspace</Link> and open your first
                  project.
                </Show>
                <Show when="signed-in">
                  <Link to="/app">Open your workspace</Link> and pick a project.
                </Show>
              </span>
            </div>
          </Section>
        </main>

        {/* ---------- right rail: resources ---------- */}
        <aside className="d-toc" aria-label="Resources">
          <p className="d-toc-h">Resources</p>
          <Link to="/">
            <span className="ff-mark ff-mark--back" aria-hidden /> Back to home
          </Link>
          <a href="#getting-started">Getting started</a>
          <a href="#vscode">VS Code extension</a>
          <a href="#agents">AI agents (MCP)</a>
          <a href="#workflow">Automation &amp; sync</a>
          <Show when="signed-out">
            <Link to="/sign-up">
              Start free <span className="ff-mark" aria-hidden />
            </Link>
          </Show>
          <Show when="signed-in">
            <Link to="/app">
              Open app <span className="ff-mark" aria-hidden />
            </Link>
          </Show>
        </aside>
      </div>

      {/* ---------- footer ---------- */}
      <footer className="d-footer">
        <div className="d-footer-inner">
          <div className="d-footer-line" />
          <div className="d-footer-row">
            <Link to="/" className="d-footer-brand">
              <span className="d-footer-mark" aria-hidden />
              <span className="d-footer-nm">FORWARD</span>
            </Link>
            <nav className="d-footer-links" aria-label="Footer">
              <a href="#getting-started">Getting started</a>
              <a href="#concepts">Core concepts</a>
              <a href="#vscode">VS Code extension</a>
              <a href="#agents">AI agents</a>
              <a href="#reference">Reference</a>
              <Link to="/">Home</Link>
            </nav>
            <span className="d-footer-copy">© {new Date().getFullYear()} Forward</span>
          </div>
        </div>
      </footer>
      <BackToTop />
    </div>
  );
}

/** Illustration wrapper: framed panel + mono figcaption. */
function Figure({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="d-fig">
      <div className="d-fig-panel">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/*
 * Hand-drawn SVG figures, one per major section. Same idiom as the landing
 * page's InfraGraph: JetBrains Mono labels, #fffdf8 boxes on the warm rail,
 * and the per-layer colours from docs.css (design #3a6ea8, api var(--accent),
 * infra #8a6db0, tasks #a98f5e).
 */
const FONT = "'JetBrains Mono', ui-monospace, monospace";
const INK = "#1c1a15";
const FAINT = "#9c9488";
const EDGE = "#b9af9c";
const BOX = "#fffdf8";
const BORDER = "#cdbfa6";
const DESIGN = "#3a6ea8";
const INFRA = "#8a6db0";
const TASKS = "#a98f5e";
const GREEN = "#4a9d6b";

function LayersFigure() {
  const label = "Seven layers: the design layer is primary; the API binding attaches to an element; infrastructure, entities and tasks are project-scoped and link by id";
  return (
    <svg viewBox="0 0 760 320" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <marker id="f-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill={EDGE} />
        </marker>
        <marker id="f-arrA" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--accent)" />
        </marker>
        <marker id="f-arrT" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill={TASKS} />
        </marker>
      </defs>
      {/* design layer — primary */}
      <rect x="36" y="170" width="320" height="118" rx="8" fill={BOX} stroke={DESIGN} strokeWidth="1.6" />
      <text x="52" y="192" fontSize="11.5" fill={DESIGN}>design — the primary layer</text>
      <rect x="52" y="204" width="150" height="68" rx="4" fill="none" stroke={BORDER} />
      <text x="60" y="218" fontSize="9" fill={FAINT}>frame</text>
      <rect x="64" y="234" width="92" height="24" rx="5" fill="#e7ecf4" stroke={DESIGN} />
      <text x="110" y="250" textAnchor="middle" fontSize="10.5" fill={INK}>Pay now</text>
      <ellipse cx="260" cy="238" rx="26" ry="18" fill="none" stroke={BORDER} />
      {/* api binding — attaches */}
      <rect x="76" y="44" width="210" height="70" rx="8" fill={BOX} stroke="var(--accent)" strokeWidth="1.6" />
      <text x="92" y="66" fontSize="12" fill={INK}>POST /api/checkout</text>
      <rect x="92" y="76" width="150" height="5" rx="2.5" fill="rgba(28,26,21,0.12)" />
      <rect x="92" y="87" width="110" height="5" rx="2.5" fill="rgba(28,26,21,0.12)" />
      <text x="92" y="106" fontSize="9.5" fill="var(--accent)">apiBinding · markdown · versioned</text>
      <path d="M150 114 L112 230" fill="none" stroke="var(--accent)" strokeWidth="1.4" markerEnd="url(#f-arrA)" />
      <text x="146" y="170" fontSize="10" fill="var(--accent)">attaches</text>
      {/* project-scoped layers */}
      <rect x="470" y="40" width="250" height="54" rx="8" fill={BOX} stroke={INFRA} strokeWidth="1.4" />
      <text x="486" y="62" fontSize="12" fill={INK}>infrastructure + flows</text>
      <text x="486" y="78" fontSize="9.5" fill={FAINT}>project-scoped graph · narrated hops</text>
      <rect x="470" y="110" width="250" height="54" rx="8" fill={BOX} stroke={BORDER} strokeWidth="1.4" />
      <text x="486" y="132" fontSize="12" fill={INK}>entities (ER)</text>
      <text x="486" y="148" fontSize="9.5" fill={FAINT}>tables + crow's-foot relations</text>
      <rect x="470" y="180" width="250" height="54" rx="8" fill={BOX} stroke={TASKS} strokeWidth="1.4" />
      <text x="486" y="202" fontSize="12" fill={INK}>tasks</text>
      <text x="486" y="218" fontSize="9.5" fill={FAINT}>link into any layer</text>
      <rect x="470" y="250" width="250" height="42" rx="8" fill="none" stroke={FAINT} strokeDasharray="4 3" />
      <text x="486" y="268" fontSize="11" fill={INK}>checkpoints</text>
      <text x="486" y="283" fontSize="9.5" fill={FAINT}>restorable snapshots of design + infra</text>
      {/* soft links */}
      <path d="M470 210 C400 220 320 236 166 246" fill="none" stroke={TASKS} strokeWidth="1.2" strokeDasharray="5 4" markerEnd="url(#f-arrT)" />
      <path d="M470 196 C400 170 340 120 292 92" fill="none" stroke={TASKS} strokeWidth="1.2" strokeDasharray="5 4" markerEnd="url(#f-arrT)" />
      <text x="330" y="146" fontSize="10" fill={TASKS}>links by id (soft)</text>
    </svg>
  );
}

function CanvasFigure() {
  const label = "The canvas: toolbar rail, layers tree, a selected element with its endpoint badge, the API drawer, zoom bar and live-sync indicator";
  return (
    <svg viewBox="0 0 760 340" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="8" y="8" width="744" height="324" rx="10" fill={BOX} stroke={BORDER} />
      {/* top bar */}
      <path d="M8 40 H752" stroke="rgba(28,26,21,0.1)" />
      <text x="24" y="30" fontSize="11" fill={FAINT}>forward / canvas</text>
      <circle cx="200" cy="26" r="3" fill={GREEN} />
      <text x="210" y="30" fontSize="9" fill={GREEN} letterSpacing="0.08em">LIVE SYNC</text>
      <rect x="600" y="15" width="138" height="20" rx="4" fill="#f5efe3" stroke="rgba(28,26,21,0.1)" />
      <text x="669" y="29" textAnchor="middle" fontSize="10" fill={FAINT}>−  100%  +  Fit</text>
      {/* toolbar rail */}
      <path d="M44 40 V332" stroke="rgba(28,26,21,0.1)" />
      {[56, 84, 112, 140, 168, 196, 224, 252].map((y, i) => (
        <rect
          key={y}
          x="17"
          y={y}
          width="18"
          height="18"
          rx="4"
          fill={i === 1 ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "none"}
          stroke={i === 1 ? "var(--accent)" : BORDER}
        />
      ))}
      {/* layers tree */}
      <path d="M180 40 V332" stroke="rgba(28,26,21,0.1)" />
      <text x="56" y="62" fontSize="9" fill={FAINT} letterSpacing="0.14em">LAYERS</text>
      <text x="56" y="86" fontSize="10.5" fill={INK}>▾ Checkout</text>
      <text x="66" y="108" fontSize="10.5" fill="#57514a">frame</text>
      <text x="76" y="130" fontSize="10.5" fill="#57514a">Pay now</text>
      <circle cx="138" cy="126" r="3" fill="var(--accent)" />
      <text x="76" y="152" fontSize="10.5" fill={FAINT}>total-label</text>
      {/* canvas area: frame with nested elements */}
      <text x="220" y="72" fontSize="10" fill={FAINT}>Checkout</text>
      <rect x="220" y="80" width="240" height="180" rx="6" fill="#faf6ee" stroke={BORDER} />
      <rect x="240" y="104" width="120" height="8" rx="4" fill="rgba(28,26,21,0.18)" />
      <rect x="240" y="130" width="200" height="26" rx="5" fill={BOX} stroke={BORDER} />
      <rect x="240" y="172" width="110" height="30" rx="6" fill="#e7ecf4" stroke={DESIGN} strokeWidth="1.6" />
      <text x="295" y="191" textAnchor="middle" fontSize="11" fill={INK}>Pay now</text>
      {[[237, 169], [347, 169], [237, 199], [347, 199]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" fill={BOX} stroke={DESIGN} />
      ))}
      <rect x="358" y="180" width="30" height="14" rx="7" fill="var(--accent)" />
      <text x="373" y="190" textAnchor="middle" fontSize="8" fill="#fff" letterSpacing="0.06em">API</text>
      {/* api drawer */}
      <path d="M600 40 V332" stroke="rgba(28,26,21,0.1)" />
      <text x="614" y="62" fontSize="9" fill={FAINT} letterSpacing="0.14em">API DRAWER</text>
      <text x="614" y="86" fontSize="10.5" fill="var(--accent)">POST /api/checkout</text>
      <rect x="614" y="98" width="118" height="5" rx="2.5" fill="rgba(28,26,21,0.12)" />
      <rect x="614" y="110" width="96" height="5" rx="2.5" fill="rgba(28,26,21,0.12)" />
      <rect x="614" y="122" width="108" height="5" rx="2.5" fill="rgba(28,26,21,0.12)" />
      <text x="614" y="158" fontSize="9" fill={FAINT}>history · v4</text>
      <rect x="614" y="168" width="52" height="15" rx="4" fill="rgba(74,157,107,0.15)" />
      <text x="640" y="179" textAnchor="middle" fontSize="9" fill="#3f7f52">+3 −1</text>
    </svg>
  );
}

function BindingFigure() {
  const label = "An API binding: a design element linked to its documentation card — title, markdown body and version";
  return (
    <svg viewBox="0 0 760 190" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <marker id="b-arrA" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--accent)" />
        </marker>
      </defs>
      <rect x="48" y="64" width="140" height="42" rx="8" fill="#e7ecf4" stroke={DESIGN} strokeWidth="1.6" />
      <text x="118" y="90" textAnchor="middle" fontSize="12.5" fill={INK}>Pay now</text>
      <text x="48" y="130" fontSize="10" fill={FAINT}>design element</text>
      <path d="M188 85 H296" fill="none" stroke="var(--accent)" strokeWidth="1.6" markerEnd="url(#b-arrA)" />
      <text x="244" y="76" textAnchor="middle" fontSize="10" fill="var(--accent)">apiBinding</text>
      <rect x="300" y="28" width="400" height="126" rx="10" fill={BOX} stroke={BORDER} />
      <text x="318" y="50" fontSize="13" fill={INK}>POST /api/checkout</text>
      <rect x="650" y="36" width="34" height="16" rx="4" fill="color-mix(in srgb, var(--accent) 14%, transparent)" />
      <text x="667" y="48" textAnchor="middle" fontSize="9.5" fill="var(--accent)">v4</text>
      <path d="M300 62 H700" stroke="rgba(28,26,21,0.1)" />
      <rect x="318" y="76" width="330" height="6" rx="3" fill="rgba(28,26,21,0.1)" />
      <rect x="318" y="90" width="280" height="6" rx="3" fill="rgba(28,26,21,0.1)" />
      <rect x="318" y="104" width="300" height="6" rx="3" fill="rgba(28,26,21,0.1)" />
      <rect x="318" y="118" width="200" height="22" rx="4" fill="#201d18" />
      <text x="328" y="132" fontSize="9" fill="#d98a5f">{"{ amount, currency }"}</text>
    </svg>
  );
}

function FlowFigure() {
  const label = "A narrated flow: numbered hops across the infrastructure graph — sync request, async publish and a reply — exporting to a Mermaid sequence diagram";
  return (
    <svg viewBox="0 0 760 250" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <marker id="w-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="#57514a" />
        </marker>
      </defs>
      {/* nodes */}
      <rect x="40" y="40" width="130" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="105" y="59" textAnchor="middle" fontSize="12" fill={INK}>web client</text>
      <text x="105" y="74" textAnchor="middle" fontSize="9.5" fill={DESIGN}>frontend</text>
      <rect x="300" y="40" width="140" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="370" y="59" textAnchor="middle" fontSize="12" fill={INK}>checkout-api</text>
      <text x="370" y="74" textAnchor="middle" fontSize="9.5" fill="var(--accent)">backend</text>
      <rect x="580" y="40" width="140" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="650" y="59" textAnchor="middle" fontSize="12" fill={INK}>orders-db</text>
      <text x="650" y="74" textAnchor="middle" fontSize="9.5" fill={INFRA}>database</text>
      <rect x="580" y="150" width="140" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="650" y="169" textAnchor="middle" fontSize="12" fill={INK}>events-queue</text>
      <text x="650" y="184" textAnchor="middle" fontSize="9.5" fill={INFRA}>queue</text>
      {/* hops */}
      <path d="M170 54 H296" fill="none" stroke="#57514a" strokeWidth="1.5" markerEnd="url(#w-arr)" />
      <circle cx="233" cy="54" r="9" fill="var(--accent)" />
      <text x="233" y="58" textAnchor="middle" fontSize="10" fill="#fff">1</text>
      <path d="M440 62 H576" fill="none" stroke="#57514a" strokeWidth="1.5" markerEnd="url(#w-arr)" />
      <circle cx="508" cy="62" r="9" fill="var(--accent)" />
      <text x="508" y="66" textAnchor="middle" fontSize="10" fill="#fff">2</text>
      <text x="508" y="86" textAnchor="middle" fontSize="9" fill="var(--accent)">ties to POST /orders</text>
      <path d="M380 84 C400 140 480 172 576 172" fill="none" stroke="#57514a" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#w-arr)" />
      <circle cx="466" cy="146" r="9" fill="var(--accent)" />
      <text x="466" y="150" textAnchor="middle" fontSize="10" fill="#fff">3</text>
      <path d="M300 76 H174" fill="none" stroke="#57514a" strokeWidth="1.5" strokeDasharray="2 3" markerEnd="url(#w-arr)" />
      <circle cx="233" cy="76" r="9" fill={FAINT} />
      <text x="233" y="80" textAnchor="middle" fontSize="10" fill="#fff">4</text>
      {/* legend */}
      <path d="M40 224 H80" stroke="#57514a" strokeWidth="1.5" />
      <text x="88" y="228" fontSize="10" fill={FAINT}>sync</text>
      <path d="M150 224 H190" stroke="#57514a" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x="198" y="228" fontSize="10" fill={FAINT}>async</text>
      <path d="M270 224 H310" stroke="#57514a" strokeWidth="1.5" strokeDasharray="2 3" />
      <text x="318" y="228" fontSize="10" fill={FAINT}>reply</text>
      <text x="720" y="228" textAnchor="end" fontSize="10" fill={FAINT}>flow: place order → Mermaid sequenceDiagram</text>
    </svg>
  );
}

function ErFigure() {
  const label = "An entity-relationship diagram: USER places ORDER, exactly-one to zero-or-many, with primary, unique and foreign keys";
  return (
    <svg viewBox="0 0 760 210" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      {/* USER */}
      <rect x="60" y="36" width="240" height="26" fill="rgba(58,110,168,0.12)" stroke={BORDER} />
      <text x="180" y="53" textAnchor="middle" fontSize="12" fontWeight="600" fill={INK}>USER</text>
      <rect x="60" y="62" width="240" height="72" fill={BOX} stroke={BORDER} />
      <text x="76" y="82" fontSize="10.5" fill={INK}>id</text>
      <text x="160" y="82" fontSize="10.5" fill={FAINT}>uuid</text>
      <text x="264" y="82" fontSize="10.5" fill="var(--accent)">PK</text>
      <text x="76" y="102" fontSize="10.5" fill={INK}>email</text>
      <text x="160" y="102" fontSize="10.5" fill={FAINT}>varchar</text>
      <text x="264" y="102" fontSize="10.5" fill="var(--accent)">UK</text>
      <text x="76" y="122" fontSize="10.5" fill={INK}>name</text>
      <text x="160" y="122" fontSize="10.5" fill={FAINT}>varchar</text>
      {/* ORDER */}
      <rect x="460" y="36" width="240" height="26" fill="rgba(58,110,168,0.12)" stroke={BORDER} />
      <text x="580" y="53" textAnchor="middle" fontSize="12" fontWeight="600" fill={INK}>ORDER</text>
      <rect x="460" y="62" width="240" height="72" fill={BOX} stroke={BORDER} />
      <text x="476" y="82" fontSize="10.5" fill={INK}>id</text>
      <text x="560" y="82" fontSize="10.5" fill={FAINT}>uuid</text>
      <text x="664" y="82" fontSize="10.5" fill="var(--accent)">PK</text>
      <text x="476" y="102" fontSize="10.5" fill={INK}>user_id</text>
      <text x="560" y="102" fontSize="10.5" fill={FAINT}>uuid</text>
      <text x="664" y="102" fontSize="10.5" fill="var(--accent)">FK</text>
      <text x="476" y="122" fontSize="10.5" fill={INK}>total</text>
      <text x="560" y="122" fontSize="10.5" fill={FAINT}>int</text>
      {/* relation: || — o{ */}
      <path d="M300 98 H460" stroke={EDGE} strokeWidth="1.4" />
      <path d="M312 90 V106 M320 90 V106" stroke={EDGE} strokeWidth="1.4" fill="none" />
      <path d="M460 98 L446 90 M460 98 L446 106" stroke={EDGE} strokeWidth="1.4" fill="none" />
      <circle cx="438" cy="98" r="4" fill={BOX} stroke={EDGE} strokeWidth="1.4" />
      <text x="380" y="90" textAnchor="middle" fontSize="10.5" fill={INK}>places</text>
      <text x="380" y="114" textAnchor="middle" fontSize="9" fill={FAINT}>exactly-one → zero-or-many · identifying</text>
      <text x="60" y="184" fontSize="10" fill={FAINT}>exports to Mermaid erDiagram</text>
    </svg>
  );
}

function GanttFigure() {
  const label = "The Gantt view: tasks laid out over time with a finish-to-start dependency connector and a milestone diamond";
  return (
    <svg viewBox="0 0 760 200" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <marker id="g-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill={EDGE} />
        </marker>
      </defs>
      {[220, 320, 420, 520, 620].map((x, i) => (
        <g key={x}>
          <path d={`M${x} 38 V180`} stroke="rgba(28,26,21,0.07)" />
          <text x={x} y="28" fontSize="9" fill={FAINT}>{["Jun 10", "Jun 17", "Jun 24", "Jul 1", "Jul 8"][i]}</text>
        </g>
      ))}
      <text x="40" y="60" fontSize="10" fill={INK}>FWD-11 · schema</text>
      <rect x="220" y="48" width="140" height="16" rx="8" fill={GREEN} />
      <text x="40" y="96" fontSize="10" fill={INK}>FWD-12 · checkout</text>
      <rect x="380" y="84" width="160" height="16" rx="8" fill="var(--accent)" />
      <path d="M360 56 H370 V92 H376" fill="none" stroke={EDGE} strokeWidth="1.3" markerEnd="url(#g-arr)" />
      <text x="40" y="132" fontSize="10" fill={INK}>FWD-13 · webhooks</text>
      <rect x="560" y="120" width="120" height="16" rx="8" fill={BOX} stroke={BORDER} />
      <text x="40" y="168" fontSize="10" fill={INK}>FWD-14 · release</text>
      <text x="700" y="146" textAnchor="middle" fontSize="9" fill={FAINT}>v1.0</text>
      <path d="M700 154 l10 10 -10 10 -10 -10 Z" fill={TASKS} />
      <text x="220" y="196" fontSize="9" fill={GREEN}>■ done</text>
      <text x="300" y="196" fontSize="9" fill="var(--accent)">■ in progress</text>
      <text x="420" y="196" fontSize="9" fill={FAINT}>□ todo · ◆ milestone</text>
    </svg>
  );
}

function HistoryFigure() {
  const label = "The History view: a git-graph of events coloured by layer, next to a doc diff card with added and removed lines and a breaking-change flag";
  return (
    <svg viewBox="0 0 760 230" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      {/* git-graph lanes */}
      <path d="M70 40 V200 M100 60 V180" stroke={EDGE} strokeWidth="1.2" />
      <circle cx="70" cy="60" r="6" fill="var(--accent)" />
      <text x="126" y="58" fontSize="10" fill={INK}>api · POST /orders modified</text>
      <text x="126" y="71" fontSize="8.5" fill={FAINT}>kwame · 2h ago</text>
      <circle cx="100" cy="100" r="6" fill={INFRA} />
      <text x="126" y="98" fontSize="10" fill={INK}>infra · events-queue added</text>
      <text x="126" y="111" fontSize="8.5" fill={FAINT}>agent · 5h ago</text>
      <circle cx="70" cy="140" r="6" fill={DESIGN} />
      <text x="126" y="138" fontSize="10" fill={INK}>design · Pay now created</text>
      <text x="126" y="151" fontSize="8.5" fill={FAINT}>ama · 1d ago</text>
      <circle cx="100" cy="180" r="6" fill={TASKS} />
      <text x="126" y="178" fontSize="10" fill={INK}>uml · flow "place order" edited</text>
      <text x="126" y="191" fontSize="8.5" fill={FAINT}>kwame · 2d ago</text>
      {/* diff card */}
      <rect x="400" y="40" width="320" height="150" rx="8" fill={BOX} stroke={BORDER} />
      <text x="416" y="64" fontSize="11.5" fill={INK}>POST /orders</text>
      <rect x="648" y="50" width="56" height="16" rx="4" fill="rgba(74,157,107,0.15)" />
      <text x="676" y="62" textAnchor="middle" fontSize="9" fill="#3f7f52">+3 −1</text>
      <path d="M400 76 H720" stroke="rgba(28,26,21,0.1)" />
      <text x="418" y="95" fontSize="10" fill={GREEN}>+</text>
      <rect x="432" y="88" width="230" height="7" rx="3" fill="rgba(74,157,107,0.35)" />
      <text x="418" y="109" fontSize="10" fill={GREEN}>+</text>
      <rect x="432" y="102" width="190" height="7" rx="3" fill="rgba(74,157,107,0.35)" />
      <text x="418" y="123" fontSize="10" fill="#bf4636">−</text>
      <rect x="432" y="116" width="160" height="7" rx="3" fill="rgba(191,70,54,0.3)" />
      <text x="418" y="137" fontSize="10" fill={GREEN}>+</text>
      <rect x="432" y="130" width="210" height="7" rx="3" fill="rgba(74,157,107,0.35)" />
      <rect x="416" y="150" width="150" height="24" rx="4" fill="color-mix(in srgb, var(--accent) 12%, transparent)" />
      <text x="428" y="166" fontSize="9.5" fill="var(--accent)">⚠ breaking change</text>
    </svg>
  );
}

function VscodeFigure() {
  const label = "The VS Code extension: the command palette filtered to Forward commands, an @adc anchor comment in the source, and the signed-in status bar";
  return (
    <svg viewBox="0 0 760 340" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      {/* editor window */}
      <rect x="8" y="8" width="744" height="324" rx="10" fill="#201d18" stroke="rgba(0,0,0,0.3)" />
      <circle cx="30" cy="26" r="4.5" fill="#8f8778" opacity="0.5" />
      <circle cx="46" cy="26" r="4.5" fill="#8f8778" opacity="0.5" />
      <circle cx="62" cy="26" r="4.5" fill="#8f8778" opacity="0.5" />
      <text x="380" y="30" textAnchor="middle" fontSize="10" fill="#8f8778">checkout.ts — forward-shop</text>
      {/* activity bar + explorer */}
      <path d="M52 42 V310" stroke="rgba(230,221,203,0.12)" />
      {[58, 86, 114, 142].map((y) => (
        <rect key={y} x="21" y={y} width="18" height="18" rx="4" fill="none" stroke="#8f8778" opacity="0.55" />
      ))}
      {/* code */}
      <rect x="66" y="59" width="118" height="18" rx="4" fill="color-mix(in srgb, var(--accent) 22%, transparent)" />
      <text x="72" y="72" fontSize="11.5" fill="#d98a5f">{"// @adc el_7f3a"}</text>
      <text x="72" y="98" fontSize="11.5" fill="#e6ddcb">
        {"router.post("}
        <tspan fill="#d98a5f">"/api/checkout"</tspan>
        {", async (req, res) => {"}
      </text>
      <text x="88" y="122" fontSize="11.5" fill="#e6ddcb">{"const order = await createOrder(req.body);"}</text>
      <text x="88" y="146" fontSize="11.5" fill="#e6ddcb">
        {"res.status("}
        <tspan fill="#d98a5f">201</tspan>
        {").json(order);"}
      </text>
      <text x="72" y="170" fontSize="11.5" fill="#e6ddcb">{"});"}</text>
      {/* command palette */}
      <rect x="200" y="186" width="420" height="112" rx="8" fill="#2c2822" stroke="rgba(230,221,203,0.18)" />
      <rect x="212" y="198" width="396" height="24" rx="5" fill="#201d18" stroke="rgba(230,221,203,0.14)" />
      <text x="222" y="214" fontSize="11" fill="#e6ddcb">&gt; forward</text>
      <rect x="212" y="228" width="396" height="20" rx="4" fill="color-mix(in srgb, var(--accent) 26%, transparent)" />
      <text x="222" y="242" fontSize="10.5" fill="#f1ece1">Forward: Document API on Design Element</text>
      <text x="222" y="264" fontSize="10.5" fill="#b5ac9b">Forward: Catch Up on Endpoint Changes</text>
      <text x="222" y="284" fontSize="10.5" fill="#b5ac9b">Forward: Create Task</text>
      {/* status bar */}
      <path d="M8 310 H752" stroke="rgba(230,221,203,0.12)" />
      <circle cx="28" cy="321" r="3" fill={GREEN} />
      <text x="38" y="325" fontSize="9.5" fill="#b5ac9b">Forward · project_shop · signed in (fwd_pat_…)</text>
      <text x="732" y="325" textAnchor="end" fontSize="9.5" fill="#8f8778">TypeScript</text>
    </svg>
  );
}

function McpFigure() {
  const label = "The MCP surface: an AI agent calls the forward-mcp server's scoped tools; the server forwards them to the Forward API with a fwd_pat token";
  return (
    <svg viewBox="0 0 760 300" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <marker id="m-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill={EDGE} />
        </marker>
        <marker id="m-arrS" markerWidth="8" markerHeight="8" refX="1" refY="3" orient="auto-start-reverse">
          <path d="M0 0 L6 3 L0 6 Z" fill={EDGE} />
        </marker>
      </defs>
      {/* agent */}
      <rect x="40" y="40" width="170" height="52" rx="8" fill={BOX} stroke={BORDER} />
      <text x="125" y="62" textAnchor="middle" fontSize="12" fill={INK}>AI agent</text>
      <text x="125" y="78" textAnchor="middle" fontSize="9.5" fill={FAINT}>Claude Code · any MCP client</text>
      {/* mcp server */}
      <rect x="290" y="30" width="200" height="102" rx="8" fill={BOX} stroke="var(--accent)" strokeWidth="1.6" />
      <text x="390" y="52" textAnchor="middle" fontSize="12" fill={INK}>forward-mcp</text>
      <text x="390" y="68" textAnchor="middle" fontSize="9.5" fill="var(--accent)">37 scoped tools</text>
      <text x="306" y="90" fontSize="8.5" fill={FAINT}>FORWARD_API_BASE_URL</text>
      <text x="306" y="104" fontSize="8.5" fill={FAINT}>FORWARD_PROJECT_ID</text>
      <text x="306" y="118" fontSize="8.5" fill={FAINT}>FORWARD_API_TOKEN=fwd_pat_…</text>
      {/* forward server */}
      <rect x="570" y="40" width="150" height="52" rx="8" fill={BOX} stroke={INK} strokeWidth="1.5" />
      <text x="645" y="62" textAnchor="middle" fontSize="12" fill={INK}>Forward server</text>
      <text x="645" y="78" textAnchor="middle" fontSize="9.5" fill={FAINT}>resolves PAT → owner</text>
      {/* links */}
      <path d="M210 66 H286" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#m-arrS)" markerEnd="url(#m-arr)" />
      <text x="248" y="56" textAnchor="middle" fontSize="9" fill={FAINT}>tool calls</text>
      <path d="M490 66 H566" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#m-arrS)" markerEnd="url(#m-arr)" />
      <text x="528" y="56" textAnchor="middle" fontSize="9" fill={FAINT}>Bearer PAT</text>
      {/* tool-call trace */}
      <rect x="40" y="160" width="680" height="116" rx="8" fill="#201d18" stroke="rgba(0,0,0,0.3)" />
      <text x="58" y="184" fontSize="10.5" fill="#8f8778"># the agent documents what it just built</text>
      <text x="58" y="206" fontSize="10.5" fill="#e6ddcb">
        {"find_element("}
        <tspan fill="#d98a5f">"pay now button"</tspan>
        {")"}
        <tspan fill="#8f8778">{"  → el_7f3a (fuzzy match)"}</tspan>
      </text>
      <text x="58" y="228" fontSize="10.5" fill="#e6ddcb">
        {"write_documentation(el_7f3a, "}
        <tspan fill="#d98a5f">"POST /api/checkout"</tspan>
        {", …)"}
      </text>
      <text x="58" y="250" fontSize="10.5" fill="#e6ddcb">
        {"update_task(FWD-12, "}
        <tspan fill="#d98a5f">"done"</tspan>
        {")"}
        <tspan fill="#8f8778">{"  → synced to canvas + VS Code"}</tspan>
      </text>
    </svg>
  );
}

function SyncFigure() {
  const label = "Three surfaces — the web canvas, VS Code and an AI agent — all read and write through the central Forward server, which broadcasts realtime changes to project members";
  return (
    <svg viewBox="0 0 760 210" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <marker id="s-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill={EDGE} />
        </marker>
        <marker id="s-arrS" markerWidth="8" markerHeight="8" refX="1" refY="3" orient="auto-start-reverse">
          <path d="M0 0 L6 3 L0 6 Z" fill={EDGE} />
        </marker>
      </defs>
      <rect x="60" y="28" width="180" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="150" y="47" textAnchor="middle" fontSize="12" fill={INK}>web canvas</text>
      <text x="150" y="62" textAnchor="middle" fontSize="9.5" fill={FAINT}>dashboard · Clerk session</text>
      <rect x="290" y="28" width="180" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="380" y="47" textAnchor="middle" fontSize="12" fill={INK}>VS Code</text>
      <text x="380" y="62" textAnchor="middle" fontSize="9.5" fill={FAINT}>extension · fwd_pat token</text>
      <rect x="520" y="28" width="180" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="610" y="47" textAnchor="middle" fontSize="12" fill={INK}>AI agent</text>
      <text x="610" y="62" textAnchor="middle" fontSize="9.5" fill={FAINT}>MCP · 37 tools</text>
      <path d="M150 72 C170 105 240 122 292 130" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#s-arrS)" markerEnd="url(#s-arr)" />
      <path d="M380 72 V126" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#s-arrS)" markerEnd="url(#s-arr)" />
      <path d="M610 72 C590 105 520 122 468 130" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#s-arrS)" markerEnd="url(#s-arr)" />
      <rect x="230" y="130" width="300" height="48" rx="8" fill={BOX} stroke={INK} strokeWidth="1.5" />
      <text x="380" y="151" textAnchor="middle" fontSize="12.5" fill={INK}>Forward server</text>
      <text x="380" y="167" textAnchor="middle" fontSize="9.5" fill={FAINT}>auth · roles · timestamps · one source of truth</text>
      <text x="380" y="200" textAnchor="middle" fontSize="10" fill={FAINT}>realtime channel · broadcast to project members only</text>
    </svg>
  );
}

/** Anchor-target section with a kicker, heading and optional subheading. */
function Section({
  id,
  kicker,
  title,
  sub,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="d-section">
      <p className="d-kicker">{kicker}</p>
      <h2>{title}</h2>
      {sub && <p className="d-section-sub">{sub}</p>}
      {children}
    </section>
  );
}
