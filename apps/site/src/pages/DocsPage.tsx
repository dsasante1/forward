import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackToTop } from "../components/BackToTop.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { DEMO_PATH, GITHUB_URL, MARKETPLACE_URL, NPM_URL } from "../site.js";
import "../docs.css";

/**
 * Public documentation at `/docs/`, a sibling of the landing page. Single long
 * page with anchor sections; a sticky sidebar drives navigation and an
 * IntersectionObserver highlights the active section.
 *
 * Same mono & lime editorial aesthetic as the landing page (docs.css mirrors the
 * landing tokens). Content tracks the git-native product: the `.forward/`
 * directory, the `forward` CLI, the MCP tools and the seven data layers (see
 * the repository README and CLAUDE.md).
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
      { id: "from-code", label: "Designs from code" },
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
    group: "Git & workflow",
    items: [
      { id: "access", label: "Access & sync" },
      { id: "workflow", label: "GitHub Action & CI" },
    ],
  },
  {
    group: "Reference",
    items: [{ id: "reference", label: "CLI & settings" }],
  },
];

const ALL_IDS = NAV.flatMap((g) => g.items.map((i) => i.id));

export function DocsPage() {
  const [active, setActive] = useState<string>(ALL_IDS[0] ?? "");
  const menu = useRef<HTMLDetailsElement>(null);

  // The section menu is rendered open (browsers hide a closed <details>' body
  // whatever the CSS says, and wide screens have no toggle to reopen it). It
  // collapses on narrow screens and reopens whenever the window widens.
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 820px)");
    const sync = () => {
      if (menu.current) menu.current.open = !narrow.matches;
    };
    sync();
    narrow.addEventListener("change", sync);
    return () => narrow.removeEventListener("change", sync);
  }, []);

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
          <a href="/" className="d-brand">
            <span className="d-brand-mark" aria-hidden />
            <span className="d-brand-name">FORWARD</span>
            <span className="d-brand-tag">Docs</span>
          </a>
          <div className="d-nav-right">
            <a href="/" className="d-nav-link d-nav-hide">
              Home
            </a>
            <a className="d-nav-link d-nav-hide" href="#getting-started">
              Getting started
            </a>
            <a className="d-nav-link d-nav-hide" href={GITHUB_URL}>
              GitHub
            </a>
            <ThemeToggle />
            <a href={DEMO_PATH} className="d-btn">
              Live demo <span className="ff-mark" aria-hidden />
            </a>
          </div>
        </nav>
      </div>

      <div className="d-shell">
        {/* ---------- left sidebar ---------- */}
        <aside className="d-side" aria-label="Documentation sections">
          <details className="d-nav-collapse" open ref={menu}>
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
              data models and project work together as plain JSON in{" "}
              <code className="d-code">.forward/</code>, inside your own git
              repository. You author it from the canvas, VS Code, or an AI agent.
              This guide walks through every layer and every surface.
            </p>
          </header>

          {/* ===== GETTING STARTED ===== */}
          <Section
            id="getting-started"
            kicker="Start here"
            title="Getting started"
            sub="Set Forward up in an existing repository, open the canvas, commit the project, and connect your editor and agents."
          >
            <ol className="d-steps">
              <li>
                <strong>Install the CLI.</strong> Forward needs Node 22 or newer.
                Install it globally with{" "}
                <code className="d-code">npm i -g forward-mcp</code>, which adds
                two commands to your PATH:{" "}
                <code className="d-code">forward-mcp</code> (the MCP server) and{" "}
                <code className="d-code">forward</code> (the CLI). Or skip the
                install and prefix each command with{" "}
                <code className="d-code">npx -y -p forward-mcp</code>.
              </li>
              <li>
                <strong>Initialize your repository.</strong> In the repository
                root, run <code className="d-code">forward init</code>. It creates{" "}
                <code className="d-code">.forward/</code>, the agent wiring (
                <code className="d-code">AGENTS.md</code>,{" "}
                <code className="d-code">CLAUDE.md</code>,{" "}
                <code className="d-code">.mcp.json</code>,{" "}
                <code className="d-code">.cursor/mcp.json</code>) and the GitHub
                workflow. <code className="d-code">--no-agents</code> and{" "}
                <code className="d-code">--no-github</code> skip those.
              </li>
              <li>
                <strong>Open the canvas.</strong> Run{" "}
                <code className="d-code">forward serve</code>. It serves the
                design editor at{" "}
                <code className="d-code">http://127.0.0.1:4747</code> (add{" "}
                <code className="d-code">--open</code> to launch your browser) and
                writes every edit straight to <code className="d-code">.forward/</code>.
              </li>
              <li>
                <strong>Commit the project.</strong> Add{" "}
                <code className="d-code">.forward/</code> and the generated files
                and commit them with your code. From here on, Forward changes
                travel through branches and pull requests like any other change.
              </li>
              <li>
                <strong>Connect an agent.</strong> Claude Code and Cursor pick up
                the generated configs; for others see{" "}
                <a href="#agents">AI agents</a>. Restart the agent session after
                adding the server.
              </li>
              <li>
                <strong>Install the VS Code extension.</strong> Get{" "}
                <a href={MARKETPLACE_URL}>Forward on the VS Code Marketplace</a>;
                it finds <code className="d-code">.forward/</code> in the
                open repository on its own (see <a href="#vscode">VS Code extension</a>).
              </li>
            </ol>
            <pre className="d-pre">
              <code>
                <span className="c"># in the root of your repository (Node 22+)</span>
                {"\n"}npm i -g forward-mcp
                {"\n"}forward init
                {"\n"}forward serve <span className="c"># http://127.0.0.1:4747</span>
                {"\n"}git add .forward/ AGENTS.md CLAUDE.md .mcp.json .cursor/ .github/
                {"\n"}git commit -m <span className="t">"Add Forward"</span>
              </code>
            </pre>
            <div className="d-note accent">
              <span>
                <b>Just looking?</b> The <a href={DEMO_PATH}>live demo</a> opens the
                canvas on a sample project in your browser, with nothing to
                install.
              </span>
            </div>

            <h3>What lands in your repository</h3>
            <p>
              The whole project is one directory, one file per record, so merges
              stay clean and pull-request diffs stay readable:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Holds</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>forward.json</td><td>The project manifest: id, name, format version.</td></tr>
                  <tr><td>design/&lt;id&gt;.json</td><td>Design elements, each with its optional <code className="d-code">apiBinding</code> docs.</td></tr>
                  <tr><td>history/&lt;elementId&gt;/…</td><td>Append-only API-doc history, one file per version.</td></tr>
                  <tr><td>infra/nodes, infra/edges, infra/flows</td><td>The infrastructure graph and narrated flows.</td></tr>
                  <tr><td>data/entities, data/relations</td><td>The ER data model.</td></tr>
                  <tr><td>agents/agents, agents/servers</td><td>Agents and the MCP servers they call.</td></tr>
                  <tr><td>tasks/&lt;id&gt;.json</td><td>The task tracker.</td></tr>
                  <tr><td>checkpoints/&lt;id&gt;.json</td><td>Named, restorable snapshots of design and infra.</td></tr>
                  <tr><td>dismissed/&lt;id&gt;.json</td><td>Code drafts someone deleted, so capture doesn't recreate them.</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              The project id is the <code className="d-code">id</code> in{" "}
              <code className="d-code">.forward/forward.json</code>. Every tool
              finds the project by looking for the nearest{" "}
              <code className="d-code">.forward/</code> above the current
              directory (or the repository named by{" "}
              <code className="d-code">FORWARD_REPO</code>).
            </p>
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
              obvious: every feature is one of them, and every surface (canvas,
              VS Code, agent, CI) speaks the same shapes, validated by the same
              schemas on every read and write.
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
                      designer draws, with geometry and a parent/child hierarchy.
                      The primary artifact; everything else hangs off it.
                    </td>
                  </tr>
                  <tr>
                    <td>API binding</td>
                    <td>
                      An optional title + Markdown description attached to a
                      design element. Docs-first and framework-agnostic; an
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
                      to an endpoint. Serializes to a Mermaid sequence diagram.
                    </td>
                  </tr>
                  <tr>
                    <td>Entities (ER)</td>
                    <td>
                      A project-wide data model of tables, fields and crow's-foot
                      relations. Serializes to a Mermaid <code className="d-code">erDiagram</code>.
                    </td>
                  </tr>
                  <tr>
                    <td>Tasks</td>
                    <td>
                      A tracker of work items that can each link into another
                      layer: an element, a flow or an endpoint.
                    </td>
                  </tr>
                  <tr>
                    <td>Checkpoints</td>
                    <td>
                      Named, restorable snapshots of the whole canvas (design +
                      infra), each with a note and per-layer change counts.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Links between layers are <strong>soft references</strong>, resolved
              on read and never enforced as foreign keys.{" "}
              <code className="d-code">forward validate</code> reports dangling
              ones as warnings.
            </p>
            <p>
              A related, project-scoped <strong>Agents layer</strong> lets you{" "}
              <em>document</em> the MCP servers and AI agents your project builds
              or consumes (see <a href="#agents">AI agents</a>), modelled the same
              way as the seven above.
            </p>
            <p>
              On top of the layers sit the <strong>timelines</strong>: a
              per-element history of documentation changes and a project event
              feed built from <code className="d-code">git log</code>. Together
              they power the History view, doc diffs and the catch-up digest (see{" "}
              <a href="#history">History &amp; checkpoints</a>).
            </p>
          </Section>

          {/* ===== CANVAS ===== */}
          <Section
            id="canvas"
            kicker="Design layer"
            title="The design canvas"
            sub="A design editor for the interface. Draw it, then let every other layer attach to what you drew."
          >
            <p>
              The canvas is where the design layer lives and where the API, infra,
              data and task overlays render on top of it. Run it with{" "}
              <code className="d-code">forward serve</code>, open it inside VS
              Code with <strong>Forward: Open Design Canvas</strong>, or browse the
              read-only copy your GitHub Pages site publishes.
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
                    <td>A container / screen; establishes hierarchy, nest anything inside it.</td>
                  </tr>
                  <tr>
                    <td>rectangle</td>
                    <td>A generic box: buttons, cards, inputs.</td>
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
                    <td>z</td>
                    <td>Stacking order among siblings: higher paints on top.</td>
                  </tr>
                  <tr>
                    <td>rotation</td>
                    <td>Degrees clockwise about the element's center (default 0).</td>
                  </tr>
                  <tr>
                    <td>parentId</td>
                    <td>The containing element, or <code className="d-code">null</code> at the top level; this is the layer tree.</td>
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
                    <td>origin</td>
                    <td>Set on drafts generated from frontend code (see <a href="#from-code">Designs from code</a>); gone once a draft is adopted.</td>
                  </tr>
                  <tr>
                    <td>updatedAt</td>
                    <td>ISO-8601 timestamp of the last write, stamped by Forward rather than the client.</td>
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
              The left rail doesn't hold drawing tools; shapes come from the
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
                  <tr><td>Flows</td><td>The narrated flows as sequence diagrams (Mermaid), one per flow.</td></tr>
                  <tr><td>Agents</td><td>The agent / MCP-server wiring diagram.</td></tr>
                  <tr><td>History</td><td>The project timeline panel (see <a href="#history">History</a>).</td></tr>
                  <tr><td>Tasks</td><td>The task-tracker panel.</td></tr>
                  <tr><td>Theme</td><td>The view-theme editor: per-user, stored locally, never committed.</td></tr>
                  <tr><td>Member</td><td>The read-only list of git contributors (see <a href="#access">Access &amp; sync</a>).</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              A zoom bar (−&nbsp;/&nbsp;+&nbsp;/&nbsp;<strong>Fit</strong>) sits
              over the stage, and a <strong>live-sync</strong> indicator shows the
              connection to the local server. Changes an agent writes through MCP
              while the canvas is open show up within a couple of seconds.
              Right-click anywhere on the canvas for the <strong>Add element</strong>{" "}
              menu: the same catalog the keyboard shortcuts arm, nested at the
              point you clicked.
            </p>

            <h3>Drawing &amp; keyboard shortcuts</h3>
            <p>
              Select is the default mode. Press a tool key, then drag on the
              canvas to size the new element (single-key shortcuts; they're
              ignored while you're typing in a field):
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
                  <tr><td>⌘S / Ctrl+S</td><td>Save a checkpoint (opens the save modal; see <a href="#history">Checkpoints</a>).</td></tr>
                  <tr><td>Delete / Backspace</td><td>Delete the selected element.</td></tr>
                  <tr><td>Escape</td><td>Deselect / close the open dialog.</td></tr>
                </tbody>
              </table>
            </div>
            <div className="d-note">
              <span>
                Diagrams (infra, flows, ER) render with Mermaid inside the same
                view, and the GitHub Pages export renders the very same canvas,
                read-only.
              </span>
            </div>
          </Section>

          {/* ===== API DOCS ===== */}
          <Section
            id="api-docs"
            kicker="API binding layer"
            title="API documentation"
            sub="Attach framework-agnostic Markdown docs to any design element, so an endpoint stays tied to the interface it powers and the docs can't drift away from the UI."
          >
            <p>
              An <strong>API binding</strong> is just a{" "}
              <code className="d-code">title</code> and a Markdown{" "}
              <code className="d-code">description</code>. Most elements never get
              one; the ones that do become the anchor for backend documentation.
              You can author bindings from the canvas, but the intended home is
              the <a href="#vscode">VS Code extension</a> and the{" "}
              <a href="#agents">MCP server</a>, where the backend actually lives.
            </p>
            <Figure caption="fig 3 — a binding: two fields on an element. The Markdown body carries the meaning; every edit becomes a diff.">
              <BindingFigure />
            </Figure>
            <h3>The binding shape</h3>
            <p>A binding is deliberately tiny, two fields:</p>
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
                    <td>The full Markdown body: request/response shape, status codes, notes. Anything the reader needs.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              That's it. There's no enforced HTTP method or path: you can write{" "}
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
                route scanner to keep happy.
              </li>
              <li>
                <strong>Tied to the UI.</strong> The doc is attached to the
                element it describes, so it's discoverable from the design.
              </li>
              <li>
                <strong>Versioned.</strong> Every edit is appended to the
                element's history as its own file, with a reviewable, git-style
                diff (see <a href="#history">History</a>). Two branches that both
                document endpoints merge without conflicts.
              </li>
            </ul>
            <p>
              Who wrote each version is decided by Forward, not the client: your
              git <code className="d-code">user.name</code> (or{" "}
              <code className="d-code">FORWARD_AUTHOR</code>), plus{" "}
              <code className="d-code">via &lt;agent&gt;</code> when{" "}
              <code className="d-code">FORWARD_AGENT</code> is set.
            </p>
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
                  <tr><td>external</td><td>Third-party dependency.</td></tr>
                  <tr><td>actor</td><td>A person (user, admin) who starts a journey; not a system component.</td></tr>
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
              infra node to another ("place order", "register", "checkout") and
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
              A step can also carry an optional{" "}
              <code className="d-code">condition</code>, a branch guard like
              "session valid" or "409 duplicate". Consecutive steps that share one
              condition render together as a Mermaid{" "}
              <code className="d-code">alt</code>/<code className="d-code">else</code>{" "}
              block, so a flow can show conditional paths, not just a straight
              line.
            </p>
            <p>
              Flows render as numbered arrows across the graph and serialize to a
              Mermaid <code className="d-code">sequenceDiagram</code> you can drop
              straight into a design doc. Agents get both diagrams as Mermaid from{" "}
              <code className="d-code">list_infra</code> and{" "}
              <code className="d-code">list_flows</code>.
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
            sub="Entity-relationship diagrams with tables, fields and crow's-foot cardinality, versioned with the rest of the project."
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
              style: solid when the child can't exist without the parent, dashed
              otherwise. The whole model serializes to a Mermaid{" "}
              <code className="d-code">erDiagram</code>, easy to review in a pull
              request, version alongside code, and keep next to the API docs and
              architecture it supports.
            </p>
          </Section>

          {/* ===== TASKS ===== */}
          <Section
            id="tasks"
            kicker="Task layer"
            title="Task management"
            sub="Track the work next to the system it belongs to. Every task can link to a design element, a flow or an endpoint, for traceability from planning to implementation."
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
                  <tr><td>assignees, reporter</td><td>The people doing the work, and who filed it.</td></tr>
                  <tr><td>dueDate</td><td>An ISO date or a short label like "Jun 24".</td></tr>
                  <tr><td>dependsOn</td><td>Ids of tasks that should finish before this one starts (finish-to-start).</td></tr>
                  <tr><td>elementId</td><td>Optional link to the design element the task concerns.</td></tr>
                  <tr><td>flowId</td><td>Optional link to the narrated flow it implements.</td></tr>
                  <tr><td>endpointId</td><td>Optional link to the element whose apiBinding defines the endpoint.</td></tr>
                  <tr><td>activity</td><td>Chronological feed of comments and events (oldest first).</td></tr>
                  <tr><td>createdAt, updatedAt</td><td>Timestamps stamped by Forward.</td></tr>
                </tbody>
              </table>
            </div>
            <div className="d-note">
              <span>
                All three layer links are independent and optional, and they're{" "}
                <b>soft references</b>: a task may briefly point at a deleted
                element, and Forward tolerates that rather than blocking you.{" "}
                <code className="d-code">forward validate</code> flags it as a
                warning.
              </span>
            </div>

            <h3>Views</h3>
            <p>
              Work the list in the canvas's Tasks panel. Because tasks link into
              the other layers, you always
              know which design, flow or endpoint a piece of work maps to. Agents
              use <code className="d-code">create_task</code>,{" "}
              <code className="d-code">update_task</code> and{" "}
              <code className="d-code">comment_task</code> on the same tracker.
            </p>
          </Section>

          {/* ===== HISTORY ===== */}
          <Section
            id="history"
            kicker="Timelines & snapshots"
            title="History & checkpoints"
            sub="The project remembers everything: every documentation edit is a reviewable diff, the activity feed is your git log, and you can snapshot and restore the whole canvas."
          >
            <h3>The History timeline</h3>
            <p>
              Two timelines drive it: an append-only, per-element history of API
              documentation (one file per version under{" "}
              <code className="d-code">.forward/history/</code>), and a project
              event feed built from <code className="d-code">git log</code> plus
              your uncommitted changes, so commit messages show up in it. Forward
              flattens them into one chronological stream, lays it out as a
              git-graph, and colours each event by the layer it came from:
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
                  <tr><td>flow</td><td>Narrated flow changes.</td></tr>
                  <tr><td>agent</td><td>Agent / MCP-server changes.</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Each event records its action (
              <code className="d-code">created</code>,{" "}
              <code className="d-code">modified</code> or{" "}
              <code className="d-code">deleted</code>) plus the author, timestamp
              and a one-line detail, so you can see who changed what, when, across
              every layer.
            </p>
            <Figure caption="fig 6 — the History git-graph, coloured by layer, beside a doc diff with a breaking-change flag.">
              <HistoryFigure />
            </Figure>

            <h3>Doc diffs</h3>
            <p>
              Each edit to an API binding is a <strong>git-style diff</strong>: a
              title change plus a line-level Markdown diff between two versions.
              Expand any revision to review exactly what moved: added rows are
              green, removed rows red, and a <code className="d-code">+a −r</code>{" "}
              badge summarizes the change on the collapsed card. A diff can also be
              flagged <strong>breaking</strong>, which surfaces a warning callout
              so consumers know clients may need changes. Even a{" "}
              <em>deleted</em> endpoint stays labelled, because each history entry
              keeps a snapshot of the endpoint as it was written.
            </p>

            <h3>Catch-up digest</h3>
            <p>
              Pick a baseline (the last day, week, month, or all time) and Forward
              collapses the event stream into a digest of what's{" "}
              <em>to integrate</em>, <em>to modify</em> and <em>to remove</em>: the
              fast way for a frontend dev to catch up on backend changes. The
              canvas timeline and <code className="d-code">get_catchup_digest</code>{" "}
              show the same digest.
            </p>
            <p>
              To compare against a git ref instead, run{" "}
              <code className="d-code">forward diff origin/main</code> (any branch,
              tag or commit). It lists new, changed and removed endpoints with doc
              diffs, plus a per-layer summary of everything else, as Markdown or
              JSON. Agents call the same comparison as{" "}
              <code className="d-code">get_changes_since_ref</code>, and the{" "}
              <a href="#workflow">GitHub Action</a> posts it on every pull request.
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
              change counts (e.g. <span className="d-pill" style={{ background: "color-mix(in srgb, var(--ink) 6%, transparent)", color: "var(--soft)" }}>DESIGN +8</span>{" "}
              <span className="d-pill" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}>API +3</span>).
              Checkpoints are files too (<code className="d-code">.forward/checkpoints/</code>),
              so they're committed and shared like everything else.
            </p>
            <div className="d-note">
              <span>
                A restore rewinds the design + infra graph only. Your per-user view
                settings (theme, grid) aren't touched, and git still holds every
                earlier state if you need to go further back.
              </span>
            </div>
          </Section>

          {/* ===== DESIGNS FROM CODE ===== */}
          <Section
            id="from-code"
            kicker="Design layer · from code"
            title="Designs from code"
            sub="Ideally the frontend is built from the design. When a screen was built first, Forward can draw it for you from the running app."
          >
            <p>
              <code className="d-code">forward capture</code> renders your running
              frontend, reads back what the browser actually painted (position,
              size, colours, borders, corners, fonts, text, stacking) and turns it
              into canvas elements: one frame per route, a box for everything that
              paints, text for every run of text. Wrappers that paint nothing are
              dropped, so the layer tree stays readable. React dev builds also
              report which component rendered each node, so repeated components
              become a component plus instances.
            </p>
            <pre className="d-pre">
              <code>
                forward capture --browsers <span className="c"># which browsers it can use here</span>
                {"\n"}forward capture http://localhost:5173 / /login /settings --dry-run
                {"\n"}forward capture http://localhost:5173 / /login /settings
                {"\n"}forward capture http://localhost:5173 /settings --auth state.json --viewport 390x844
                {"\n"}forward capture http://localhost:5173 / --browser edge
              </code>
            </pre>

            <h3>Which browser it uses</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>Engine</th><th>When</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>The project's Playwright</td>
                    <td>Used first when the project has Playwright installed.</td>
                  </tr>
                  <tr>
                    <td>An installed Chromium browser</td>
                    <td>
                      Chrome, Edge, Brave, Chromium, Vivaldi or Opera. Nothing is
                      installed or downloaded. It runs headless with a fresh,
                      temporary profile (never your own cookies, logins or
                      extensions), is controlled over a pipe so nothing listens on
                      the network, and is closed with its profile deleted when the
                      capture ends.
                    </td>
                  </tr>
                  <tr>
                    <td>The forward-capture companion</td>
                    <td>
                      Only when there is no Playwright and no Chromium browser (a
                      server, a container, some CI). It runs{" "}
                      <code className="d-code">npx -y forward-capture@&lt;version&gt;</code>{" "}
                      at the CLI's exact version and downloads Playwright's
                      headless Chromium once (about 100 MB);{" "}
                      <code className="d-code">npx -y forward-capture install</code>{" "}
                      fetches it ahead of time.
                    </td>
                  </tr>
                  <tr>
                    <td>Any browser, by hand</td>
                    <td>
                      Firefox and Safari can't be driven this way.{" "}
                      <code className="d-code">forward capture --script</code>{" "}
                      prints a snippet to paste into the DevTools console; it
                      downloads <code className="d-code">forward-snapshot.json</code>,
                      which <code className="d-code">forward capture --from forward-snapshot.json</code>{" "}
                      imports.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <code className="d-code">--browser</code> picks one explicitly (a
              name or a path), <code className="d-code">FORWARD_BROWSER</code> sets
              the default, and <code className="d-code">FORWARD_NO_DOWNLOAD=1</code>{" "}
              forbids both downloads. Agents call the same capture as{" "}
              <code className="d-code">import_design_from_code</code>.
            </p>

            <h3>Drafts, and what a re-capture never does</h3>
            <ul>
              <li>
                <strong>Drafts.</strong> Generated elements are marked{" "}
                <em>from code</em> on the canvas. Re-running a capture updates them
                in place, and API docs attached to a draft are kept.
              </li>
              <li>
                <strong>Stable identity.</strong> An element keeps its identity by
                its <code className="d-code">data-testid</code>,{" "}
                <code className="d-code">id</code>, the JSX line that rendered it
                (React dev builds) or its <code className="d-code">aria-label</code>;
                failing those, by its position under the nearest element that has
                one. When the page around a draft shifts, drafts are re-matched by
                type, name or text, size and contents, as long as the match is
                unambiguous.
              </li>
              <li>
                <strong>Docs never move on a guess.</strong> If a documented draft
                can't be matched for certain, it stays where it was (stale, docs
                intact) and the capture reports it. Test ids on repeated or
                generic elements make identity certain.
              </li>
              <li>
                <strong>Edits win.</strong> A draft someone has moved, restyled or
                renamed is never overwritten; the import reports it as a conflict.{" "}
                <strong>Adopt draft</strong> (inspector or right-click menu) turns a
                draft into an ordinary element that imports never touch again.
              </li>
              <li>
                <strong>Deletions stick.</strong> Deleting a draft remembers it in{" "}
                <code className="d-code">.forward/dismissed/</code>, so the next
                capture doesn't bring it back;{" "}
                <code className="d-code">--restore</code> does.
              </li>
              <li>
                <strong>Stale drafts.</strong> Drafts the code no longer renders
                are reported as stale. <code className="d-code">--prune</code>{" "}
                removes them, but never one that is documented, edited, adopted, or
                holds something that stays.
              </li>
              <li>
                <strong>Anchors, opt-in.</strong>{" "}
                <code className="d-code">--anchors</code> adds{" "}
                <code className="d-code">{"// @adc <id>"}</code> markers above each
                component's declaration in your JS/TS source, so{" "}
                <code className="d-code">resolve_anchors</code> links code to
                design. It edits source files, so it is off by default.
              </li>
            </ul>
            <div className="d-note accent">
              <span>
                <b>Use development data.</b> A capture records what the page
                shows, so run it against development or seed data, not real
                customer data. Password fields are always masked.{" "}
                <code className="d-code">--auth state.json</code> loads a saved
                browser state for pages behind a login.
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
                <strong>Install the extension.</strong> Get{" "}
                <a href={MARKETPLACE_URL}>Forward from the VS Code Marketplace</a>{" "}
                and open your repository.
              </li>
              <li>
                <strong>Initialize, if needed.</strong> If the repository has no{" "}
                <code className="d-code">.forward/</code> yet, run{" "}
                <strong>Forward: Initialize Project in This Repository</strong>, or{" "}
                <code className="d-code">forward init</code> in a terminal (which
                also writes agent configs and the GitHub workflow).
              </li>
              <li>
                <strong>Document.</strong> Use the Forward commands to document an
                endpoint on an element, edit infra, flows and agents, and file or
                update tasks, all from the editor.{" "}
                <strong>Insert Anchor at Cursor</strong> drops an{" "}
                <code className="d-code">@adc</code> comment (pick the element by
                name) so the code↔element link lives in the source: the same
                anchor CI and MCP agents resolve.
              </li>
            </ol>
            <Figure caption="fig 7 — Forward in VS Code: the command palette filtered to Forward commands, a deterministic @adc anchor in the source, and the status bar.">
              <VscodeFigure />
            </Figure>
            <div className="d-note accent">
              <span>
                <b>Nothing to configure.</b> The extension works on the open
                repository's <code className="d-code">.forward/</code> in-process.
                There is no server URL or project picker, and access is whatever
                your git host grants.
              </span>
            </div>
            <p>
              Everything you write is a file change in{" "}
              <code className="d-code">.forward/</code>. Commit it with the code it
              describes, and the canvas, your teammates and any agent read the
              same files. <strong>Open Design Canvas</strong> shows the design with
              your API docs and diagrams overlaid, right inside VS Code, and its
              Timeline opens the endpoint git-graph and catch-up digest.
            </p>
          </Section>

          {/* ===== AGENTS / MCP ===== */}
          <Section
            id="agents"
            kicker="Surface · AI agents"
            title="AI agents (MCP server)"
            sub="Give any AI assistant full parity with the canvas and the extension: 39 tools over the same .forward/ files, over MCP or from the shell."
          >
            <p>
              The <code className="d-code">forward-mcp</code> server exposes 39
              tools so an agent can create and maintain every artifact
              (documentation, architecture, data models, tasks, even the design)
              exactly as a human contributor does. It runs over stdio from the
              repository root and finds the nearest{" "}
              <code className="d-code">.forward/</code>; there is nothing else to
              configure. The full list is in the <a href="#reference">reference</a>.
            </p>
            <h3>Connect it</h3>
            <p>
              <code className="d-code">forward init</code> (or{" "}
              <code className="d-code">forward agents</code> later) writes the
              wiring into your repository:
            </p>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>File</th><th>For</th></tr>
                </thead>
                <tbody>
                  <tr><td>AGENTS.md</td><td>Instructions every agent reads: when and how to document endpoints, infra and schema.</td></tr>
                  <tr><td>CLAUDE.md</td><td>Imports AGENTS.md for Claude Code.</td></tr>
                  <tr><td>.mcp.json</td><td>Registers the Forward MCP server for Claude Code.</td></tr>
                  <tr><td>.cursor/mcp.json</td><td>Registers it for Cursor.</td></tr>
                  <tr><td>.vscode/mcp.json</td><td>Registers it for VS Code / Copilot (<code className="d-code">forward agents --vscode</code>).</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              To register by hand with Claude Code, run this from the repository
              root (the extension's <strong>Forward: Set Up MCP for AI Agents</strong>{" "}
              copies the same line):
            </p>
            <pre className="d-pre">
              <code>claude mcp add forward -- npx -y forward-mcp</code>
            </pre>
            <p>
              Codex reads <code className="d-code">AGENTS.md</code>; register the
              server in <code className="d-code">~/.codex/config.toml</code>:
            </p>
            <pre className="d-pre">
              <code>
                [mcp_servers.forward]
                {"\n"}command = <span className="t">"npx"</span>
                {"\n"}args = [<span className="t">"-y"</span>, <span className="t">"forward-mcp"</span>]
                {"\n"}env = {"{"} FORWARD_AGENT = <span className="t">"codex"</span> {"}"}
              </code>
            </pre>
            <p>
              Any other MCP client runs <code className="d-code">npx -y forward-mcp</code>{" "}
              over stdio. Set <code className="d-code">FORWARD_REPO</code> only
              when the client doesn't start the server inside the repository, and{" "}
              <code className="d-code">FORWARD_AGENT</code> to tag writes with the
              agent's name.
            </p>
            <div className="d-note">
              <span>
                <b>After registering, restart your agent session.</b> A session
                that was already running won't load the Forward tools until it
                reconnects. That's MCP-client behaviour, not a Forward setting.
              </span>
            </div>

            <h3>Without MCP: the same tools from the shell</h3>
            <p>
              The CLI calls the very same tool code in-process, so a script or an
              agent without MCP gets identical behaviour:
            </p>
            <pre className="d-pre">
              <code>
                forward tools <span className="c"># list all 39 tools</span>
                {"\n"}forward tools write_documentation <span className="c"># one tool's arguments</span>
                {"\n"}forward call write_infra_node <span className="t">'{"{"}"kind":"cache","label":"Redis"{"}"}'</span>
                {"\n"}forward call get_changes_since_ref <span className="t">'{"{"}"ref":"origin/main"{"}"}'</span>
              </code>
            </pre>
            <p>
              Any tool also runs as a command of its own, with its arguments as
              flags; <code className="d-code">forward tools &lt;tool&gt;</code>{" "}
              lists them.
            </p>

            <h3>Finding the right element</h3>
            <p>
              Good first calls are <code className="d-code">project_info</code>,{" "}
              <code className="d-code">find_element</code>,{" "}
              <code className="d-code">write_documentation</code>,{" "}
              <code className="d-code">validate_project</code> and{" "}
              <code className="d-code">get_changes_since_ref</code>. There are two
              ways to answer "which design element does this code belong to?":
            </p>
            <ul>
              <li>
                <strong>Fuzzy: <code className="d-code">find_element</code>.</strong>{" "}
                Ranks elements against a feature description. No setup, but
                confirm with the user when the score is low or two candidates are
                close.
              </li>
              <li>
                <strong>Deterministic: <code className="d-code">resolve_anchors</code>.</strong>{" "}
                Resolves <code className="d-code">@adc &lt;elementId&gt;</code>{" "}
                markers in your source to their elements, and flags anchors whose
                id doesn't exist, catching typos and stale links.
              </li>
            </ul>
            <Figure caption="fig 8 — an agent working through forward-mcp: fuzzy element resolution, then documenting and closing out the task it implemented.">
              <McpFigure />
            </Figure>

            <h3>Document the agents your project uses</h3>
            <p>
              Beyond <em>connecting</em> an agent, Forward has an Agents layer for{" "}
              <em>documenting</em> the AI surface your project builds or consumes,
              its own project-scoped graph like infrastructure. You can model:
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
              An agent's system prompt versions and diffs in the History timeline
              like an API binding, so your agent definitions get the same
              reviewable history as the rest of the project.
            </p>
          </Section>

          {/* ===== ACCESS & SYNC ===== */}
          <Section
            id="access"
            kicker="Git-native"
            title="Access & sync"
            sub="There is no central server and no database. Git is the sync, the history and the access control."
          >
            <p>
              Every surface speaks one REST contract. Forward serves it from the
              files in <code className="d-code">.forward/</code>: in-process for
              the MCP server, CLI, VS Code extension and CI, and over a small local
              HTTP server that <code className="d-code">forward serve</code> runs
              for the canvas.
            </p>
            <Figure caption="fig 9 — every surface reads and writes the same .forward/ files; git carries them to the rest of the team.">
              <SyncFigure />
            </Figure>

            <h3>Who can change the project</h3>
            <ul>
              <li>
                <strong>Push access is edit access.</strong> Whoever can push to
                the repository can change the project, and branch protection and
                required reviews apply to <code className="d-code">.forward/</code>{" "}
                like any other path.
              </li>
              <li>
                <strong>The roster comes from git.</strong> The canvas's Member
                view and <code className="d-code">list_members</code> list
                everyone who has committed to <code className="d-code">.forward/</code>.
                It is read-only: there is nothing to add or remove.
              </li>
              <li>
                <strong>Authorship is stamped, not claimed.</strong> An author a
                client sends is ignored. Your git{" "}
                <code className="d-code">user.name</code> decides who wrote it (
                <code className="d-code">FORWARD_AUTHOR</code> overrides, and{" "}
                <code className="d-code">FORWARD_AGENT</code> appends{" "}
                <code className="d-code">via &lt;agent&gt;</code>).
              </li>
            </ul>

            <h3>How changes travel</h3>
            <p>
              Edits land as file changes in your working tree. Everyone on the
              same checkout (you on the canvas, an agent over MCP, the VS Code
              extension) sees them straight away; everyone else gets them through
              commits, pull requests and merges, exactly like code. One file per
              record and separate history files keep those merges clean, and{" "}
              <code className="d-code">git checkout -- .forward/</code> is the undo.
            </p>

            <h3>The local canvas server</h3>
            <p>
              <code className="d-code">forward serve</code> keeps no user list,
              so it defends itself instead:
            </p>
            <ul>
              <li>It binds to loopback (<code className="d-code">127.0.0.1</code>) by default.</li>
              <li>
                Every API call must carry a random per-session key that only the
                served page knows, so another site can't drive it.
              </li>
              <li>
                It rejects unexpected <code className="d-code">Host</code> headers,
                which defeats DNS rebinding.
              </li>
            </ul>
            <div className="d-note">
              <span>
                <code className="d-code">--host 0.0.0.0</code> (or{" "}
                <code className="d-code">::</code>) exposes the canvas on your
                network and turns off the Host check. Anyone who can reach the port
                can open the page and edit the project, and so can any website you
                visit while it runs (DNS rebinding). Keep the default unless you
                need it, and stop the server when you're done.
              </span>
            </div>
          </Section>

          {/* ===== GITHUB & CI ===== */}
          <Section
            id="workflow"
            kicker="Fit it to your process"
            title="GitHub Action & CI"
            sub="Validate the project on every pull request, post a catch-up digest for reviewers, publish a read-only canvas to GitHub Pages, and optionally let your own AI write the docs."
          >
            <h3>The Forward workflow</h3>
            <p>
              <code className="d-code">forward init</code> (or{" "}
              <code className="d-code">forward github</code> later) writes{" "}
              <code className="d-code">.github/workflows/forward.yml</code>, which
              uses Forward's composite action:
            </p>
            <ul>
              <li>
                <strong>On pull requests</strong> it runs{" "}
                <code className="d-code">forward validate</code>, annotating schema
                errors inline, then posts one comment, updated on every push,
                listing new, changed and removed endpoints with doc diffs and a
                per-layer summary of everything else.
              </li>
              <li>
                <strong>On the default branch</strong> it builds a static,
                read-only canvas with <code className="d-code">forward export</code>{" "}
                and deploys it to GitHub Pages. Turn Pages on with{" "}
                <em>Source: GitHub Actions</em>.
              </li>
            </ul>
            <h3>Action inputs</h3>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr><th>Input</th><th>Meaning</th></tr>
                </thead>
                <tbody>
                  <tr><td>path</td><td>Repository root that contains .forward/ (defaults to the checked-out repository).</td></tr>
                  <tr><td>validate</td><td>Run <code className="d-code">forward validate</code> and fail on schema errors (default true).</td></tr>
                  <tr><td>strict</td><td>Also fail on warnings, i.e. dangling cross-layer links (default false).</td></tr>
                  <tr><td>comment</td><td>On pull requests, post or update one comment with the catch-up digest (default true).</td></tr>
                  <tr><td>base</td><td>Git ref to diff against; defaults to the pull request's base commit.</td></tr>
                  <tr><td>export</td><td>Directory to write the static canvas into, for GitHub Pages; empty skips it.</td></tr>
                  <tr><td>cli-version</td><td>forward-mcp version to run from npm; empty builds the CLI from the action's own source.</td></tr>
                  <tr><td>github-token</td><td>Used to post the PR comment (defaults to the workflow's token).</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              The digest's Markdown path is exposed as the{" "}
              <code className="d-code">digest</code> output and also written to the
              job summary, so fork pull requests (which get a read-only token)
              still see it.
            </p>

            <h3>Let your own AI write the docs</h3>
            <p>
              The bring-your-own-AI pipeline, <strong>forward-docs</strong>, keeps
              API docs, ER, infrastructure, flows and agents in sync with the code
              on every pull request, without locking you into any particular AI:
            </p>
            <ol className="d-steps">
              <li>
                <strong>Your AI writes a plan.</strong> Any provider reads the
                diff plus the <code className="d-code">FORWARD_DOCS.md</code>{" "}
                instructions and writes <code className="d-code">forward-docs.json</code>.
                It never edits <code className="d-code">.forward/</code> itself.
              </li>
              <li>
                <strong>
                  <code className="d-code">forward-docs apply</code> writes it.
                </strong>{" "}
                Deterministic, no AI: it fills in geometry and timestamps,
                re-validates every object against the schema, and writes nothing if
                the plan is malformed. Re-runs update in place via{" "}
                <code className="d-code">@adc</code> anchors and stable ids.
              </li>
              <li>
                <strong>The result is committed back to the PR.</strong> Reviewed
                and merged with the code; git is the undo.
              </li>
            </ol>
            <pre className="d-pre">
              <code>
                <span className="c"># .github/workflows/forward-docs.yml (from the template)</span>
                {"\n"}- uses: dsasante1/forward/apps/docs-ci@docs-ci-v2
                {"\n"}  <span className="c"># inputs: commit, commit-message (see the template)</span>
              </code>
            </pre>
            <p>
              The template runs on pull requests from the same repository; your
              AI step needs your provider's key as a repository secret. A pull
              request's diff is untrusted input, so give the agent the narrowest
              tools that work (file read/write rather than a shell). An agent that
              has the Forward MCP server connected can skip the JSON plan and edit
              through its tools instead.
            </p>

            <div className="d-note accent">
              <span>
                <b>Tip:</b> tie a checkpoint to each release. It's a restorable
                snapshot of the whole canvas, and with{" "}
                <code className="d-code">forward diff &lt;release-tag&gt;</code>{" "}
                the release tag itself becomes a natural "since last release"
                baseline.
              </span>
            </div>
          </Section>

          {/* ===== REFERENCE ===== */}
          <Section
            id="reference"
            kicker="Reference"
            title="CLI & settings"
            sub="Quick lookup for the CLI commands, environment variables, VS Code commands and the MCP tools."
          >
            <h3>CLI commands</h3>
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
                    <td>{"forward init "}</td>
                    <td>Create .forward/ here, plus agent configs and the GitHub workflow. Flags: <code className="d-code">--name</code>, <code className="d-code">--id</code>, <code className="d-code">--no-agents</code>, <code className="d-code">--no-github</code>.</td>
                  </tr>
                  <tr>
                    <td>{"forward serve "}</td>
                    <td>Open the canvas editor on .forward/. Flags: <code className="d-code">--port 4747</code>, <code className="d-code">--host 127.0.0.1</code>, <code className="d-code">--open</code>.</td>
                  </tr>
                  <tr>
                    <td>{"forward validate "}</td>
                    <td>Check every file (CI runs this); exits 1 on errors. Flags: <code className="d-code">--format text|json|github</code>, <code className="d-code">--strict</code>.</td>
                  </tr>
                  <tr>
                    <td>forward diff &lt;git-ref&gt;</td>
                    <td>What changed since a ref: the catch-up digest for a PR. Flags: <code className="d-code">--format markdown|json</code>, <code className="d-code">--out &lt;file&gt;</code>.</td>
                  </tr>
                  <tr>
                    <td>{"forward export "}</td>
                    <td>Build a read-only static site for GitHub Pages. Flags: <code className="d-code">--out _site</code>, <code className="d-code">--no-history</code>.</td>
                  </tr>
                  <tr>
                    <td>forward capture &lt;url&gt; [route …]</td>
                    <td>Generate design drafts from a running frontend. Flags: <code className="d-code">--browser</code>, <code className="d-code">--viewport 1440x900</code>, <code className="d-code">--auth state.json</code>, <code className="d-code">--prune</code>, <code className="d-code">--restore</code>, <code className="d-code">--anchors</code>, <code className="d-code">--no-components</code>, <code className="d-code">--dry-run</code>.</td>
                  </tr>
                  <tr>
                    <td>forward capture --browsers</td>
                    <td>List the browsers live capture can use on this device.</td>
                  </tr>
                  <tr>
                    <td>forward capture --script</td>
                    <td>Print a DevTools snippet that captures the page in any browser (<code className="d-code">--route /path</code>).</td>
                  </tr>
                  <tr>
                    <td>forward capture --from &lt;snapshot.json&gt;</td>
                    <td>Import snapshots saved by that snippet (with <code className="d-code">--prune</code>, <code className="d-code">--restore</code>, <code className="d-code">--anchors</code>, <code className="d-code">--dry-run</code>).</td>
                  </tr>
                  <tr>
                    <td>{"forward agents "}</td>
                    <td>Write AGENTS.md / CLAUDE.md and MCP configs (all by default). Flags: <code className="d-code">--claude</code>, <code className="d-code">--cursor</code>, <code className="d-code">--vscode</code>, <code className="d-code">--agents-md</code>.</td>
                  </tr>
                  <tr>
                    <td>{"forward github "}</td>
                    <td>Write .github/workflows/forward.yml.</td>
                  </tr>
                  <tr>
                    <td>{"forward mcp "}</td>
                    <td>Serve the agent tools over MCP stdio (same as forward-mcp).</td>
                  </tr>
                  <tr>
                    <td>forward tools [&lt;tool&gt;]</td>
                    <td>List the agent tools, or one tool's arguments (<code className="d-code">--json</code>).</td>
                  </tr>
                  <tr>
                    <td>forward call &lt;tool&gt; ['&lt;json&gt;' | -]</td>
                    <td>Run an agent tool from the shell (same code as MCP). Each tool also runs directly as a command, with its arguments as flags.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>Environment variables</h3>
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
                    <td>FORWARD_REPO</td>
                    <td>Use this repository instead of searching up from the working directory.</td>
                  </tr>
                  <tr>
                    <td>FORWARD_AUTHOR</td>
                    <td>Name stamped on writes (default: git <code className="d-code">user.name</code>, then your OS login name).</td>
                  </tr>
                  <tr>
                    <td>FORWARD_AGENT</td>
                    <td>Agent name added to the author, e.g. <code className="d-code">Ada via claude</code>.</td>
                  </tr>
                  <tr>
                    <td>FORWARD_BROWSER</td>
                    <td>Default browser for live capture: a name (chrome, edge, brave, chromium, vivaldi, opera) or a path.</td>
                  </tr>
                  <tr>
                    <td>FORWARD_NO_DOWNLOAD</td>
                    <td>Set to <code className="d-code">1</code> to forbid fetching the forward-capture companion and Playwright's Chromium.</td>
                  </tr>
                  <tr>
                    <td>FORWARD_CAPTURE_BIN</td>
                    <td>Path to a specific forward-capture companion to run, e.g. for air-gapped setups.</td>
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
                  <tr><td>forward.initRepo</td><td>Initialize a Forward project in this repository.</td></tr>
                  <tr><td>forward.setupMcp</td><td>Copy the <code className="d-code">claude mcp add …</code> line that connects an AI agent.</td></tr>
                  <tr><td>forward.openCanvas</td><td>Open the design canvas.</td></tr>
                  <tr><td>forward.connectEndpoint</td><td>Document an API on a design element.</td></tr>
                  <tr><td>forward.insertAnchor</td><td>Insert an <code className="d-code">@adc</code> anchor at the cursor; pick an element by name, no id to transcribe.</td></tr>
                  <tr><td>forward.removeDocumentation</td><td>Remove API documentation from an element.</td></tr>
                  <tr><td>forward.showHistory</td><td>Show an endpoint's documentation history.</td></tr>
                  <tr><td>forward.catchUp</td><td>Catch up on endpoint changes since a baseline.</td></tr>
                  <tr><td>forward.addInfraNode</td><td>Add an infrastructure node.</td></tr>
                  <tr><td>forward.linkInfraNodes</td><td>Link two infrastructure nodes with an edge.</td></tr>
                  <tr><td>forward.removeInfraNode</td><td>Remove an infrastructure node.</td></tr>
                  <tr><td>forward.addFlow</td><td>Add a narrated flow (sequence diagram).</td></tr>
                  <tr><td>forward.addFlowStep</td><td>Add a step to a flow.</td></tr>
                  <tr><td>forward.removeFlow</td><td>Remove a flow.</td></tr>
                  <tr><td>forward.addMcpServer</td><td>Add an MCP server to the Agents layer.</td></tr>
                  <tr><td>forward.removeMcpServer</td><td>Remove an MCP server.</td></tr>
                  <tr><td>forward.addAgent</td><td>Add an agent to the Agents layer.</td></tr>
                  <tr><td>forward.removeAgent</td><td>Remove an agent.</td></tr>
                  <tr><td>forward.createTask</td><td>Create a task.</td></tr>
                  <tr><td>forward.updateTaskStatus</td><td>Update a task's status.</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              The one setting, <code className="d-code">forward.openCanvasOnStartup</code>,
              opens the design canvas when VS Code starts (only in a folder
              with a <code className="d-code">.forward/</code> project).
            </p>

            <h3>MCP tools</h3>
            <p>
              The 39 tools the Forward MCP server exposes to an agent, by area.{" "}
              <code className="d-code">forward tools &lt;tool&gt;</code> shows any
              one's arguments.
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
                    <td>{"Project "}</td>
                    <td>
                      <code className="d-code">project_info</code>{" "}
                      <code className="d-code">validate_project</code>{" "}
                      <code className="d-code">get_changes_since_ref</code>{" "}
                      <code className="d-code">list_members</code>
                    </td>
                  </tr>
                  <tr>
                    <td>{"Design "}</td>
                    <td>
                      <code className="d-code">list_design_elements</code>{" "}
                      <code className="d-code">find_element</code>{" "}
                      <code className="d-code">resolve_anchors</code>{" "}
                      <code className="d-code">create_element</code>{" "}
                      <code className="d-code">update_element</code>{" "}
                      <code className="d-code">delete_element</code>{" "}
                      <code className="d-code">import_design_from_code</code>
                    </td>
                  </tr>
                  <tr>
                    <td>{"API docs "}</td>
                    <td>
                      <code className="d-code">get_documentation</code>{" "}
                      <code className="d-code">write_documentation</code>{" "}
                      <code className="d-code">remove_documentation</code>{" "}
                      <code className="d-code">get_history</code>{" "}
                      <code className="d-code">get_catchup_digest</code>
                    </td>
                  </tr>
                  <tr>
                    <td>{"Infrastructure "}</td>
                    <td>
                      <code className="d-code">list_infra</code>{" "}
                      <code className="d-code">write_infra_node</code>{" "}
                      <code className="d-code">connect_infra</code>{" "}
                      <code className="d-code">remove_infra_node</code>
                    </td>
                  </tr>
                  <tr>
                    <td>{"Flows "}</td>
                    <td>
                      <code className="d-code">list_flows</code>{" "}
                      <code className="d-code">write_flow</code>{" "}
                      <code className="d-code">add_flow_step</code>{" "}
                      <code className="d-code">remove_flow</code>
                    </td>
                  </tr>
                  <tr>
                    <td>{"Data models "}</td>
                    <td>
                      <code className="d-code">list_entities</code>{" "}
                      <code className="d-code">write_entity</code>{" "}
                      <code className="d-code">relate_entities</code>{" "}
                      <code className="d-code">remove_entity</code>
                    </td>
                  </tr>
                  <tr>
                    <td>{"Agents layer "}</td>
                    <td>
                      <code className="d-code">list_agents</code>{" "}
                      <code className="d-code">write_mcp_server</code>{" "}
                      <code className="d-code">write_agent</code>{" "}
                      <code className="d-code">remove_mcp_server</code>{" "}
                      <code className="d-code">remove_agent</code>
                    </td>
                  </tr>
                  <tr>
                    <td>{"Tasks "}</td>
                    <td>
                      <code className="d-code">list_tasks</code>{" "}
                      <code className="d-code">get_task</code>{" "}
                      <code className="d-code">create_task</code>{" "}
                      <code className="d-code">update_task</code>{" "}
                      <code className="d-code">comment_task</code>{" "}
                      <code className="d-code">delete_task</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="d-note accent" style={{ marginTop: 28 }}>
              <span>
                <b>Ready to start?</b> Run{" "}
                <code className="d-code">npx -y -p forward-mcp forward init</code>{" "}
                in your repository root, or explore the{" "}
                <a href={DEMO_PATH}>live demo</a> first. The source is on{" "}
                <a href={GITHUB_URL}>GitHub</a> under the Apache 2.0 license.
              </span>
            </div>
          </Section>
        </main>

        {/* ---------- right rail: resources ---------- */}
        <aside className="d-toc" aria-label="Resources">
          <p className="d-toc-h">Resources</p>
          <a href="/">
            <span className="ff-mark ff-mark--back" aria-hidden /> Back to home
          </a>
          <a href="#getting-started">Getting started</a>
          <a href="#from-code">Designs from code</a>
          <a href="#agents">AI agents (MCP)</a>
          <a href="#workflow">GitHub Action &amp; CI</a>
          <a href={DEMO_PATH}>
            Live demo <span className="ff-mark" aria-hidden />
          </a>
          <a href={GITHUB_URL}>GitHub</a>
          <a href={NPM_URL}>forward-mcp on npm</a>
          <a href={MARKETPLACE_URL}>VS Code Marketplace</a>
        </aside>
      </div>

      {/* ---------- footer ---------- */}
      <footer className="d-footer">
        <div className="d-footer-inner">
          <div className="d-footer-line" />
          <div className="d-footer-row">
            <a href="/" className="d-footer-brand">
              <span className="d-footer-mark" aria-hidden />
              <span className="d-footer-nm">FORWARD</span>
            </a>
            <nav className="d-footer-links" aria-label="Footer">
              <a href="#getting-started">Getting started</a>
              <a href="#concepts">Core concepts</a>
              <a href="#vscode">VS Code extension</a>
              <a href="#agents">AI agents</a>
              <a href="#reference">Reference</a>
              <a href={GITHUB_URL}>GitHub</a>
              <a href="/">Home</a>
            </nav>
            <span className="d-footer-copy">Apache-2.0 · Forward</span>
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
  children: ReactNode;
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
 * page's InfraGraph: JetBrains Mono labels, --panel-bright boxes on the
 * rail, and the per-layer colours from docs.css. Colours are docs.css tokens so
 * the figures follow the light/dark theme; the terminal and VS Code panels are
 * dark in both.
 */
const FONT = "'JetBrains Mono', ui-monospace, monospace";
const INK = "var(--ink)";
const FAINT = "var(--faint)";
const EDGE = "var(--edge)";
const BOX = "var(--panel-bright)";
const BORDER = "var(--swatch)";
const DESIGN = "var(--layer-design)";
const INFRA = "var(--layer-infra)";
const TASKS = "var(--layer-tasks)";
const GREEN = "var(--fig-ok)";

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
      <rect x="64" y="234" width="92" height="24" rx="5" fill="var(--design-tint)" stroke={DESIGN} />
      <text x="110" y="250" textAnchor="middle" fontSize="10.5" fill={INK}>Pay now</text>
      <ellipse cx="260" cy="238" rx="26" ry="18" fill="none" stroke={BORDER} />
      {/* api binding — attaches */}
      <rect x="76" y="44" width="210" height="70" rx="8" fill={BOX} stroke="var(--accent)" strokeWidth="1.6" />
      <text x="92" y="66" fontSize="12" fill={INK}>POST /api/checkout</text>
      <rect x="92" y="76" width="150" height="5" rx="2.5" fill="color-mix(in srgb, var(--ink) 12%, transparent)" />
      <rect x="92" y="87" width="110" height="5" rx="2.5" fill="color-mix(in srgb, var(--ink) 12%, transparent)" />
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
      <path d="M8 40 H752" stroke="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <text x="24" y="30" fontSize="11" fill={FAINT}>forward / canvas</text>
      <circle cx="200" cy="26" r="3" fill={GREEN} />
      <text x="210" y="30" fontSize="9" fill={GREEN} letterSpacing="0.08em">LIVE SYNC</text>
      <rect x="600" y="15" width="138" height="20" rx="4" fill="var(--rail)" stroke="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <text x="669" y="29" textAnchor="middle" fontSize="10" fill={FAINT}>−  100%  +  Fit</text>
      {/* toolbar rail */}
      <path d="M44 40 V332" stroke="color-mix(in srgb, var(--ink) 10%, transparent)" />
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
      <path d="M180 40 V332" stroke="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <text x="56" y="62" fontSize="9" fill={FAINT} letterSpacing="0.14em">LAYERS</text>
      <text x="56" y="86" fontSize="10.5" fill={INK}>▾ Checkout</text>
      <text x="66" y="108" fontSize="10.5" fill="var(--muted)">frame</text>
      <text x="76" y="130" fontSize="10.5" fill="var(--muted)">Pay now</text>
      <circle cx="138" cy="126" r="3" fill="var(--accent)" />
      <text x="76" y="152" fontSize="10.5" fill={FAINT}>total-label</text>
      {/* canvas area: frame with nested elements */}
      <text x="220" y="72" fontSize="10" fill={FAINT}>Checkout</text>
      <rect x="220" y="80" width="240" height="180" rx="6" fill="var(--panel)" stroke={BORDER} />
      <rect x="240" y="104" width="120" height="8" rx="4" fill="color-mix(in srgb, var(--ink) 18%, transparent)" />
      <rect x="240" y="130" width="200" height="26" rx="5" fill={BOX} stroke={BORDER} />
      <rect x="240" y="172" width="110" height="30" rx="6" fill="var(--design-tint)" stroke={DESIGN} strokeWidth="1.6" />
      <text x="295" y="191" textAnchor="middle" fontSize="11" fill={INK}>Pay now</text>
      {[[237, 169], [347, 169], [237, 199], [347, 199]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" fill={BOX} stroke={DESIGN} />
      ))}
      <rect x="358" y="180" width="30" height="14" rx="7" fill="var(--accent)" />
      <text x="373" y="190" textAnchor="middle" fontSize="8" fill="var(--on-accent)" letterSpacing="0.06em">API</text>
      {/* api drawer */}
      <path d="M600 40 V332" stroke="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <text x="614" y="62" fontSize="9" fill={FAINT} letterSpacing="0.14em">API DRAWER</text>
      <text x="614" y="86" fontSize="10.5" fill="var(--accent)">POST /api/checkout</text>
      <rect x="614" y="98" width="118" height="5" rx="2.5" fill="color-mix(in srgb, var(--ink) 12%, transparent)" />
      <rect x="614" y="110" width="96" height="5" rx="2.5" fill="color-mix(in srgb, var(--ink) 12%, transparent)" />
      <rect x="614" y="122" width="108" height="5" rx="2.5" fill="color-mix(in srgb, var(--ink) 12%, transparent)" />
      <text x="614" y="158" fontSize="9" fill={FAINT}>history · v4</text>
      <rect x="614" y="168" width="52" height="15" rx="4" fill="color-mix(in srgb, var(--fig-ok) 15%, transparent)" />
      <text x="640" y="179" textAnchor="middle" fontSize="9" fill="var(--fig-ok-text)">+3 −1</text>
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
      <rect x="48" y="64" width="140" height="42" rx="8" fill="var(--design-tint)" stroke={DESIGN} strokeWidth="1.6" />
      <text x="118" y="90" textAnchor="middle" fontSize="12.5" fill={INK}>Pay now</text>
      <text x="48" y="130" fontSize="10" fill={FAINT}>design element</text>
      <path d="M188 85 H296" fill="none" stroke="var(--accent)" strokeWidth="1.6" markerEnd="url(#b-arrA)" />
      <text x="244" y="76" textAnchor="middle" fontSize="10" fill="var(--accent)">apiBinding</text>
      <rect x="300" y="28" width="400" height="126" rx="10" fill={BOX} stroke={BORDER} />
      <text x="318" y="50" fontSize="13" fill={INK}>POST /api/checkout</text>
      <rect x="650" y="36" width="34" height="16" rx="4" fill="color-mix(in srgb, var(--accent) 14%, transparent)" />
      <text x="667" y="48" textAnchor="middle" fontSize="9.5" fill="var(--accent)">v4</text>
      <path d="M300 62 H700" stroke="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <rect x="318" y="76" width="330" height="6" rx="3" fill="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <rect x="318" y="90" width="280" height="6" rx="3" fill="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <rect x="318" y="104" width="300" height="6" rx="3" fill="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <rect x="318" y="118" width="200" height="22" rx="4" fill="#161616" />
      <text x="328" y="132" fontSize="9" fill="var(--band-accent)">{"{ amount, currency }"}</text>
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
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--muted)" />
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
      <path d="M170 54 H296" fill="none" stroke="var(--muted)" strokeWidth="1.5" markerEnd="url(#w-arr)" />
      <circle cx="233" cy="54" r="9" fill="var(--accent)" />
      <text x="233" y="58" textAnchor="middle" fontSize="10" fill="var(--on-accent)">1</text>
      <path d="M440 62 H576" fill="none" stroke="var(--muted)" strokeWidth="1.5" markerEnd="url(#w-arr)" />
      <circle cx="508" cy="62" r="9" fill="var(--accent)" />
      <text x="508" y="66" textAnchor="middle" fontSize="10" fill="var(--on-accent)">2</text>
      <text x="508" y="86" textAnchor="middle" fontSize="9" fill="var(--accent)">ties to POST /orders</text>
      <path d="M380 84 C400 140 480 172 576 172" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#w-arr)" />
      <circle cx="466" cy="146" r="9" fill="var(--accent)" />
      <text x="466" y="150" textAnchor="middle" fontSize="10" fill="var(--on-accent)">3</text>
      <path d="M300 76 H174" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="2 3" markerEnd="url(#w-arr)" />
      <circle cx="233" cy="76" r="9" fill={FAINT} />
      <text x="233" y="80" textAnchor="middle" fontSize="10" fill="#fff">4</text>
      {/* legend */}
      <path d="M40 224 H80" stroke="var(--muted)" strokeWidth="1.5" />
      <text x="88" y="228" fontSize="10" fill={FAINT}>sync</text>
      <path d="M150 224 H190" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x="198" y="228" fontSize="10" fill={FAINT}>async</text>
      <path d="M270 224 H310" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="2 3" />
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
      <rect x="60" y="36" width="240" height="26" fill="color-mix(in srgb, var(--layer-design) 12%, transparent)" stroke={BORDER} />
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
      <rect x="460" y="36" width="240" height="26" fill="color-mix(in srgb, var(--layer-design) 12%, transparent)" stroke={BORDER} />
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
      <text x="126" y="178" fontSize="10" fill={INK}>flow · flow "place order" edited</text>
      <text x="126" y="191" fontSize="8.5" fill={FAINT}>kwame · 2d ago</text>
      {/* diff card */}
      <rect x="400" y="40" width="320" height="150" rx="8" fill={BOX} stroke={BORDER} />
      <text x="416" y="64" fontSize="11.5" fill={INK}>POST /orders</text>
      <rect x="648" y="50" width="56" height="16" rx="4" fill="color-mix(in srgb, var(--fig-ok) 15%, transparent)" />
      <text x="676" y="62" textAnchor="middle" fontSize="9" fill="var(--fig-ok-text)">+3 −1</text>
      <path d="M400 76 H720" stroke="color-mix(in srgb, var(--ink) 10%, transparent)" />
      <text x="418" y="95" fontSize="10" fill={GREEN}>+</text>
      <rect x="432" y="88" width="230" height="7" rx="3" fill="color-mix(in srgb, var(--fig-ok) 35%, transparent)" />
      <text x="418" y="109" fontSize="10" fill={GREEN}>+</text>
      <rect x="432" y="102" width="190" height="7" rx="3" fill="color-mix(in srgb, var(--fig-ok) 35%, transparent)" />
      <text x="418" y="123" fontSize="10" fill="var(--fig-bad)">−</text>
      <rect x="432" y="116" width="160" height="7" rx="3" fill="color-mix(in srgb, var(--fig-bad) 30%, transparent)" />
      <text x="418" y="137" fontSize="10" fill={GREEN}>+</text>
      <rect x="432" y="130" width="210" height="7" rx="3" fill="color-mix(in srgb, var(--fig-ok) 35%, transparent)" />
      <rect x="416" y="150" width="150" height="24" rx="4" fill="color-mix(in srgb, var(--accent) 12%, transparent)" />
      <text x="428" y="166" fontSize="9.5" fill="var(--accent)">⚠ breaking change</text>
    </svg>
  );
}

function VscodeFigure() {
  const label = "The VS Code extension: the command palette filtered to Forward commands, an @adc anchor comment in the source, and the status bar showing the repository's project";
  return (
    <svg viewBox="0 0 760 340" fontFamily={FONT} role="img" aria-label={label}>
      <title>{label}</title>
      {/* editor window */}
      <rect x="8" y="8" width="744" height="324" rx="10" fill="#161616" stroke="rgba(0,0,0,0.3)" />
      <circle cx="30" cy="26" r="4.5" fill="#8a8a85" opacity="0.5" />
      <circle cx="46" cy="26" r="4.5" fill="#8a8a85" opacity="0.5" />
      <circle cx="62" cy="26" r="4.5" fill="#8a8a85" opacity="0.5" />
      <text x="380" y="30" textAnchor="middle" fontSize="10" fill="#8a8a85">checkout.ts — forward-shop</text>
      {/* activity bar + explorer */}
      <path d="M52 42 V310" stroke="rgba(230,230,225,0.12)" />
      {[58, 86, 114, 142].map((y) => (
        <rect key={y} x="21" y={y} width="18" height="18" rx="4" fill="none" stroke="#8a8a85" opacity="0.55" />
      ))}
      {/* code */}
      <rect x="66" y="59" width="118" height="18" rx="4" fill="color-mix(in srgb, var(--accent) 22%, transparent)" />
      <text x="72" y="72" fontSize="11.5" fill="var(--band-accent)">{"// @adc el_7f3a"}</text>
      <text x="72" y="98" fontSize="11.5" fill="#e6e6e1">
        {"router.post("}
        <tspan fill="var(--band-accent)">"/api/checkout"</tspan>
        {", async (req, res) => {"}
      </text>
      <text x="88" y="122" fontSize="11.5" fill="#e6e6e1">{"const order = await createOrder(req.body);"}</text>
      <text x="88" y="146" fontSize="11.5" fill="#e6e6e1">
        {"res.status("}
        <tspan fill="var(--band-accent)">201</tspan>
        {").json(order);"}
      </text>
      <text x="72" y="170" fontSize="11.5" fill="#e6e6e1">{"});"}</text>
      {/* command palette */}
      <rect x="200" y="186" width="420" height="112" rx="8" fill="#222222" stroke="rgba(230,230,225,0.18)" />
      <rect x="212" y="198" width="396" height="24" rx="5" fill="#161616" stroke="rgba(230,230,225,0.14)" />
      <text x="222" y="214" fontSize="11" fill="#e6e6e1">&gt; forward</text>
      <rect x="212" y="228" width="396" height="20" rx="4" fill="color-mix(in srgb, var(--accent) 26%, transparent)" />
      <text x="222" y="242" fontSize="10.5" fill="#f0f0ec">Forward: Document API on Design Element</text>
      <text x="222" y="264" fontSize="10.5" fill="#b0b0aa">Forward: Catch Up on Endpoint Changes</text>
      <text x="222" y="284" fontSize="10.5" fill="#b0b0aa">Forward: Create Task</text>
      {/* status bar */}
      <path d="M8 310 H752" stroke="rgba(230,230,225,0.12)" />
      <circle cx="28" cy="321" r="3" fill={GREEN} />
      <text x="38" y="325" fontSize="9.5" fill="#b0b0aa">Forward · shop · .forward/</text>
      <text x="732" y="325" textAnchor="end" fontSize="9.5" fill="#8a8a85">TypeScript</text>
    </svg>
  );
}

function McpFigure() {
  const label = "The MCP surface: an AI agent calls the forward-mcp server's tools over stdio; the server reads and writes the .forward/ files in the repository";
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
      <text x="390" y="68" textAnchor="middle" fontSize="9.5" fill="var(--accent)">39 tools · stdio</text>
      <text x="306" y="96" fontSize="8.5" fill={FAINT}>FORWARD_AGENT=claude</text>
      <text x="306" y="110" fontSize="8.5" fill={FAINT}>FORWARD_REPO (optional)</text>
      {/* repository */}
      <rect x="570" y="40" width="150" height="52" rx="8" fill={BOX} stroke={INK} strokeWidth="1.5" />
      <text x="645" y="62" textAnchor="middle" fontSize="12" fill={INK}>.forward/</text>
      <text x="645" y="78" textAnchor="middle" fontSize="9.5" fill={FAINT}>files in your repo</text>
      {/* links */}
      <path d="M210 66 H286" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#m-arrS)" markerEnd="url(#m-arr)" />
      <text x="248" y="56" textAnchor="middle" fontSize="9" fill={FAINT}>tool calls</text>
      <path d="M490 66 H566" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#m-arrS)" markerEnd="url(#m-arr)" />
      <text x="528" y="56" textAnchor="middle" fontSize="9" fill={FAINT}>read / write</text>
      {/* tool-call trace */}
      <rect x="40" y="160" width="680" height="116" rx="8" fill="#161616" stroke="rgba(0,0,0,0.3)" />
      <text x="58" y="184" fontSize="10.5" fill="#8a8a85">{"# the agent documents what it just built "}</text>
      <text x="58" y="206" fontSize="10.5" fill="#e6e6e1">
        {"find_element("}
        <tspan fill="var(--band-accent)">"pay now button"</tspan>
        {")"}
        <tspan fill="#8a8a85">{"  → el_7f3a (fuzzy match)"}</tspan>
      </text>
      <text x="58" y="228" fontSize="10.5" fill="#e6e6e1">
        {"write_documentation(el_7f3a, "}
        <tspan fill="var(--band-accent)">"POST /api/checkout"</tspan>
        {", …)"}
      </text>
      <text x="58" y="250" fontSize="10.5" fill="#e6e6e1">
        {"update_task(FWD-12, "}
        <tspan fill="var(--band-accent)">"done"</tspan>
        {")"}
        <tspan fill="#8a8a85">{"  → file changes, committed with the code"}</tspan>
      </text>
    </svg>
  );
}

function SyncFigure() {
  const label = "Three surfaces — the canvas, VS Code and an AI agent — all read and write the same .forward/ files in the repository, and git carries them to the rest of the team";
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
      <text x="150" y="47" textAnchor="middle" fontSize="12" fill={INK}>canvas</text>
      <text x="150" y="62" textAnchor="middle" fontSize="9.5" fill={FAINT}>local server · 127.0.0.1</text>
      <rect x="290" y="28" width="180" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="380" y="47" textAnchor="middle" fontSize="12" fill={INK}>VS Code</text>
      <text x="380" y="62" textAnchor="middle" fontSize="9.5" fill={FAINT}>extension · in-process</text>
      <rect x="520" y="28" width="180" height="44" rx="7" fill={BOX} stroke={BORDER} />
      <text x="610" y="47" textAnchor="middle" fontSize="12" fill={INK}>AI agent</text>
      <text x="610" y="62" textAnchor="middle" fontSize="9.5" fill={FAINT}>MCP · CLI · 39 tools</text>
      <path d="M150 72 C170 105 240 122 292 130" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#s-arrS)" markerEnd="url(#s-arr)" />
      <path d="M380 72 V126" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#s-arrS)" markerEnd="url(#s-arr)" />
      <path d="M610 72 C590 105 520 122 468 130" fill="none" stroke={EDGE} strokeWidth="1.4" markerStart="url(#s-arrS)" markerEnd="url(#s-arr)" />
      <rect x="230" y="130" width="300" height="48" rx="8" fill={BOX} stroke={INK} strokeWidth="1.5" />
      <text x="380" y="151" textAnchor="middle" fontSize="12.5" fill={INK}>.forward/ in your repo</text>
      <text x="380" y="167" textAnchor="middle" fontSize="9.5" fill={FAINT}>one file per record · validated by one schema</text>
      <text x="380" y="200" textAnchor="middle" fontSize="10" fill={FAINT}>git commit · pull request · merge: the team stays in sync</text>
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
  children: ReactNode;
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
