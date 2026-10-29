import {
  type AgentNode,
  type ApiBinding,
  type Checkpoint,
  type CheckpointInput,
  type CheckpointTag,
  DesignElement,
  type ElementType,
  type Entity,
  type EntityRelation,
  type InfraEdge,
  type InfraFlow,
  type InfraFlowStep,
  type InfraNode,
  type McpServerNode,
  type ProjectTimelineEvent,
  type Task,
  agentsToComponentMermaid,
  applyTaskChange,
  entityToMermaid,
  flowToMermaid,
  newTask,
  paintOrder,
  withoutBinding,
} from "forward-core";
import type {
  AgentSnapshot,
  CanvasSource,
  ElementSnapshot,
  RosterMember,
} from "./source.js";
import { descendants, findParent, sameRect, snap, type Rect } from "./geometry.js";
import {
  INFRA_COLORS,
  renderEntityPanel,
  renderInfraPanel,
  renderPanel,
} from "./panel.js";
import { renderTimelineView } from "./timeline-view.js";
import { renderTasksView, type TasksMode } from "./tasks-view.js";
import { renderMemberView } from "./member-view.js";
import {
  type CanvasTheme,
  type ThemePreset,
  DEFAULT_THEME,
  renderThemeView,
} from "./theme-view.js";
import canvasCss from "./canvas.css?inline";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** The static DOM the editor renders into. Injected into the canvas Shadow DOM so
 * its styles (and generic selectors like `code`/`table`/`.row`) stay isolated
 * from any host page (e.g. the VS Code webview). */
const SKELETON = `
<div class="fwd-canvas-root layers-open" data-view="design">
  <nav id="toolbar"></nav>
  <aside id="layers">
    <div class="fwd-layers-head">
      <svg class="tb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"></path><path d="M3 13l9 5 9-5"></path></svg>
      <span class="fwd-layers-title">Layers</span>
      <span class="fwd-layers-count" id="layersCount"></span>
    </div>
    <div class="fwd-layers-divider"></div>
    <div class="fwd-layers-body" id="layersBody"></div>
  </aside>
  <div class="fwd-center">
    <div class="fwd-topstrip">
      <div class="fwd-crumb" id="crumb">
        <span class="crumb-dim">forward</span><span class="crumb-sep">/</span><span class="crumb">canvas</span>
      </div>
      <div class="fwd-topright">
        <span id="savedLabel" class="fwd-saved"></span>
        <button id="saveCheckpoint" class="fwd-savebtn" type="button" title="Save design checkpoint (⌘S)" hidden></button>
        <div class="fwd-live" id="liveSync" title="Live sync with the Forward backend"><span class="fwd-live-dot"></span><span class="fwd-live-label">LIVE SYNC</span></div>
      </div>
    </div>
    <div id="stage">
      <svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
      <button id="inspectorToggle" class="fwd-inspbtn" type="button" title="Toggle inspector" aria-pressed="false"></button>
      <div id="zoombar">
        <button id="zoomOut" title="Zoom out">−</button>
        <span id="zoomLabel">100%</span>
        <button id="zoomIn" title="Zoom in">+</button>
        <button id="zoomFit" title="Fit to content">Fit</button>
        <button id="edgeScrollToggle" type="button" aria-pressed="true">
          <svg class="tb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 12 3 15 6"></polyline><polyline points="9 18 12 21 15 18"></polyline><polyline points="6 9 3 12 6 15"></polyline><polyline points="18 9 21 12 18 15"></polyline><line x1="12" y1="3" x2="12" y2="21"></line><line x1="3" y1="12" x2="21" y2="12"></line><line class="es-slash" x1="4" y1="20" x2="20" y2="4"></line></svg>
        </button>
      </div>
      <button id="backpill" class="fwd-backpill" type="button" hidden>
        <span class="fwd-backarrow">&larr;</span><span>Back to project</span>
      </button>
      <div id="flowpanel" hidden></div>
      <div id="history" hidden></div>
      <div id="tasks" hidden></div>
      <div id="viewtools" hidden></div>
      <div id="member" hidden></div>
    </div>
  </div>
  <aside id="panel"><p class="empty">Select or draw an element.</p></aside>
  <div id="ctxmenu" hidden></div>
  <div id="savemodal" hidden></div>
  <div id="dialog" hidden></div>
</div>`;

export interface MountOptions {
  /** Element to render the editor into; its Shadow DOM is created/reused. */
  container: HTMLElement;
  /** Data source, built by the caller so it can inject auth / pick a backend. */
  source: CanvasSource;
  /** Element id to select + center once it loads (e.g. a docs deep link). */
  focusElementId?: string | null;
  /** Project id, used only to scope the local (per-project) view theme. */
  projectId?: string | null;
  /** Project name, shown as the middle breadcrumb segment (`forward / <name> / canvas`). */
  projectName?: string | null;
  /** Invoked by the in-canvas "Back to project" pill; the host navigates. The
   * pill is shown only when this is provided. */
  onBack?: () => void;
  /** Invoked when the "forward" crumb is clicked; the host navigates to the
   * project list. The crumb is a link only when this is provided. */
  onNavigateHome?: () => void;
  /** Invoked when the project-name crumb is clicked; the host navigates to the
   * project. The crumb is a link only when this is provided. */
  onNavigateProject?: () => void;
}

/** Handle from mountCanvas; `destroy` stops polling and removes global listeners. */
export interface CanvasHandle {
  destroy: () => void;
  /** Open the task tracker in `mode` — a host's "show the task timeline"
   * command. A no-op when the source can't list tasks. */
  showTasks: (mode: TasksMode) => void;
}

// --- instance state ------------------------------------------------------
// The editor is a single module-scoped instance (only one canvas is mounted at a
// time). Its state + helpers live as module declarations below; mountCanvas wires
// them to a container + source. Refs are assigned in mountCanvas (definite-assign).
let uiRoot: ShadowRoot;
let source!: CanvasSource;
let svg!: SVGSVGElement;
let stageEl!: HTMLElement;
let panel!: HTMLElement;
let toolbar!: HTMLElement;
let zoomLabel: HTMLElement | null = null;
let historyEl!: HTMLElement;
let flowPanelEl!: HTMLElement;
let tasksEl!: HTMLElement;
let viewToolsEl!: HTMLElement;
let memberEl!: HTMLElement;
let ctxMenuEl!: HTMLElement;
let saveModalEl!: HTMLElement;
let dialogEl!: HTMLElement;
let savedLabelEl: HTMLElement | null = null;
let saveBtnEl: HTMLButtonElement | null = null;
let canvasRootEl: HTMLElement | null = null;
let layersBodyEl: HTMLElement | null = null;
let layersCountEl: HTMLElement | null = null;
let focusElementId: string | null = null;
let focusApplied = false;
/** Is the left Layers sidebar (DESIGN TREE) open? Defaults open, per the design. */
let layersOpen = true;
/** Is the right Inspector drawer open? Defaults closed — the inspector no longer
 * auto-opens when an element is selected; the user reveals it via the top-right
 * inspector toggle. */
let inspectorOpen = false;
/** Ids the user has hidden via the layer eye toggle — view-only, not persisted. */
const hiddenIds = new Set<string>();

/** Teardown callbacks (unsubscribes + window listener removers) run by destroy(). */
const disposers: Array<() => void> = [];

/** Register a window listener and track its remover, so destroy() can detach it. */
function on<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  handler: (ev: WindowEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler as EventListener, opts);
  disposers.push(() =>
    target.removeEventListener(type, handler as EventListener, opts),
  );
}

/**
 * Mount the Forward canvas editor into `container`. Sets up the Shadow DOM,
 * resolves the DOM refs, attaches the source, and runs the bootstrap. Returns a
 * handle whose `destroy()` tears the instance down — used by a host that remounts it
 * on unmount; the standalone entry just calls mountCanvas and never destroys.
 */
export function mountCanvas(opts: MountOptions): CanvasHandle {
  uiRoot =
    opts.container.shadowRoot ?? opts.container.attachShadow({ mode: "open" });
  uiRoot.innerHTML = `<style>${canvasCss}</style>${SKELETON}`;

  source = opts.source;
  focusElementId = opts.focusElementId ?? null;
  focusApplied = false;
  themeStorageKey = opts.projectId ? `fwd-theme:${opts.projectId}` : null;
  loadTheme();
  loadHoverScrollPref();

  svg = uiRoot.querySelector("#canvas") as unknown as SVGSVGElement;
  stageEl = uiRoot.querySelector("#stage") as HTMLElement;
  panel = uiRoot.querySelector("#panel") as HTMLElement;
  toolbar = uiRoot.querySelector("#toolbar") as HTMLElement;
  zoomLabel = uiRoot.querySelector("#zoomLabel") as HTMLElement | null;
  historyEl = uiRoot.querySelector("#history") as HTMLElement;
  flowPanelEl = uiRoot.querySelector("#flowpanel") as HTMLElement;
  tasksEl = uiRoot.querySelector("#tasks") as HTMLElement;
  viewToolsEl = uiRoot.querySelector("#viewtools") as HTMLElement;
  memberEl = uiRoot.querySelector("#member") as HTMLElement;
  ctxMenuEl = uiRoot.querySelector("#ctxmenu") as HTMLElement;
  saveModalEl = uiRoot.querySelector("#savemodal") as HTMLElement;
  dialogEl = uiRoot.querySelector("#dialog") as HTMLElement;
  savedLabelEl = uiRoot.querySelector("#savedLabel") as HTMLElement | null;
  saveBtnEl = uiRoot.querySelector("#saveCheckpoint") as HTMLButtonElement | null;
  canvasRootEl = uiRoot.querySelector(".fwd-canvas-root") as HTMLElement | null;
  layersBodyEl = uiRoot.querySelector("#layersBody") as HTMLElement | null;
  layersCountEl = uiRoot.querySelector("#layersCount") as HTMLElement | null;
  // Reset view-only layer state on (re)mount so a reused container starts clean.
  layersOpen = true;
  inspectorOpen = false;
  hiddenIds.clear();

  setBreadcrumb(opts.projectName ?? null, opts.onNavigateHome, opts.onNavigateProject);
  wireBackPill(opts.onBack);

  applyTheme(); // push the loaded (or default) theme before the first paint
  buildToolbar();
  renderLayers(); // populate the (initially empty) DESIGN TREE before data loads
  wireZoomControls();
  wireSaveButton();
  wireInspectorToggle();
  bindPointer();
  bindKeyboard();
  bindResize();
  subscribeAll();
  console.info("[canvas] mounted");

  return { destroy, showTasks: openTasks };
}

/** Open the task tracker in `mode`, staying in it if it is already open. */
function openTasks(mode: TasksMode): void {
  if (!source.subscribeTasks) return;
  taskMode = mode;
  if (view === "tasks") renderTasksPanel();
  else setView("tasks");
}

/** Render the breadcrumb as `forward / <project> / canvas`; the project segment
 * is dropped when no name was supplied. Segments become keyboard-accessible links
 * only when the host supplies a handler (standalone dev has no router, so they
 * stay plain text). `canvas` is the current page and never a link. */
function setBreadcrumb(
  projectName: string | null,
  onHome?: () => void,
  onProject?: () => void,
): void {
  const crumb = uiRoot.querySelector("#crumb") as HTMLElement | null;
  if (!crumb) return;
  crumb.replaceChildren();
  const seg = (text: string, cls: string, onClick?: () => void) => {
    const s = document.createElement("span");
    s.className = onClick ? `${cls} crumb-link` : cls;
    s.textContent = text;
    if (onClick) {
      s.setAttribute("role", "link");
      s.tabIndex = 0;
      s.addEventListener("click", onClick);
      s.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      });
    }
    return s;
  };
  const sep = () => seg("/", "crumb-sep");
  crumb.append(seg("forward", "crumb-dim", onHome));
  if (projectName) crumb.append(sep(), seg(projectName, "crumb", onProject));
  crumb.append(sep(), seg("canvas", "crumb"));
}

/** Wire the in-canvas "Back to project" pill; shown only when the host gives a
 * handler (it owns navigation, since the canvas is always embedded). */
function wireBackPill(onBack?: () => void): void {
  const pill = uiRoot.querySelector("#backpill") as HTMLButtonElement | null;
  if (!pill) return;
  if (!onBack) {
    pill.hidden = true;
    return;
  }
  pill.hidden = false;
  pill.addEventListener("click", onBack);
}

/** Stop polling, detach global listeners, and clear the rendered DOM. */
function destroy(): void {
  for (const dispose of disposers.splice(0)) {
    try {
      dispose();
    } catch (err) {
      console.warn("[canvas] cleanup failed:", err);
    }
  }
  // Cancel a pending write-retry so it can't fire against a torn-down source.
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  // Commit any in-flight inline text edit so the user's typing isn't silently
  // lost on unmount; a no-op (and clears the stale ref) when nothing is open.
  finishTextEdit(false);
  // Stop the animation loops so a hover-scroll or camera glide can't keep
  // painting into the torn-down shadow root after we detach it.
  stopEdgeScroll();
  cancelViewAnim();
  uiRoot?.replaceChildren();
}

// Mermaid is heavy (~700kB), so lazy-load it the first time a flow diagram is
// opened — the offline/fixture path never pays for it. Dark theme to match the
// canvas; security stays "strict" (sanitizer on) — see getMermaid below. Diagram
// text is cross-tenant user content, so it must never be rendered "loose".
let flowSeq = 0; // unique id per render so Mermaid doesn't collide on re-renders
let flowZoom = 1; // 1 = fit-to-pane; the −/+ controls scale around that fit
let mermaidPromise: Promise<typeof import("mermaid").default> | undefined;
function getMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: m }) => {
      // "strict" runs mermaid's output through its sanitizer. Diagram text comes
      // from cross-tenant user content (entity/infra/flow labels), so we never
      // want "loose" (which disables sanitization); the serializers already
      // entity-escape labels, and no diagram uses `click` directives, so strict
      // costs us nothing.
      m.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      return m;
    });
  }
  return mermaidPromise;
}

// ---- editor state -------------------------------------------------------
type Tool = "select" | "frame" | "rectangle" | "ellipse" | "text";
/** The insertable shape tools — every Tool except "select". A subset of
 * ElementType too, so a catalog entry works for both setTool and newElement. */
type InsertableType = Exclude<Tool, "select">;
const elements = new Map<string, DesignElement>();
const timelines = new Map<string, ElementSnapshot["timeline"]>();
const lastSeen = new Map<string, string>();
/** Elements with a locally-applied edit whose server write hasn't been
 * confirmed yet. The elements poll skips these (see subscribeAll's guard) so a
 * stale snapshot can't revert an un-acked local change once the drag gesture
 * has already ended. `writeSeq` stamps each save with a monotonic id so a slow
 * older write can't clear the shield a newer edit still needs; `failedWrites`
 * holds the ids to re-send when the connection recovers. */
const inflightWrites = new Set<string>();
const failedWrites = new Set<string>();
const writeSeq = new Map<string, number>();
/** The "Save documentation" counterparts. Unlike geometry saves (re-sent from
 * the element's current state), a doc save carries its own payload — the
 * binding plus the version entry it appends — so `failedDocs` keeps the payload
 * itself for the retry. `inflightDocs` shields the element AND its timeline
 * from the poll loop until the write is confirmed: without it, the first poll
 * after a reconnect overwrites the local binding with the server's copy from
 * before the outage, visibly erasing the docs that were just written. */
type DocVersion = { version: string; changeLog: string; action: "created" | "modified" };
const inflightDocs = new Set<string>();
const failedDocs = new Map<string, { binding: ApiBinding; version: DocVersion }>();
const docSeq = new Map<string, number>();
/**
 * Elements whose apiBinding has uncommitted local edits — seeded by "Add
 * documentation" or edited in the panel but not yet committed via "Save
 * documentation". The server owns bindings through bind()/unbind() and strips any
 * binding sent via saveElement, so these edits live only on the client until
 * saved; the ids mark them so the poll loop and write-adopt keep the LOCAL binding
 * instead of the server's copy. Cleared once committed (bind) or removed.
 */
const unsavedDocIds = new Set<string>();
/**
 * Subset of `unsavedDocIds` whose binding was NEVER committed (a fresh seed on a
 * previously-undocumented element). Removing one of these needs no server unbind
 * — there's nothing on the server to remove — whereas removing a committed
 * binding must call unbind() to drop it and record the deletion.
 */
const draftDocIds = new Set<string>();
/** While a binding has uncommitted local edits, the local copy wins over the
 * server's — so a poll or write-adopt can't revert an in-progress edit/draft. */
function preserveUnsavedDoc(incoming: DesignElement): DesignElement {
  if (!unsavedDocIds.has(incoming.id)) return incoming;
  const local = elements.get(incoming.id);
  return local?.apiBinding ? { ...incoming, apiBinding: local.apiBinding } : incoming;
}
/** Ids deleted while a save was still in flight: the in-flight upsert may land
 * after the delete and resurrect the row, so its resolution issues a
 * compensating delete instead of adopting the server copy. */
const pendingDeletes = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const infraNodes = new Map<string, InfraNode>();
let infraEdges: InfraEdge[] = [];
const infraFlows = new Map<string, InfraFlow>();
const entities = new Map<string, Entity>(); // ER (data-model) layer
let entityRelations: EntityRelation[] = [];
const agentNodes = new Map<string, AgentNode>(); // Agent / MCP layer
const mcpServers = new Map<string, McpServerNode>();
let selectedFlowId: string | null = null; // sequence flow chosen in the Flows view
let selectedFlowAgents = false; // is the agent/MCP wiring diagram the chosen render?
let selectedFlowEr = false; // is the ER (data-model) diagram the chosen render?
let selectedInfraId: string | null = null; // infra node selected for editing/deletion
let linkMode = false; // Link tool armed: clicks pick two nodes to connect
let linkSourceId: string | null = null; // first node picked while linking
let infraSearch = ""; // infra inspector List-mode search query
let infraTypeFilter = "all"; // infra inspector List-mode kind filter ("all" | InfraKind)
let infraPanelPos = { x: 12, y: 12 }; // floating infra inspector position (stage px)
let infraPanelCollapsed = false; // infra inspector collapsed to its header
let entitySearch = ""; // data inspector List-mode search query
let entityPanelPos = { x: 12, y: 12 }; // floating data inspector position (stage px)
let entityPanelCollapsed = false; // data inspector collapsed to its header
let selectedEntityId: string | null = null; // ER entity selected for editing/deletion
let selectedRelationId: string | null = null; // ER relation selected for editing/deletion
let entityLinkMode = false; // Relate tool armed: clicks pick two entities to relate
let entityLinkSourceId: string | null = null; // first entity picked while relating
let flowOpen = false; // is the rendered Flows view showing?
let flowEdit = false; // is the flow editor (right column) open?
let tool: Tool = "select";
let selectedId: string | null = null;
let hoverId: string | null = null; // element under the pointer (drives the doc leader line)
let showDocs = true; // show/hide the minimized API indicators on documented elements
let hoverScrollEnabled = true; // bare-cursor edge auto-scroll (drag-scroll is always on)
let showInfra = false; // show/hide the infrastructure diagram overlay
let showEntities = false; // show/hide the ER (data-model) diagram overlay
let showTimeline = false; // show/hide the project endpoint-timeline panel
let showTasks = false; // show/hide the project task-tracker panel
let showTheme = false; // show/hide the theme editor drawer
let taskFilterLinked = false; // restrict the task list to the current selection
let taskMode: TasksMode = "list"; // the task panel's layout: list or timeline (Gantt)

// The rail behaves as a set of mutually-exclusive workspace modes. `view` is the
// single source of truth; the legacy `show*`/`flowOpen` booleans above are derived
// from it inside setView() so the many existing read-sites keep working. `showDocs`
// (decoration, design-only) and `showTheme` (drawer overlay, allowed in any view)
// stay independent.
type PrimaryView =
  | "design"
  | "infra"
  | "data"
  | "flow"
  | "agents"
  | "history"
  | "tasks"
  | "member";
let view: PrimaryView = "design";
// Member roster (the Member view), loaded lazily on entry from source.listMembers.
let members: RosterMember[] = [];
let membersLoading = false;
let membersError: string | undefined;

// Local-only view theme (full UI palette + grid). Persisted to localStorage per
// project — never written to the project data, and never touches canvas shapes.
// DEFAULT_THEME is "Midnight", which mirrors the CSS `:host` defaults.
let theme: CanvasTheme = { ...DEFAULT_THEME };
let themeStorageKey: string | null = null;
const tasks = new Map<string, Task>();
// The canvas has no signed-in user; activity it writes is attributed to "canvas".
const TASK_ACTOR = "canvas";
// Manual canvas checkpoints (pillar 5), newest first — populated only when the
// source can persist them (otherwise the Save button + History cards stay hidden).
let checkpoints: Checkpoint[] = [];
// The unified, domain-tagged activity feed behind the History timeline (design /
// api / infra / flow events); populated only when the source serves it.
let projectTimeline: ProjectTimelineEvent[] = [];
// Draft kept while the save-checkpoint modal is open, so re-renders don't lose it.
let saveDraft: { title: string; description: string; tag: CheckpointTag } = {
  title: "",
  description: "",
  tag: "checkpoint",
};

// Viewport: `translate(panX, panY) scale(zoom)` applied to everything drawn.
let zoom = 1;
let panX = 0;
let panY = 0;
/** rAF handle for an in-flight viewport tween (centering on a layer); null when idle. */
let viewAnimFrame: number | null = null;

// Inline text editing: the id of the element currently open in the overlaid
// <textarea> (its glyph is suppressed while it is), and the textarea itself.
let editingTextId: string | null = null;
let textEditor: HTMLTextAreaElement | null = null;
// The infra overlay rides on its own translation (in world units, inside the
// zoomed viewport) so it can be dragged clear of the design without panning —
// or moving — the design beneath it.
let infraPanX = 0;
let infraPanY = 0;
// The ER overlay rides on its own translation too, like the infra overlay.
let entityPanX = 0;
let entityPanY = 0;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

type Gesture =
  | { kind: "move"; id: string; startX: number; startY: number; orig: Rect }
  | { kind: "resize"; id: string; startX: number; startY: number; orig: Rect }
  | { kind: "rotate"; id: string; cx: number; cy: number; origRotation: number }
  | { kind: "create"; type: ElementType; startX: number; startY: number; id: string }
  | { kind: "pan"; startX: number; startY: number; origPanX: number; origPanY: number; moved: boolean }
  | { kind: "infra-pan"; startX: number; startY: number; origX: number; origY: number }
  | { kind: "infra-move"; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
  | { kind: "entity-pan"; startX: number; startY: number; origX: number; origY: number }
  | { kind: "entity-move"; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean };
let gesture: Gesture | null = null;
let guides: { v: number[]; h: number[] } = { v: [], h: [] };

// ---- edge auto-scroll ---------------------------------------------------
// Pan the canvas toward a viewport edge the pointer is near, so off-screen
// designs scroll into view. Works two ways: while dragging content (the dragged
// item is carried into the newly-revealed area) and on a bare hover with nothing
// grabbed (just the view moves). Distinct from the `pan` gestures, which *are*
// the scroll.
const EDGE_SCROLL_MARGIN = 48; // px from an edge where auto-scroll begins
const EDGE_SCROLL_MAX_SPEED = 20; // px/frame at (or past) the very edge
let edgeScrollRAF: number | null = null;
let edgeScrollVX = 0;
let edgeScrollVY = 0;
// Last pointer position of the in-flight drag, so the loop can keep tracking the
// dragged item against the moving world even when the pointer is held still.
let edgeDragClientX = 0;
let edgeDragClientY = 0;
let edgeDragShift = false;

/** Gestures that drag content and should trigger edge auto-scroll (rotate stays
 * in place, and the pan gestures are themselves the scroll). */
function isDragGesture(g: Gesture): boolean {
  return (
    g.kind === "move" ||
    g.kind === "resize" ||
    g.kind === "create" ||
    g.kind === "infra-move" ||
    g.kind === "entity-move"
  );
}

/** Ramp from 0 at the margin to max speed at (or past) the edge. */
function edgeSpeed(dist: number): number {
  const t = Math.max(0, Math.min(1, 1 - dist / EDGE_SCROLL_MARGIN));
  return t * EDGE_SCROLL_MAX_SPEED;
}

/** Recompute the auto-scroll velocity from the pointer's distance to each edge,
 * starting or stopping the animation loop as needed. */
function updateEdgeScroll(
  clientX: number,
  clientY: number,
  shiftKey: boolean,
  box: DOMRect = svg.getBoundingClientRect(),
): void {
  edgeDragClientX = clientX;
  edgeDragClientY = clientY;
  edgeDragShift = shiftKey;
  const rightDist = box.right - clientX;
  const leftDist = clientX - box.left;
  const botDist = box.bottom - clientY;
  const topDist = clientY - box.top;
  edgeScrollVX =
    rightDist < EDGE_SCROLL_MARGIN
      ? edgeSpeed(rightDist)
      : leftDist < EDGE_SCROLL_MARGIN
        ? -edgeSpeed(leftDist)
        : 0;
  edgeScrollVY =
    botDist < EDGE_SCROLL_MARGIN
      ? edgeSpeed(botDist)
      : topDist < EDGE_SCROLL_MARGIN
        ? -edgeSpeed(topDist)
        : 0;
  if ((edgeScrollVX !== 0 || edgeScrollVY !== 0) && edgeScrollRAF === null) {
    edgeScrollRAF = requestAnimationFrame(edgeScrollTick);
  }
}

function edgeScrollTick(): void {
  edgeScrollRAF = null;
  if (edgeScrollVX === 0 && edgeScrollVY === 0) return;
  // Pan the world opposite the velocity so content near the edge slides into view.
  panX -= edgeScrollVX;
  panY -= edgeScrollVY;
  // Mid-drag, re-apply the gesture from the held pointer position so the dragged
  // item stays under the cursor as the world scrolls beneath it; on a bare hover
  // there's nothing to carry, so just repaint at the new pan.
  if (gesture) {
    applyGesture({ clientX: edgeDragClientX, clientY: edgeDragClientY, shiftKey: edgeDragShift });
  } else {
    render();
  }
  edgeScrollRAF = requestAnimationFrame(edgeScrollTick);
}

function stopEdgeScroll(): void {
  edgeScrollVX = 0;
  edgeScrollVY = 0;
  if (edgeScrollRAF !== null) {
    cancelAnimationFrame(edgeScrollRAF);
    edgeScrollRAF = null;
  }
}

// Hover-scroll is an input-ergonomics preference, not project data, so it's saved
// per-user under one global key rather than per-project like the theme.
const HOVER_SCROLL_KEY = "fwd:hoverScroll";
function loadHoverScrollPref(): void {
  try {
    const raw = window.localStorage.getItem(HOVER_SCROLL_KEY);
    if (raw !== null) hoverScrollEnabled = raw !== "0";
  } catch {
    // Blocked/private-mode storage: keep the in-memory default (enabled).
  }
}
function saveHoverScrollPref(): void {
  try {
    window.localStorage.setItem(HOVER_SCROLL_KEY, hoverScrollEnabled ? "1" : "0");
  } catch {
    // Storage unavailable — the preference stays in-memory for this session.
  }
}

// ---- optimistic writes --------------------------------------------------
/** Persist an element optimistically. The element is shielded from the poll
 * loop (added to `inflightWrites`) until the server confirms the write, so a
 * snapshot fetched in the gap between drop and the write landing can't snap it
 * back to its old position. A failed write — common while the connection is
 * "reconnecting" — is kept and retried rather than silently dropped. */
async function persistElement(el: DesignElement): Promise<void> {
  const seq = (writeSeq.get(el.id) ?? 0) + 1;
  writeSeq.set(el.id, seq);
  inflightWrites.add(el.id);
  failedWrites.delete(el.id);
  try {
    // Geometry/style only — the binding is owned by documentElement/undocument
    // (withoutBinding makes that explicit and keeps the server from silently
    // dropping a binding this path never persists anyway).
    const saved = await source.saveElement(withoutBinding(el));
    // The element was deleted while this write was in flight — the upsert may
    // have just resurrected the row, so undo it and drop the shield.
    if (pendingDeletes.has(el.id)) {
      pendingDeletes.delete(el.id);
      writeSeq.delete(el.id);
      inflightWrites.delete(el.id);
      void source.deleteElement(el.id).catch(() => {});
      return;
    }
    // A newer local edit issued while this write was in flight owns the
    // outcome now — only the latest write settles the element.
    if (writeSeq.get(el.id) !== seq) return;
    writeSeq.delete(el.id);
    inflightWrites.delete(el.id);
    // Adopt the server's persisted copy: its server-owned fields (updatedAt,
    // author) supersede our optimistic values, so a later poll sees no diff and
    // we stay converged instead of holding a stale local timestamp forever.
    // `preserveUnsavedDoc` keeps an uncommitted binding draft the server strips.
    elements.set(el.id, preserveUnsavedDoc(saved));
    if (selectedId === el.id) render(); // refresh the inspector's metadata
  } catch (err) {
    console.warn("[canvas] element save failed; will retry on reconnect:", err);
    if (writeSeq.get(el.id) === seq) {
      failedWrites.add(el.id); // stays shielded until a retry succeeds
      scheduleRetry();
    }
  }
}

/** Persist a "Save documentation" write with the same shield/retry treatment
 * as persistElement: a failure — common while the pill reads "reconnecting" —
 * queues the payload for re-send instead of dropping it, and the element stays
 * shielded from the poll loop so a post-reconnect snapshot can't erase the
 * binding locally. Resolves with what actually happened so the caller can be
 * honest in the toast: "saved" (server confirmed), "queued" (failed, will
 * retry), or "superseded" (a newer doc save owns the outcome). */
async function persistDoc(
  id: string,
  binding: ApiBinding,
  version: DocVersion,
): Promise<"saved" | "queued" | "superseded"> {
  const doc = source.documentElement?.bind(source);
  if (!doc) return "superseded";
  const seq = (docSeq.get(id) ?? 0) + 1;
  docSeq.set(id, seq);
  inflightDocs.add(id);
  failedDocs.delete(id);
  try {
    await doc(id, binding, version);
    if (docSeq.get(id) !== seq) return "superseded";
    docSeq.delete(id);
    inflightDocs.delete(id);
    unsavedDocIds.delete(id); // the draft is now committed server-side
    draftDocIds.delete(id);
    // Our own write won't echo back through realtime for up to a poll interval
    // (30s when realtime is attached) — refresh the History timeline and the
    // per-element version list at once so the save shows up immediately.
    source.notifyChange?.("timeline");
    return "saved";
  } catch (err) {
    console.warn("[canvas] doc save failed; will retry on reconnect:", err);
    if (docSeq.get(id) !== seq) return "superseded";
    failedDocs.set(id, { binding, version }); // stays shielded until a retry succeeds
    scheduleRetry();
    return "queued";
  }
}

/** Persist a documentation *removal* (unbind + a "deleted" version entry),
 * shielded like a doc save so a poll can't restore the binding mid-flight. */
async function persistUndoc(id: string, title: string): Promise<"saved" | "queued"> {
  const undoc = source.undocumentElement?.bind(source);
  if (!undoc) return "queued"; // source can't unbind — local removal only
  const seq = (docSeq.get(id) ?? 0) + 1;
  docSeq.set(id, seq);
  inflightDocs.add(id);
  const version = `v${(timelines.get(id) ?? []).length + 1}`;
  try {
    await undoc(id, { version, changeLog: "Removed API documentation", title });
    if (docSeq.get(id) !== seq) return "saved";
    docSeq.delete(id);
    inflightDocs.delete(id);
    source.notifyChange?.("timeline"); // reflect the removal in History at once
    return "saved";
  } catch (err) {
    console.warn("[canvas] doc removal failed:", err);
    if (docSeq.get(id) === seq) {
      docSeq.delete(id);
      inflightDocs.delete(id); // unshield so the poll can reconcile
    }
    return "queued";
  }
}

/** Re-send every write that failed — geometry saves from the element's current
 * local state, doc saves from their kept payload. Called when the connection
 * returns to "online" and as a timed backoff. */
function flushFailedWrites(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  for (const id of [...failedWrites]) {
    failedWrites.delete(id);
    const el = elements.get(id);
    if (el) void persistElement(el);
    else inflightWrites.delete(id); // deleted locally in the meantime
  }
  for (const [id, d] of [...failedDocs]) {
    failedDocs.delete(id);
    if (!elements.has(id)) {
      // Element deleted locally in the meantime — drop the doc write with it.
      inflightDocs.delete(id);
      docSeq.delete(id);
      continue;
    }
    void persistDoc(id, d.binding, d.version).then((outcome) => {
      // The save was announced as queued when it failed; confirm the recovery.
      if (outcome === "saved") notify("Queued documentation synced.");
    });
  }
}

/** Back off and retry, so a lone failure that happens while the pill still
 * reads "online" is recovered too — not only an offline→online transition. */
function scheduleRetry(): void {
  if (retryTimer || (failedWrites.size === 0 && failedDocs.size === 0)) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    flushFailedWrites();
  }, 3000);
}

// ---- subscriptions ------------------------------------------------------
/** Open the data subscriptions (called by mountCanvas). Each unsubscribe is
 * tracked in `disposers` so a host can unmount cleanly. */
function subscribeAll(): void {
  disposers.push(
    source.subscribe((snaps) => {
      // Don't clobber an element the user is actively dragging. A frame move
      // drags its whole subtree, so protect the descendants too — otherwise a
      // mid-drag poll snaps the children back to their stored positions.
      const active =
        gesture && gesture.kind === "move"
          ? new Set([gesture.id, ...descendants(gesture.id, elements.values())])
          : gesture && "id" in gesture
            ? new Set([gesture.id])
            : null;
      for (const s of snaps) {
        if (active?.has(s.element.id)) continue;
        // An un-acked local write is still the source of truth for this
        // element; a stale poll must not revert it (the drag gesture that
        // shielded it has already ended by the time the write lands). A pending
        // doc save shields too — it owns the binding and the timeline entry.
        if (inflightWrites.has(s.element.id) || inflightDocs.has(s.element.id)) continue;
        elements.set(s.element.id, preserveUnsavedDoc(s.element));
        timelines.set(s.element.id, s.timeline);
      }
      render();
      // Once the deep-linked element has loaded, select + center it (one time
      // only, so later polls don't keep yanking the viewport from the user).
      if (!focusApplied && focusElementId && elements.has(focusElementId)) {
        focusApplied = true;
        select(focusElementId);
        centerOn(focusElementId);
      }
    }),
  );
  disposers.push(
    source.subscribeInfra((infra) => {
      infraNodes.clear();
      for (const n of infra.nodes) infraNodes.set(n.id, n);
      infraEdges = infra.edges;
      infraFlows.clear();
      for (const f of infra.flows) infraFlows.set(f.id, f);
      // Drop a stale selection if its flow was deleted upstream.
      if (selectedFlowId && !infraFlows.has(selectedFlowId)) selectedFlowId = null;
      render();
      if (flowOpen) void renderFlowPanel(); // keep an open diagram in sync with new data
    }),
  );
  // Connection health: flip the LIVE SYNC pill to a "reconnecting" state when the
  // poll loop can't reach the backend, so a dropped connection isn't silent.
  const unsubStatus = source.subscribeStatus?.((status) => {
    const offline = status !== "online";
    // Back online: re-send any write that failed while we were down, so a move
    // or doc save made during the outage isn't silently lost.
    if (!offline && (failedWrites.size > 0 || failedDocs.size > 0)) flushFailedWrites();
    const pill = uiRoot?.querySelector("#liveSync") as HTMLElement | null;
    const label = pill?.querySelector(".fwd-live-label");
    if (!pill || !label) return;
    pill.classList.toggle("offline", offline);
    // "auth" means the backend answered but rejected us (expired session) — a
    // retry can't fix it, so tell the user what to do instead of "reconnecting".
    label.textContent =
      status === "auth" ? "SIGN-IN EXPIRED" : offline ? "RECONNECTING…" : "LIVE SYNC";
    pill.title =
      status === "auth"
        ? "The session expired — sign in again to resume syncing. Unsaved edits are queued in this tab."
        : "Live sync with the Forward backend";
  });
  if (unsubStatus) disposers.push(unsubStatus);
  // Queued/in-flight writes live only in this tab's memory: warn before the
  // page unloads while any edit hasn't been confirmed by the server, so work
  // drawn or documented during an outage isn't silently discarded.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (
      inflightWrites.size === 0 &&
      failedWrites.size === 0 &&
      inflightDocs.size === 0 &&
      failedDocs.size === 0
    ) {
      return;
    }
    e.preventDefault();
    e.returnValue = ""; // Chrome requires returnValue to show the prompt
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  disposers.push(() => window.removeEventListener("beforeunload", onBeforeUnload));
  // ER / data-model graph (pillar 3c) — read-only render in the Flows panel; only
  // sources that expose it (ServerSource) drive this, others simply never fire.
  const unsubEntities = source.subscribeEntities?.((snapshot) => {
    entities.clear();
    for (const e of snapshot.entities) entities.set(e.id, e);
    entityRelations = snapshot.relations;
    // Drop a stale selection if its entity/relation was deleted upstream.
    if (selectedEntityId && !entities.has(selectedEntityId)) selectedEntityId = null;
    if (
      selectedRelationId &&
      !entityRelations.some((r) => r.id === selectedRelationId)
    ) {
      selectedRelationId = null;
    }
    if (showEntities) render(); // keep the overlay live
    if (flowOpen) void renderFlowPanel(); // keep an open ER diagram in sync
  });
  if (unsubEntities) disposers.push(unsubEntities);
  // Agent / MCP graph (pillar 8) — read + wiring diagram in the diagram panel;
  // only sources that expose it (ServerSource) drive this.
  const unsubAgents = source.subscribeAgents?.((snapshot) => {
    agentNodes.clear();
    for (const a of snapshot.agents) agentNodes.set(a.id, a);
    mcpServers.clear();
    for (const s of snapshot.servers) mcpServers.set(s.id, s);
    if (view === "agents") render();
    if (flowOpen) void renderFlowPanel(); // keep an open wiring diagram in sync
  });
  if (unsubAgents) disposers.push(unsubAgents);
  // Tasks (pillar 4) — present on sources that can list them; a read-only
  // source (no saveTask) shows them without write controls.
  const unsubTasks = source.subscribeTasks?.((next) => {
    tasks.clear();
    for (const t of next) tasks.set(t.id, t);
    renderTasksPanel();
  });
  if (unsubTasks) disposers.push(unsubTasks);
  // Checkpoints (pillar 5) — like tasks, only when the source can persist them.
  const unsubCheckpoints = source.subscribeCheckpoints?.((next) => {
    checkpoints = next;
    updateSavedLabel();
    if (showTimeline) renderTimelinePanel(); // refresh History cards if open
  });
  if (unsubCheckpoints) disposers.push(unsubCheckpoints);

  // The unified activity feed behind the History timeline (design/api/infra/flow).
  const unsubTimeline = source.subscribeProjectTimeline?.((next) => {
    projectTimeline = next;
    if (showTimeline) renderTimelinePanel();
  });
  if (unsubTimeline) disposers.push(unsubTimeline);
}

// ========================================================================
// Toolbar
// ========================================================================
/**
 * The single catalog of insertable elements. It drives the right-click "Add
 * element" menu *and* the keyboard shortcuts, so adding a new shape (line, star,
 * …) is one entry here — no new toolbar buttons. `key` is its single-key
 * shortcut (which arms drag-to-draw); `icon` is shown in the Add menu.
 */
const ELEMENT_CATALOG: Array<{
  type: InsertableType;
  label: string;
  key: string;
  icon: () => SVGElement;
}> = [
  { type: "frame", label: "Frame", key: "f", icon: frameIcon },
  { type: "rectangle", label: "Rectangle", key: "r", icon: rectIcon },
  { type: "ellipse", label: "Ellipse", key: "o", icon: ellipseIcon },
  { type: "text", label: "Text", key: "t", icon: textIcon },
];

function buildToolbar(): void {
  // The rail is a flat strip of panel tools (matching the imported design): no
  // Move/select button — select is the default mode, and shapes are inserted via
  // the right-click "Add element" menu or their keyboard shortcuts (drawing then
  // auto-returns to select), so the rail never grows with the shape catalog.
  // Layers sits at the top of the rail (above a divider), separate from the
  // panel tools — it toggles the left DESIGN TREE sidebar rather than a drawer.
  const layersBtn = iconButton(layersIcon(), "Layers", toggleLayers);
  layersBtn.dataset.toggle = "layers";
  layersBtn.classList.toggle("active", layersOpen);
  toolbar.append(layersBtn);
  const sep = document.createElement("div");
  sep.className = "sep";
  toolbar.append(sep);

  const docsBtn = iconButton(docsIcon(), "Docs", toggleDocs);
  docsBtn.dataset.toggle = "docs";
  docsBtn.classList.toggle("active", showDocs);
  toolbar.append(docsBtn);
  const infraBtn = iconButton(infraIcon(), "Infra", toggleInfra);
  infraBtn.dataset.toggle = "infra";
  infraBtn.classList.toggle("active", showInfra);
  toolbar.append(infraBtn);
  const entityBtn = iconButton(entityIcon(), "Data", toggleEntities);
  entityBtn.dataset.toggle = "entities";
  entityBtn.classList.toggle("active", showEntities);
  toolbar.append(entityBtn);
  // Like infra, the ER editing tools (add entity / relate / entity editor) live
  // in the right drawer — see renderEntityPanel — not the toolbar.
  // The infra editing tools (add node / link / node editor) live in the right
  // drawer — see renderInfraPanel — not the toolbar, so they don't read as
  // general element-creation tools.
  const flowBtn = iconButton(flowIcon(), "Flows", toggleFlows);
  flowBtn.dataset.toggle = "flow";
  toolbar.append(flowBtn);
  // Agent / MCP layer — the wiring diagram of agents + MCP servers. Only shown
  // when the source serves it (ServerSource); a read-only/fixture source omits it.
  if (source.subscribeAgents) {
    const agentsBtn = iconButton(agentsIcon(), "Agents", toggleAgents);
    agentsBtn.dataset.toggle = "agents";
    toolbar.append(agentsBtn);
  }
  const tlBtn = iconButton(historyIcon(), "History", toggleTimeline);
  tlBtn.dataset.toggle = "timeline";
  tlBtn.classList.toggle("active", showTimeline);
  toolbar.append(tlBtn);
  // The task tracker shows when the source can list tasks; a read-only source
  // (the static export omits saveTask) gets it view-only.
  if (source.subscribeTasks) {
    const tasksBtn = iconButton(tasksIcon(), "Tasks", toggleTasks);
    tasksBtn.dataset.toggle = "tasks";
    tasksBtn.classList.toggle("active", showTasks);
    toolbar.append(tasksBtn);
  }
  const themeBtn = iconButton(themeIcon(), "Theme", toggleTheme);
  themeBtn.dataset.toggle = "theme";
  themeBtn.classList.toggle("active", showTheme);
  toolbar.append(themeBtn);
  // The contributor roster needs a source that can list it (the live repo
  // source); a static snapshot omits listMembers and the tool doesn't appear.
  if (source.listMembers) {
    const memberBtn = iconButton(memberIcon(), "Member", toggleMember);
    memberBtn.dataset.toggle = "member";
    toolbar.append(memberBtn);
  }
  refreshToolbar();
  syncRailActive();
}

/**
 * Enrol another collaborator by uid. They get their uid from the access banner
 * shown when they're locked out of the project; pasting it here grants access.
 */
/**
 * Switch the active workspace mode. The one place mutual exclusivity lives: it
 * derives the legacy `show*`/`flowOpen` booleans from `next`, clears the transient
 * state of the mode being left, drives the per-view chrome (which surfaces the
 * CSS shows), and repaints. Re-clicking the active mode's rail button returns to
 * the design view.
 */
function setView(next: PrimaryView): void {
  if (view === next) return;
  const prev = view;
  view = next;

  // Legacy flags kept in step so the existing read-sites stay correct.
  showInfra = next === "infra";
  showEntities = next === "data";
  showTimeline = next === "history";
  showTasks = next === "tasks";

  // Leaving infra/data drops their transient selections + armed link tools.
  if (prev === "infra") {
    selectedFlowId = null;
    selectedInfraId = null;
    infraSearch = "";
    infraTypeFilter = "all";
    if (linkMode) {
      linkMode = false;
      linkSourceId = null;
    }
  }
  if (prev === "data") {
    selectedEntityId = null;
    selectedRelationId = null;
    entitySearch = "";
    if (entityLinkMode) {
      entityLinkMode = false;
      entityLinkSourceId = null;
    }
  }

  // Flows and Agents both own the async diagram surface; open/close it here. The
  // Agents view opens it pre-focused on the agent/MCP wiring lens.
  if (next === "flow" || next === "agents") {
    flowOpen = true;
    flowZoom = 1; // open at fit
    flowEdit = false; // open in view mode
    selectedFlowAgents = next === "agents";
    selectedFlowEr = false; // the ER lens is opened from the Data view, not this rail
    if (next === "agents") selectedFlowId = null;
  } else if (next === "data") {
    // The Data view leads with the read-only Mermaid ER diagram; "Edit" drops to
    // the editable graph. With no entities yet there is nothing to render, so open
    // straight into the graph so the first table can be added.
    const hasEntities = entities.size > 0;
    flowOpen = hasEntities;
    flowZoom = 1; // open at fit
    flowEdit = false;
    selectedFlowEr = hasEntities;
    selectedFlowAgents = false;
    selectedFlowId = null;
  } else if (flowOpen) {
    flowOpen = false;
    flowEdit = false;
    selectedFlowEr = false;
    flowPanelEl.replaceChildren();
  }

  // The Member view loads its roster lazily on entry.
  if (next === "member") void loadMembers();

  if (canvasRootEl) canvasRootEl.dataset.view = next;
  // The Layers sidebar only applies in the design view.
  canvasRootEl?.classList.toggle("layers-open", next === "design" && layersOpen);

  syncRailActive();
  render(); // repaints the canvas + refreshes the drawer/view-tools/panels
  renderMemberPanel();
  void renderFlowPanel();
}

/** Reflect the active view + flags on the rail buttons' `.active` state. */
function syncRailActive(): void {
  const set = (toggle: string, on: boolean) =>
    toolbar
      .querySelector(`[data-toggle="${toggle}"]`)
      ?.classList.toggle("active", on);
  set("layers", view === "design" && layersOpen);
  set("docs", view === "design" && showDocs);
  set("infra", view === "infra");
  set("entities", view === "data");
  set("flow", view === "flow");
  set("agents", view === "agents");
  set("timeline", view === "history");
  set("tasks", view === "tasks");
  set("member", view === "member");
  set("theme", showTheme);
}

/** Open the full-area infra graph (or return to design when re-clicked). */
function toggleInfra(): void {
  setView(view === "infra" ? "design" : "infra");
}

/** Open the full-area ER / data-model graph (or return to design). */
function toggleEntities(): void {
  setView(view === "data" ? "design" : "data");
}

/** Open the agent/MCP wiring diagram (or return to design when re-clicked). */
function toggleAgents(): void {
  setView(view === "agents" ? "design" : "agents");
}

/** Open the full-area History timeline (or return to design). */
function toggleTimeline(): void {
  setView(view === "history" ? "design" : "history");
}

/** Open the full-area task tracker (or return to design). */
function toggleTasks(): void {
  setView(view === "tasks" ? "design" : "tasks");
}

/** Open the full-area member roster (or return to design). */
function toggleMember(): void {
  setView(view === "member" ? "design" : "member");
}

/** Show or hide the theme editor, which takes over the right drawer in any view. */
function toggleTheme(): void {
  showTheme = !showTheme;
  syncRailActive();
  renderSelectionPanel();
}

/**
 * The Docs rail button: from another view it returns to the design workspace with
 * decoration on; within the design view it toggles the documented-element
 * indicators / leader line.
 */
function toggleDocs(): void {
  if (view !== "design") {
    showDocs = true;
    setView("design");
    return;
  }
  showDocs = !showDocs;
  syncRailActive();
  render();
}

function setTool(t: Tool): void {
  tool = t;
  refreshToolbar();
}

function refreshToolbar(): void {
  for (const btn of Array.from(toolbar.querySelectorAll("button"))) {
    const t = (btn as HTMLElement).dataset.tool;
    btn.classList.toggle("active", t === tool);
  }
}

// ========================================================================
// Rendering
// ========================================================================
function render(): void {
  svg.replaceChildren();
  // Everything draws inside a viewport group so pan/zoom is a single transform.
  const vp = svgEl("g", {
    transform: `translate(${panX} ${panY}) scale(${zoom})`,
  }) as SVGGElement;

  // The design elements only render in the design view — the infra/data views are
  // standalone (no design beneath), so the graph reads on its own.
  if (view === "design") {
    const design = svgEl("g", {}) as SVGGElement;
    for (const el of ordered()) {
      if (isHidden(el)) continue; // hidden via the layers eye toggle (or a hidden ancestor)
      design.append(drawElement(el));
    }
    if (selectedId) {
      const sel = elements.get(selectedId);
      // Don't draw selection handles over a hidden element (nothing is painted there).
      if (sel && !isHidden(sel)) design.append(...handles(sel));
    }
    for (const x of guides.v) design.append(line(x, 0, x, 4000));
    for (const y of guides.h) design.append(line(0, y, 4000, y));
    vp.append(design);

    // Focus-mode doc leader: the selected (or hovered) element draws one leader
    // line out to its documentation.
    if (showDocs) {
      const focusId = selectedId ?? hoverId;
      const focus = focusId ? elements.get(focusId) : undefined;
      if (focus?.apiBinding) vp.append(drawDocLeader(focus));
    }
  }

  if (showInfra) {
    const infra = drawInfraLayer();
    // Independent translation: the graph drags around inside the viewport.
    infra.setAttribute("transform", `translate(${infraPanX} ${infraPanY})`);
    vp.append(infra);
  }

  if (showEntities) {
    const er = drawEntityLayer();
    er.setAttribute("transform", `translate(${entityPanX} ${entityPanY})`);
    vp.append(er);
  }

  svg.append(vp);
  updateZoomLabel();
  renderSelectionPanel();
  renderViewTools();
  renderTimelinePanel();
  renderTasksPanel();
  renderLayers();
}

// ========================================================================
// Infrastructure overlay (pillar 3)
// ========================================================================
/** Ids of every node a flow's steps touch (skipping hops to missing nodes). */
function flowNodeIds(flow: InfraFlow): Set<string> {
  const ids = new Set<string>();
  for (const s of flow.steps) {
    if (infraNodes.has(s.from)) ids.add(s.from);
    if (infraNodes.has(s.to)) ids.add(s.to);
  }
  return ids;
}

/** Draw the infra diagram: edges between node centres, then the node boxes. */
function drawInfraLayer(): SVGGElement {
  const g = svgEl("g", { class: "infra-layer" }) as SVGGElement;
  const flow = selectedFlowId ? infraFlows.get(selectedFlowId) : undefined;
  const active = flow ? flowNodeIds(flow) : null;

  // Edges first so the node boxes paint on top of the connectors. With a flow
  // selected, edges not on the flow's nodes recede so the narration reads clearly.
  for (const edge of infraEdges) {
    const a = infraNodes.get(edge.from);
    const b = infraNodes.get(edge.to);
    if (!a || !b) continue; // skip dangling edges
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const dim = active && !(active.has(edge.from) && active.has(edge.to));
    const l = line(ax, ay, bx, by);
    l.setAttribute("class", dim ? "infra-edge infra-edge-dim" : "infra-edge");
    g.append(l);
    // While a flow is selected the numbered step arrows carry the labels, so
    // suppress the base edge labels to avoid them colliding with the flow text.
    if (edge.label && !active) {
      const t = text(edge.label, (ax + bx) / 2, (ay + by) / 2 - 2, "infra-edge-label");
      g.append(t);
    }
  }

  // Group containers first so nodes nested in them paint on top.
  const ordered = [...infraNodes.values()].sort(
    (p, q) => q.width * q.height - p.width * p.height,
  );
  for (const n of ordered) {
    const node = drawInfraNode(n);
    if (active) {
      node.classList.add(active.has(n.id) ? "infra-node-active" : "infra-node-dim");
    }
    g.append(node);
  }

  // The flow's numbered, directed arrows paint on top of everything.
  if (flow) g.append(drawFlowArrows(flow));
  return g;
}

/**
 * The on-canvas renderer of a flow: walk its steps and draw a numbered directed
 * arrow from each `from` node to each `to` node, clipped to the box borders so
 * the arrowhead lands cleanly on the target. Mirrors flowToMermaid — same steps,
 * same skip-dangling rule — just rendered as geometry instead of a sequence diagram.
 */
function drawFlowArrows(flow: InfraFlow): SVGGElement {
  const g = svgEl("g", { class: "flow-arrows" }) as SVGGElement;
  flow.steps.forEach((step, i) => {
    const a = infraNodes.get(step.from);
    const b = infraNodes.get(step.to);
    if (!a || !b) return; // dangling hop — skip, mirroring the Mermaid export
    const acx = a.x + a.width / 2;
    const acy = a.y + a.height / 2;
    const bcx = b.x + b.width / 2;
    const bcy = b.y + b.height / 2;
    const start = borderPoint(a, bcx, bcy);
    const end = borderPoint(b, acx, acy);
    const reply = step.kind === "reply";
    const cls = ["flow-arrow", step.kind === "async" ? "flow-arrow-async" : "", reply ? "flow-arrow-reply" : ""]
      .filter(Boolean)
      .join(" ");
    const l = line(start.x, start.y, end.x, end.y);
    l.setAttribute("class", cls);
    g.append(l);
    g.append(arrowHead(start.x, start.y, end.x, end.y, reply));

    // Numbered badge at the arrow midpoint so the step order reads at a glance.
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const bg = svgEl("circle", {
      cx: String(mx),
      cy: String(my),
      r: "9",
      class: "flow-step-num-bg",
    });
    g.append(bg, text(String(i + 1), mx, my + 4, "flow-step-num"));
    if (step.label) g.append(text(step.label, mx + 14, my + 4, "flow-step-label"));
  });
  return g;
}

/** The point on a node's border along the ray from its centre toward (tx, ty). */
function borderPoint(
  n: InfraNode,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? n.width / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? n.height / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** A small filled triangle at (x2,y2) pointing along the (x1,y1)->(x2,y2) line. */
function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  reply: boolean,
): SVGElement {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const size = 9;
  const spread = 0.4;
  const p1 = `${x2},${y2}`;
  const p2 = `${x2 - size * Math.cos(ang - spread)},${y2 - size * Math.sin(ang - spread)}`;
  const p3 = `${x2 - size * Math.cos(ang + spread)},${y2 - size * Math.sin(ang + spread)}`;
  return svgEl("polygon", {
    points: `${p1} ${p2} ${p3}`,
    class: reply ? "flow-arrowhead flow-arrowhead-reply" : "flow-arrowhead",
  });
}

function drawInfraNode(n: InfraNode): SVGGElement {
  const g = svgEl("g", {}) as SVGGElement;
  g.dataset.infraId = n.id; // hit-test target for on-canvas infra editing
  if (n.id === selectedInfraId || n.id === linkSourceId) {
    g.classList.add("infra-node-selected");
  }
  const color = INFRA_COLORS[n.kind];

  const box = svgEl("rect", {
    x: String(n.x),
    y: String(n.y),
    width: String(n.width),
    height: String(n.height),
    rx: "8",
    class: n.kind === "group" ? "infra-box infra-group" : "infra-box",
  });
  box.setAttribute("stroke", color);
  g.append(box);

  // Left accent stripe in the kind colour.
  const accent = svgEl("rect", {
    x: String(n.x),
    y: String(n.y),
    width: "4",
    height: String(n.height),
    rx: "2",
  });
  accent.setAttribute("fill", color);
  g.append(accent);

  const kind = text(n.kind.toUpperCase(), n.x + 12, n.y + 18, "infra-kind");
  const label = text(n.label, n.x + 12, n.y + 36, "infra-label");
  g.append(kind, label);
  if (n.tech) g.append(text(n.tech, n.x + 12, n.y + 52, "infra-tech"));
  return g;
}

// ========================================================================
// On-canvas infrastructure editing — move / create / link / delete nodes.
// Gated on the source's optional infra writers; the offline fixture supports
// them in memory, so the editor works with zero setup.
// ========================================================================

/** Select an infra node for editing (design + infra selection are exclusive). */
function selectInfra(id: string | null): void {
  selectedInfraId = id;
  if (id) selectedId = null;
  render();
}

/** Add a node at the centre of the current viewport and persist it. */
async function addInfraNodeOnCanvas(): Promise<void> {
  if (!source.saveInfraNode) {
    notify("This data source is read-only for infrastructure.");
    return;
  }
  if (!showInfra) toggleInfra(); // reveal the overlay so the new node shows
  const label = (
    await promptText({
      title: "New infrastructure node",
      label: "NAME",
      placeholder: "e.g. PostgreSQL, Redis, API Gateway",
      okText: "Add node",
    })
  )?.trim();
  if (!label) return;
  // Screen centre → world coords, minus the overlay's own translation.
  const box = svg.getBoundingClientRect();
  const cx = (box.width / 2 - panX) / zoom - infraPanX;
  const cy = (box.height / 2 - panY) / zoom - infraPanY;
  const node: InfraNode = {
    id: `infra_${Date.now().toString(36)}`,
    kind: "service",
    label,
    description: "",
    x: Math.round(cx - 80),
    y: Math.round(cy - 36),
    width: 160,
    height: 72,
    parentId: null,
    updatedAt: new Date().toISOString(),
  };
  try {
    await source.saveInfraNode(node);
    selectInfra(node.id);
    notify(`Added "${label}". Drag to move; Link to connect; Del to remove.`);
  } catch (err) {
    notify(`Couldn't add node: ${(err as Error).message}`);
  }
}

/** Delete the selected infra node (and its edges) after confirmation. */
async function deleteSelectedInfra(): Promise<void> {
  const id = selectedInfraId;
  if (!id || !source.deleteInfraNode) return;
  const n = infraNodes.get(id);
  const ok = await confirmAction({
    title: "Remove infra node",
    message: `Remove infra node "${n?.label ?? id}" and its connections?`,
    okText: "Remove",
    danger: true,
  });
  if (!ok) return;
  selectedInfraId = null;
  try {
    await source.deleteInfraNode(id);
    notify("Infra node removed.");
  } catch (err) {
    notify(`Couldn't remove node: ${(err as Error).message}`);
  }
  render();
}

/** Toggle the Link tool: click two nodes to connect them with an edge. */
function toggleLink(): void {
  if (linkMode) {
    cancelLink();
    return;
  }
  if (!source.saveInfraEdge) {
    notify("This data source is read-only for infrastructure.");
    return;
  }
  if (!showInfra) toggleInfra();
  if (infraNodes.size < 2) {
    notify("Add at least two infra nodes before linking.");
    return;
  }
  linkMode = true;
  linkSourceId = null;
  render(); // the drawer's Link button now reads "Linking… click two nodes"
}

/** Leave link mode and clear any in-progress source pick. */
function cancelLink(): void {
  linkMode = false;
  linkSourceId = null;
  render();
}

/** A node was clicked while the Link tool is armed. */
function onLinkPick(id: string): void {
  if (!linkSourceId) {
    linkSourceId = id;
    const n = infraNodes.get(id);
    notify(`Link from "${n?.label ?? id}" — now click the target node.`);
    render();
    return;
  }
  void completeLink(linkSourceId, id);
}

/** Create the edge between the two picked nodes, then leave link mode. */
async function completeLink(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) {
    notify("Pick a different target node.");
    return;
  }
  const label = await promptText({
    title: "Link nodes",
    label: "EDGE LABEL (OPTIONAL)",
    placeholder: "e.g. reads/writes, publishes, calls",
    okText: "Create link",
  });
  if (label === null) {
    cancelLink();
    return; // cancelled
  }
  const edge: InfraEdge = {
    id: `edge_${Date.now().toString(36)}`,
    from: fromId,
    to: toId,
    ...(label.trim() ? { label: label.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  cancelLink();
  if (!source.saveInfraEdge) return;
  try {
    await source.saveInfraEdge(edge);
    notify("Edge added.");
  } catch (err) {
    notify(`Couldn't add edge: ${(err as Error).message}`);
  }
}

/** Collapse the floating infra inspector to just its header. */
function toggleInfraPanelCollapse(): void {
  infraPanelCollapsed = !infraPanelCollapsed;
  renderViewTools();
}

/** Collapse the floating data (ER) inspector to just its header. */
function toggleEntityPanelCollapse(): void {
  entityPanelCollapsed = !entityPanelCollapsed;
  renderViewTools();
}

/**
 * Drag a floating inspector (infra or data) by its grip / header. We move it by
 * mutating the element's inline `left`/`top` directly during the drag (rather than
 * a full re-render per mousemove) so it tracks the pointer smoothly; `onMove`
 * commits the final position back to the owning panel's state. Listeners are added
 * on mousedown and removed on mouseup, so they clean themselves up.
 */
function beginPanelDrag(
  e: MouseEvent,
  pos: { x: number; y: number },
  onMove: (x: number, y: number) => void,
): void {
  e.preventDefault();
  const start = { ox: pos.x, oy: pos.y, sx: e.clientX, sy: e.clientY };
  let active = true;
  const move = (ev: MouseEvent): void => {
    if (!active) return;
    const nx = Math.max(8, start.ox + (ev.clientX - start.sx));
    const ny = Math.max(8, start.oy + (ev.clientY - start.sy));
    onMove(nx, ny);
    if (viewToolsEl) {
      viewToolsEl.style.left = `${nx}px`;
      viewToolsEl.style.top = `${ny}px`;
    }
  };
  const up = (): void => {
    active = false;
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/** Remove a single connection (the inspector's connection ✕) and persist it. */
async function removeInfraEdge(edgeId: string): Promise<void> {
  if (!source.deleteInfraEdge) return;
  // Optimistically drop it locally so the inspector updates immediately; the
  // infra poller reconciles from the server on its next tick.
  infraEdges = infraEdges.filter((e) => e.id !== edgeId);
  render();
  try {
    await source.deleteInfraEdge(edgeId);
    notify("Connection removed.");
  } catch (err) {
    notify(`Couldn't remove connection: ${(err as Error).message}`);
  }
}

// ========================================================================
// ER (data-model) overlay (pillar 3c) — entities + crow's-foot relations.
// A standalone graph like the infra overlay; renders the same model the Flows
// panel's `entityToMermaid` exports. Gated on the source's optional entity
// writers, so a read-only source shows it but can't edit.
// ========================================================================

const ENTITY_ACCENT = "#8b6fd6"; // single accent colour for the data layer
const ENTITY_HEADER_H = 28; // name band height
const ENTITY_ROW_H = 16; // per-field row height

/** Box height that fits a header plus one row per field (kept in `height`). */
function entityHeight(fieldCount: number): number {
  return ENTITY_HEADER_H + Math.max(1, fieldCount) * ENTITY_ROW_H + 8;
}

/** Crow's-foot multiplicity as a short label drawn at a relation end. */
function cardinalityShort(c: EntityRelation["fromCardinality"]): string {
  switch (c) {
    case "zero-or-one":
      return "0..1";
    case "exactly-one":
      return "1";
    case "zero-or-many":
      return "*";
    case "one-or-many":
      return "1..*";
  }
}

/** The point on a box's border along the ray from its centre toward (tx,ty). */
function boxBorderPoint(
  b: { x: number; y: number; width: number; height: number },
  tx: number,
  ty: number,
): { x: number; y: number } {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? b.width / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? b.height / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

function drawEntityLayer(): SVGGElement {
  const g = svgEl("g", { class: "entity-layer" }) as SVGGElement;
  // Relations first so the boxes paint on top of the connectors.
  for (const r of entityRelations) g.append(...drawRelation(r));
  // Bigger boxes first so smaller ones paint on top (matches the infra overlay).
  const ordered = [...entities.values()].sort(
    (p, q) => q.width * q.height - p.width * p.height,
  );
  for (const e of ordered) g.append(drawEntityBox(e));
  return g;
}

function drawRelation(r: EntityRelation): SVGElement[] {
  const a = entities.get(r.from);
  const b = entities.get(r.to);
  if (!a || !b) return []; // skip dangling, mirroring entityToMermaid
  const acx = a.x + a.width / 2;
  const acy = a.y + a.height / 2;
  const bcx = b.x + b.width / 2;
  const bcy = b.y + b.height / 2;
  const start = boxBorderPoint(a, bcx, bcy);
  const end = boxBorderPoint(b, acx, acy);
  const selected = r.id === selectedRelationId;

  const l = line(start.x, start.y, end.x, end.y);
  l.setAttribute(
    "class",
    `${r.identifying ? "entity-rel" : "entity-rel entity-rel-dashed"}${selected ? " entity-rel-selected" : ""}`,
  );
  // A fat transparent line makes the thin relation easy to click/select.
  const hit = line(start.x, start.y, end.x, end.y);
  hit.setAttribute("class", "entity-rel-hit");
  hit.dataset.relationId = r.id;

  const out: SVGElement[] = [l, hit];
  // Cardinality just inside each endpoint; the relation verb at the midpoint.
  out.push(
    text(cardinalityShort(r.fromCardinality), start.x, start.y - 4, "entity-card"),
  );
  out.push(
    text(cardinalityShort(r.toCardinality), end.x, end.y - 4, "entity-card"),
  );
  if (r.label) {
    out.push(
      text(r.label, (start.x + end.x) / 2, (start.y + end.y) / 2 - 3, "entity-rel-label"),
    );
  }
  return out;
}

function drawEntityBox(e: Entity): SVGGElement {
  const g = svgEl("g", {}) as SVGGElement;
  g.dataset.entityId = e.id; // hit-test target for on-canvas ER editing
  if (e.id === selectedEntityId || e.id === entityLinkSourceId) {
    g.classList.add("entity-selected");
  }
  const box = svgEl("rect", {
    x: String(e.x),
    y: String(e.y),
    width: String(e.width),
    height: String(e.height),
    rx: "8",
    class: "entity-box",
  });
  box.setAttribute("stroke", ENTITY_ACCENT);
  g.append(box);

  // Header band in the accent colour with the entity name.
  const header = svgEl("rect", {
    x: String(e.x),
    y: String(e.y),
    width: String(e.width),
    height: String(ENTITY_HEADER_H),
    rx: "8",
    class: "entity-header",
  });
  header.setAttribute("fill", ENTITY_ACCENT);
  g.append(header, text(e.name, e.x + 10, e.y + 19, "entity-name"));

  // One row per field: "name: type [KEYS]".
  e.fields.forEach((f, i) => {
    const y = e.y + ENTITY_HEADER_H + (i + 1) * ENTITY_ROW_H - 3;
    const keys = f.keys.length ? `  [${f.keys.join(",")}]` : "";
    const type = f.type ? `: ${f.type}` : "";
    g.append(text(`${f.name}${type}${keys}`, e.x + 10, y, "entity-field"));
  });
  return g;
}

/** Select an entity for editing (design/infra/entity selection are exclusive). */
function selectEntity(id: string | null): void {
  selectedEntityId = id;
  if (id) {
    selectedId = null;
    selectedRelationId = null;
  }
  render();
}

/** Select a relation for editing its cardinality/label. */
function selectRelation(id: string | null): void {
  selectedRelationId = id;
  if (id) {
    selectedId = null;
    selectedEntityId = null;
  }
  render();
}

/** Add an entity at the centre of the current viewport and persist it. */
async function addEntityOnCanvas(): Promise<void> {
  if (!source.saveEntity) {
    notify("This data source is read-only for the data model.");
    return;
  }
  if (!showEntities) toggleEntities();
  const name = (
    await promptText({
      title: "New entity",
      label: "TABLE / MODEL NAME",
      placeholder: "e.g. Invoice, VehicleOwnerProfile",
      okText: "Add entity",
    })
  )?.trim();
  if (!name) return;
  const box = svg.getBoundingClientRect();
  const cx = (box.width / 2 - panX) / zoom - entityPanX;
  const cy = (box.height / 2 - panY) / zoom - entityPanY;
  const width = 180;
  const entity: Entity = {
    id: `entity_${Date.now().toString(36)}`,
    name,
    fields: [{ name: "id", type: "uuid", keys: ["PK"] }],
    description: "",
    x: Math.round(cx - width / 2),
    y: Math.round(cy - 40),
    width,
    height: entityHeight(1),
    parentId: null,
    updatedAt: new Date().toISOString(),
  };
  try {
    await source.saveEntity(entity);
    selectEntity(entity.id);
    notify(`Added "${name}". Drag to move; Relate to connect; Del to remove.`);
  } catch (err) {
    notify(`Couldn't add entity: ${(err as Error).message}`);
  }
}

/** Delete the selected entity (and its relations) after confirmation. */
async function deleteSelectedEntity(): Promise<void> {
  const id = selectedEntityId;
  if (!id || !source.deleteEntity) return;
  const e = entities.get(id);
  const ok = await confirmAction({
    title: "Remove entity",
    message: `Remove entity "${e?.name ?? id}" and its relations?`,
    okText: "Remove",
    danger: true,
  });
  if (!ok) return;
  selectedEntityId = null;
  try {
    await source.deleteEntity(id);
    notify("Entity removed.");
  } catch (err) {
    notify(`Couldn't remove entity: ${(err as Error).message}`);
  }
  render();
}

/** Delete the selected relation after confirmation. */
async function deleteSelectedRelation(): Promise<void> {
  const id = selectedRelationId;
  if (!id || !source.deleteEntityRelation) return;
  const ok = await confirmAction({
    title: "Remove relation",
    message: "Remove this relation? The entities it joins are left intact.",
    okText: "Remove",
    danger: true,
  });
  if (!ok) return;
  selectedRelationId = null;
  try {
    await source.deleteEntityRelation(id);
    notify("Relation removed.");
  } catch (err) {
    notify(`Couldn't remove relation: ${(err as Error).message}`);
  }
  render();
}

/** Remove one relation by id (the inspector's relation ✕, in Relate mode). */
async function removeEntityRelation(relationId: string): Promise<void> {
  if (!source.deleteEntityRelation) return;
  // Optimistically drop it locally; the entity poller reconciles on its next tick.
  entityRelations = entityRelations.filter((r) => r.id !== relationId);
  render();
  try {
    await source.deleteEntityRelation(relationId);
    notify("Relation removed.");
  } catch (err) {
    notify(`Couldn't remove relation: ${(err as Error).message}`);
  }
}

/** Toggle the Relate tool: click two entities to relate them. */
function toggleEntityLink(): void {
  if (entityLinkMode) {
    cancelEntityLink();
    return;
  }
  if (!source.saveEntityRelation) {
    notify("This data source is read-only for the data model.");
    return;
  }
  if (!showEntities) toggleEntities();
  if (entities.size < 2) {
    notify("Add at least two entities before relating.");
    return;
  }
  entityLinkMode = true;
  entityLinkSourceId = null;
  render();
}

/** Leave relate mode and clear any in-progress source pick. */
function cancelEntityLink(): void {
  entityLinkMode = false;
  entityLinkSourceId = null;
  render();
}

/** An entity was clicked while the Relate tool is armed. */
function onEntityLinkPick(id: string): void {
  if (!entityLinkSourceId) {
    entityLinkSourceId = id;
    const e = entities.get(id);
    notify(`Relate from "${e?.name ?? id}" — now click the target entity.`);
    render();
    return;
  }
  void completeEntityRelation(entityLinkSourceId, id);
}

/** Create the relation between the two picked entities, then leave relate mode. */
async function completeEntityRelation(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) {
    notify("Pick a different target entity.");
    return;
  }
  const label = await promptText({
    title: "Relate entities",
    label: "RELATIONSHIP VERB (OPTIONAL)",
    placeholder: 'e.g. places, holds, billed',
    okText: "Create relation",
  });
  if (label === null) {
    cancelEntityLink();
    return; // cancelled
  }
  const relation: EntityRelation = {
    id: `rel_${Date.now().toString(36)}`,
    from: fromId,
    to: toId,
    fromCardinality: "exactly-one",
    toCardinality: "zero-or-many",
    ...(label.trim() ? { label: label.trim() } : {}),
    identifying: true,
    updatedAt: new Date().toISOString(),
  };
  cancelEntityLink();
  if (!source.saveEntityRelation) return;
  try {
    await source.saveEntityRelation(relation);
    selectRelation(relation.id);
    notify("Relation added.");
  } catch (err) {
    notify(`Couldn't add relation: ${(err as Error).message}`);
  }
}

/** Apply an edit from the drawer to the selected entity and persist it. The
 * box height is kept in step with the field count so relations attach cleanly. */
function updateEntity(patch: Partial<Entity>): void {
  const id = selectedEntityId;
  if (!id || !source.saveEntity) return;
  const e = entities.get(id);
  if (!e) return;
  const updated: Entity = { ...e, ...patch, updatedAt: now() };
  if (patch.fields) updated.height = entityHeight(patch.fields.length);
  entities.set(id, updated);
  void source.saveEntity(updated);
  render();
}

/** Apply an edit from the drawer to the selected relation and persist it. */
function updateRelation(patch: Partial<EntityRelation>): void {
  const id = selectedRelationId;
  if (!id || !source.saveEntityRelation) return;
  const r = entityRelations.find((x) => x.id === id);
  if (!r) return;
  const updated: EntityRelation = { ...r, ...patch, updatedAt: now() };
  entityRelations = entityRelations.map((x) => (x.id === id ? updated : x));
  void source.saveEntityRelation(updated);
  render();
}

/** Parents before children so nested elements draw on top. */
/** Nesting depth of an element (0 = top-level), by walking its parent chain. */
function depthOf(el: DesignElement): number {
  let d = 0;
  let p = el.parentId;
  while (p) {
    d++;
    p = elements.get(p)?.parentId ?? null;
  }
  return d;
}

/**
 * The design tree in paint/stacking order: depth-first pre-order with siblings
 * sorted by their stored `z`, so every layer sits directly under its frame in the
 * DESIGN TREE and nested elements draw on top on the canvas. This is the shared
 * `paintOrder` from forward-core — the same order history/checkpoint previews use,
 * so the canvas and every reconstruction agree exactly.
 */
function ordered(): DesignElement[] {
  return paintOrder([...elements.values()]);
}

/** Next stacking value that puts a new (or raised) element on top of all others. */
function nextZ(): number {
  let max = 0;
  for (const el of elements.values()) if (el.z > max) max = el.z;
  return max + 1;
}

/** Lowest stacking value, minus one — sends an element behind all others. */
function minZ(): number {
  let min = 0;
  for (const el of elements.values()) if (el.z < min) min = el.z;
  return min - 1;
}

/** Is `el` hidden — either itself, or because an ancestor frame is hidden? */
function isHidden(el: DesignElement): boolean {
  if (hiddenIds.has(el.id)) return true;
  let p = el.parentId;
  while (p) {
    if (hiddenIds.has(p)) return true;
    p = elements.get(p)?.parentId ?? null;
  }
  return false;
}

/** Resolve display props, following an instance to its master component. */
function resolved(el: DesignElement): DesignElement {
  if (el.type === "instance" && el.componentId) {
    const master = elements.get(el.componentId);
    if (master) return { ...master, ...el, type: "instance" };
  }
  return el;
}

function drawElement(raw: DesignElement): SVGGElement {
  const el = resolved(raw);
  const g = document.createElementNS(SVG_NS, "g");
  g.dataset.id = raw.id;
  if (el.rotation) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    g.setAttribute("transform", `rotate(${el.rotation} ${cx} ${cy})`);
  }
  const style = el.style ?? {};
  const changed =
    lastSeen.has(raw.id) && lastSeen.get(raw.id) !== raw.updatedAt;
  lastSeen.set(raw.id, raw.updatedAt);
  const cls = [
    el.type === "frame" ? "el-frame" : "el-rect",
    raw.id === selectedId ? "el-selected" : "",
    changed ? "el-changed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (el.type === "text") {
    // The glyph itself has pointer-events:none, so back it with a transparent
    // hit-rect over the element's bounds — otherwise clicks fall through to
    // whatever is behind and the text can't be selected.
    const hit = svgEl("rect", {
      x: String(el.x),
      y: String(el.y),
      width: String(el.width),
      height: String(el.height),
      fill: "transparent",
      class: "el-text-hit",
    });
    g.append(hit);
    // While this element is open in the inline editor its live text lives in the
    // overlaid <textarea>; suppress the glyph so the two don't render on top of
    // each other.
    if (raw.id !== editingTextId) {
      const t = text(
        el.text ?? "Text",
        el.x,
        el.y + (style.fontSize ?? 16),
        "el-label",
      );
      t.setAttribute("font-size", String(style.fontSize ?? 16));
      t.setAttribute("font-weight", String(style.fontWeight ?? 400));
      if (style.fontFamily) t.setAttribute("font-family", style.fontFamily);
      // The glyph colour is `color`; fall back to `fill` (an older element may
      // have carried its colour there). Absent both, the theme-aware CSS default
      // (`.el-label { fill: var(--text) }`) keeps it legible on any background.
      const glyphColor = style.color ?? style.fill;
      if (glyphColor) t.style.fill = glyphColor;
      g.append(t);
    }
  } else {
    const shape = el.type === "ellipse" ? el2ellipse(el, cls, style) : el2rect(el, cls, style);
    g.append(shape);
    if (el.text && raw.id !== editingTextId) {
      const t = text(el.text, el.x + 10, el.y + el.height / 2 + 4, "el-label", true);
      if (style.fontFamily) t.setAttribute("font-family", style.fontFamily);
      if (style.color) t.style.fill = style.color;
      g.append(t);
    }
    const name = text(raw.name || raw.id, el.x, el.y - 6, "el-name");
    name.setAttribute("opacity", "0.7");
    name.setAttribute("font-size", "10");
    g.append(name);
  }

  // API documentation indicator — shown only while the "Docs" toggle is on.
  if (raw.apiBinding && showDocs) {
    g.append(badge(raw.apiBinding.title, el.x + 6, el.y + 14));
  }
  // "Generated from code" marker — on the raw element (an instance never shows
  // its master's provenance), and only at the top of each generated subtree or
  // on the selection, so a captured page isn't carpeted with badges.
  if (raw.origin && (raw.id === selectedId || !elements.get(raw.parentId ?? "")?.origin)) {
    const tag = badge("‹/› from code", el.x + el.width - 6, el.y + 14);
    tag.setAttribute("text-anchor", "end");
    tag.classList.add("el-code-badge");
    g.append(tag);
  }
  return g;
}

/**
 * Resolve the four effective corner radii: a per-corner `radii` override wins,
 * otherwise the uniform `radius` applies. Each value is clamped so opposing
 * corners can't overlap on a small element.
 */
function corners(
  el: DesignElement,
  style: NonNullable<DesignElement["style"]>,
): { tl: number; tr: number; br: number; bl: number } {
  const base = style.radius ?? 0;
  const r = style.radii ?? {};
  const max = Math.min(el.width, el.height) / 2;
  const clamp = (v: number) => Math.max(0, Math.min(v, max));
  return {
    tl: clamp(r.tl ?? base),
    tr: clamp(r.tr ?? base),
    br: clamp(r.br ?? base),
    bl: clamp(r.bl ?? base),
  };
}

/** SVG path for a rectangle with independently-rounded corners. */
function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  c: { tl: number; tr: number; br: number; bl: number },
): string {
  return [
    `M${x + c.tl},${y}`,
    `H${x + w - c.tr}`,
    c.tr ? `A${c.tr},${c.tr} 0 0 1 ${x + w},${y + c.tr}` : "",
    `V${y + h - c.br}`,
    c.br ? `A${c.br},${c.br} 0 0 1 ${x + w - c.br},${y + h}` : "",
    `H${x + c.bl}`,
    c.bl ? `A${c.bl},${c.bl} 0 0 1 ${x},${y + h - c.bl}` : "",
    `V${y + c.tl}`,
    c.tl ? `A${c.tl},${c.tl} 0 0 1 ${x + c.tl},${y}` : "",
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Resolve the four effective side border widths (per-side override wins). */
function sideWidths(
  style: NonNullable<DesignElement["style"]>,
): { top: number; right: number; bottom: number; left: number } {
  const base = style.strokeWidth ?? 0;
  const s = style.strokeWidths ?? {};
  return {
    top: s.top ?? base,
    right: s.right ?? base,
    bottom: s.bottom ?? base,
    left: s.left ?? base,
  };
}

/**
 * SVG `stroke-dasharray` for a border line style, scaled to the line width.
 * Returns "none" for solid, a pattern for dashed/dotted, or null to leave the
 * existing (CSS) dashing untouched when no style was chosen.
 */
function dashArray(
  strokeStyle: NonNullable<DesignElement["style"]>["strokeStyle"],
  w: number,
): string | null {
  if (strokeStyle === undefined) return null;
  if (strokeStyle === "dashed") return `${Math.max(w * 2, 4)} ${Math.max(w * 1.5, 3)}`;
  if (strokeStyle === "dotted") return `0 ${Math.max(w * 2, 3)}`; // round caps → dots
  return "none"; // solid
}

/** Apply stroke colour, width, and dash style to a single (uniform) outline. */
function applyStroke(
  shape: SVGElement,
  style: NonNullable<DesignElement["style"]>,
  width: number | null,
): void {
  if (style.stroke) shape.style.stroke = style.stroke;
  if (width != null) shape.setAttribute("stroke-width", String(width));
  const dash = dashArray(style.strokeStyle, width ?? 1);
  if (dash !== null) {
    shape.setAttribute("stroke-dasharray", dash);
    if (style.strokeStyle === "dotted") shape.setAttribute("stroke-linecap", "round");
  }
}

function el2rect(
  el: DesignElement,
  cls: string,
  style: NonNullable<DesignElement["style"]>,
): SVGElement {
  const c = corners(el, style);
  // A uniform radius renders as a plain <rect> (cheaper, crisper); only fall
  // back to a <path> when the corners actually differ.
  const uniformR = c.tl === c.tr && c.tr === c.br && c.br === c.bl;
  const makeShape = (): SVGElement =>
    uniformR
      ? (svgEl("rect", {
          x: String(el.x),
          y: String(el.y),
          width: String(el.width),
          height: String(el.height),
          rx: String(c.tl),
          class: cls,
        }) as SVGRectElement)
      : (svgEl("path", {
          d: roundedRectPath(el.x, el.y, el.width, el.height, c),
          class: cls,
        }) as SVGPathElement);

  const sw = sideWidths(style);
  const perSide =
    style.strokeWidths != null &&
    !(sw.top === sw.right && sw.right === sw.bottom && sw.bottom === sw.left);

  if (!perSide) {
    const shape = makeShape();
    // Inline style (not a presentation attribute) so a custom color overrides the
    // .el-rect/.el-selected stylesheet rules, which would otherwise win.
    if (style.fill) shape.style.fill = style.fill;
    applyStroke(shape, style, style.strokeWidth ?? null);
    return shape;
  }

  // Per-side widths can't ride on one outline, so draw a stroke-less fill plus
  // one line per non-zero side, inset to the corner radii so each segment meets
  // the rounded fill cleanly. Selection still reads via the separate sel-box.
  const g = svgEl("g", {}) as SVGGElement;
  const fill = makeShape();
  if (style.fill) fill.style.fill = style.fill;
  fill.style.stroke = "none";
  g.append(fill);

  const color = style.stroke || "#2d313c";
  const { x, y, width: w, height: h } = el;
  const edges: Array<[number, number, number, number, number]> = [
    [sw.top, x + c.tl, y, x + w - c.tr, y],
    [sw.right, x + w, y + c.tr, x + w, y + h - c.br],
    [sw.bottom, x + w - c.br, y + h, x + c.bl, y + h],
    [sw.left, x, y + h - c.bl, x, y + c.tl],
  ];
  for (const [width, x1, y1, x2, y2] of edges) {
    if (width <= 0) continue;
    const line = svgEl("line", {
      x1: String(x1),
      y1: String(y1),
      x2: String(x2),
      y2: String(y2),
    });
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(width));
    const dash = dashArray(style.strokeStyle, width);
    if (dash !== null) {
      line.setAttribute("stroke-dasharray", dash);
      if (style.strokeStyle === "dotted") line.setAttribute("stroke-linecap", "round");
    }
    g.append(line);
  }
  return g;
}

/** Like el2rect, but draws an ellipse filling the element's bounding box. */
function el2ellipse(
  el: DesignElement,
  cls: string,
  style: NonNullable<DesignElement["style"]>,
): SVGEllipseElement {
  const e = svgEl("ellipse", {
    cx: String(el.x + el.width / 2),
    cy: String(el.y + el.height / 2),
    rx: String(el.width / 2),
    ry: String(el.height / 2),
    class: cls,
  }) as SVGEllipseElement;
  if (style.fill) e.style.fill = style.fill;
  applyStroke(e, style, style.strokeWidth ?? null); // per-side N/A for an ellipse
  return e;
}

function handles(el: DesignElement): SVGElement[] {
  const r = resolved(el);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  // Wrap the handles in a group rotated with the element so they track the
  // (visually rotated) box corners and top edge.
  const g = svgEl("g", { class: "handles" }) as SVGGElement;
  if (r.rotation) g.setAttribute("transform", `rotate(${r.rotation} ${cx} ${cy})`);

  // A thin outline around the bounds makes the selection legible even for text
  // elements (which have no shape of their own to recolor).
  const outline = svgEl("rect", {
    x: String(r.x),
    y: String(r.y),
    width: String(r.width),
    height: String(r.height),
    class: "sel-box",
  });

  const se = svgEl("rect", {
    x: String(r.x + r.width - 4),
    y: String(r.y + r.height - 4),
    width: "8",
    height: "8",
    rx: "2",
    class: "handle",
  });
  se.dataset.handle = "se";

  // Rotate knob: a small circle on a stem above the top-center of the box.
  const stem = svgEl("line", {
    x1: String(cx),
    y1: String(r.y),
    x2: String(cx),
    y2: String(r.y - 20),
    class: "rotate-stem",
  });
  const knob = svgEl("circle", {
    cx: String(cx),
    cy: String(r.y - 24),
    r: "4.5",
    class: "rotate-knob",
  });
  knob.dataset.handle = "rotate";

  g.append(outline, stem, knob, se);
  return [g];
}

/**
 * Draw a single leader line from a documented element out to a label box, in
 * the anime.js callout style: anchor on the element's right edge → short stub →
 * rise → label. World-space, so it pans/zooms with the design. The label is
 * clickable (carries data-id) so it selects the element and opens its docs.
 */
function drawDocLeader(raw: DesignElement): SVGGElement {
  const el = resolved(raw);
  const b = raw.apiBinding;
  if (!b) return svgEl("g", {}) as SVGGElement;

  // Docs-first: the binding only carries { title, description }. We render the
  // title as a method + path header when it reads like one ("POST /api/checkout"),
  // otherwise the whole title is the heading. The Markdown body fills the card.
  const title = b.title.trim();
  const m = /^(GET|POST|PUT|PATCH|DELETE)\b\s*(.*)$/i.exec(title);
  const method = m ? (m[1] ?? "").toUpperCase() : "";
  const heading = (m ? (m[2] ?? "").trim() : title) || title;
  const desc = b.description.trim();

  // Anchor at the right-edge midpoint; a short horizontal stub leads to the card,
  // whose left edge meets the line. World-space, so it pans/zooms with the design.
  const ax = el.x + el.width;
  const ay = el.y + el.height / 2;
  const stub = ax + 30;
  const cardW = 262;
  const cardX = stub;
  const cardY = ay - 34;
  const cardH = 150;

  const g = svgEl("g", { class: "doc-leader" }) as SVGGElement;
  g.dataset.id = raw.id;

  g.append(
    svgEl("polyline", {
      points: `${ax},${ay} ${stub},${ay} ${cardX},${ay}`,
      class: "doc-leader-line",
    }),
  );
  g.append(
    svgEl("circle", { cx: String(ax), cy: String(ay), r: "3", class: "doc-leader-dot" }),
  );

  // The card is HTML (clean text wrapping for the body) inside a foreignObject.
  const fo = svgEl("foreignObject", {
    x: String(cardX),
    y: String(cardY),
    width: String(cardW),
    height: String(cardH),
    class: "doc-card-fo",
  });
  const card = document.createElementNS(XHTML_NS, "div");
  card.setAttribute("class", "doc-card");
  card.dataset.id = raw.id;

  const head = document.createElementNS(XHTML_NS, "div");
  head.setAttribute("class", "doc-card-head");
  const dot = document.createElementNS(XHTML_NS, "span");
  dot.setAttribute("class", "doc-card-dot");
  head.append(dot);
  if (method) {
    const badge = document.createElementNS(XHTML_NS, "span");
    badge.setAttribute("class", "doc-card-method");
    badge.textContent = method;
    head.append(badge);
  }
  const path = document.createElementNS(XHTML_NS, "span");
  path.setAttribute("class", "doc-card-path");
  path.textContent = heading;
  head.append(path);
  card.append(head);

  if (desc) {
    const body = document.createElementNS(XHTML_NS, "div");
    body.setAttribute("class", "doc-card-desc");
    body.textContent = desc;
    card.append(body);
  }

  fo.append(card);
  g.append(fo);
  return g;
}

// ========================================================================
// Pointer interaction
// ========================================================================
/** Apply the in-flight gesture at a screen point. Split out from the pointermove
 * listener so the edge auto-scroll loop can re-run it from the held pointer
 * position as the world scrolls. `e` need only carry the pointer coordinates and
 * shift state — a real PointerEvent or the loop's synthetic point both work. */
function applyGesture(
  e: { clientX: number; clientY: number; shiftKey: boolean },
  box?: DOMRect,
): void {
  if (!gesture) return;

  if (gesture.kind === "pan") {
    const ddx = e.clientX - gesture.startX;
    const ddy = e.clientY - gesture.startY;
    if (Math.abs(ddx) > 3 || Math.abs(ddy) > 3) gesture.moved = true;
    panX = gesture.origPanX + ddx;
    panY = gesture.origPanY + ddy;
    render();
    return;
  }

  if (gesture.kind === "infra-pan") {
    // The overlay sits inside the zoomed viewport, so convert screen pixels to
    // world units for 1:1 tracking with the cursor.
    infraPanX = gesture.origX + (e.clientX - gesture.startX) / zoom;
    infraPanY = gesture.origY + (e.clientY - gesture.startY) / zoom;
    render();
    return;
  }

  if (gesture.kind === "infra-move") {
    const cur = toCanvas(e, box);
    const n = infraNodes.get(gesture.id);
    if (!n) return;
    const nx = gesture.origX + (cur.x - gesture.startX);
    const ny = gesture.origY + (cur.y - gesture.startY);
    if (nx !== n.x || ny !== n.y) gesture.moved = true;
    infraNodes.set(gesture.id, { ...n, x: nx, y: ny });
    render();
    return;
  }

  if (gesture.kind === "entity-pan") {
    entityPanX = gesture.origX + (e.clientX - gesture.startX) / zoom;
    entityPanY = gesture.origY + (e.clientY - gesture.startY) / zoom;
    render();
    return;
  }

  if (gesture.kind === "entity-move") {
    const cur = toCanvas(e, box);
    const en = entities.get(gesture.id);
    if (!en) return;
    const nx = gesture.origX + (cur.x - gesture.startX);
    const ny = gesture.origY + (cur.y - gesture.startY);
    if (nx !== en.x || ny !== en.y) gesture.moved = true;
    entities.set(gesture.id, { ...en, x: nx, y: ny });
    render();
    return;
  }

  const pt = toCanvas(e, box);
  const el = elements.get(gesture.id);
  if (!el) return;

  if (gesture.kind === "rotate") {
    // Angle from the element center to the pointer; 0° points straight up.
    let deg = (Math.atan2(pt.x - gesture.cx, -(pt.y - gesture.cy)) * 180) / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    update(gesture.id, { rotation: Math.round(deg) });
    render();
    return;
  }

  const dx = pt.x - gesture.startX;
  const dy = pt.y - gesture.startY;

  if (gesture.kind === "create") {
    update(gesture.id, {
      x: Math.min(gesture.startX, pt.x),
      y: Math.min(gesture.startY, pt.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    });
  } else if (gesture.kind === "move") {
    const moved: Rect = {
      x: gesture.orig.x + dx,
      y: gesture.orig.y + dy,
      width: gesture.orig.width,
      height: gesture.orig.height,
    };
    const s = snap(moved, otherRects(gesture.id));
    guides = { v: s.vGuides, h: s.hGuides };
    applyMove(gesture.id, moved.x + s.dx - el.x, moved.y + s.dy - el.y);
  } else {
    update(gesture.id, {
      width: Math.max(8, gesture.orig.width + dx),
      height: Math.max(8, gesture.orig.height + dy),
    });
  }
  render();
}

/** Wire the SVG pointer gestures (called by mountCanvas). These live on the svg
 * element, which is discarded when the Shadow DOM is cleared, so they need no
 * explicit removal. */
function bindPointer(): void {
svg.addEventListener("pointerdown", (e) => {
  cancelViewAnim(); // a user gesture wins over an in-flight camera glide
  const pt = toCanvas(e);
  const handleEl = (e.target as Element).closest("[data-handle]");
  const elEl = (e.target as Element).closest("[data-id]");

  if (tool !== "select") {
    const id = `el_${Date.now().toString(36)}`;
    gesture = {
      kind: "create",
      type: tool,
      startX: pt.x,
      startY: pt.y,
      id,
    };
    elements.set(id, newElement(id, tool, pt.x, pt.y));
    select(id);
    svg.setPointerCapture(e.pointerId);
    return;
  }

  if (handleEl && selectedId) {
    const orig = elements.get(selectedId);
    if (orig) {
      if ((handleEl as SVGElement).dataset.handle === "rotate") {
        const r = rectOf(orig);
        gesture = {
          kind: "rotate",
          id: selectedId,
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
          origRotation: orig.rotation ?? 0,
        };
      } else {
        gesture = {
          kind: "resize",
          id: selectedId,
          startX: pt.x,
          startY: pt.y,
          orig: rectOf(orig),
        };
      }
    }
    svg.setPointerCapture(e.pointerId);
    return;
  }

  if (elEl instanceof SVGElement && elEl.dataset.id) {
    const id = elEl.dataset.id;
    select(id);
    const orig = elements.get(id);
    if (orig)
      gesture = {
        kind: "move",
        id,
        startX: pt.x,
        startY: pt.y,
        orig: rectOf(orig),
      };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  // An infra node (drawn on top of the design) is the editor's hit target: in
  // link mode it's an endpoint to connect; otherwise it's selected and dragged.
  const infraEl = (e.target as Element).closest("[data-infra-id]");
  if (
    showInfra &&
    infraEl instanceof SVGElement &&
    infraEl.dataset.infraId
  ) {
    const id = infraEl.dataset.infraId;
    if (linkMode) {
      onLinkPick(id);
      return;
    }
    selectInfra(id);
    const n = infraNodes.get(id);
    if (n && source.saveInfraNode) {
      gesture = {
        kind: "infra-move",
        id,
        startX: pt.x,
        startY: pt.y,
        origX: n.x,
        origY: n.y,
        moved: false,
      };
      svg.setPointerCapture(e.pointerId);
    }
    return;
  }

  // Grabbing the infra overlay elsewhere (an edge/label) drags it on its own
  // translation, leaving the design (and the viewport pan) untouched.
  if (showInfra && (e.target as Element).closest(".infra-layer")) {
    gesture = {
      kind: "infra-pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: infraPanX,
      origY: infraPanY,
    };
    svg.classList.add("panning");
    svg.setPointerCapture(e.pointerId);
    return;
  }

  // An entity box is the ER editor's hit target: in relate mode it's an endpoint
  // to connect; otherwise it's selected and dragged.
  const entityEl = (e.target as Element).closest("[data-entity-id]");
  if (showEntities && entityEl instanceof SVGElement && entityEl.dataset.entityId) {
    const id = entityEl.dataset.entityId;
    if (entityLinkMode) {
      onEntityLinkPick(id);
      return;
    }
    selectEntity(id);
    const en = entities.get(id);
    if (en && source.saveEntity) {
      gesture = {
        kind: "entity-move",
        id,
        startX: pt.x,
        startY: pt.y,
        origX: en.x,
        origY: en.y,
        moved: false,
      };
      svg.setPointerCapture(e.pointerId);
    }
    return;
  }

  // Clicking a relation line (its fat transparent hit area) selects it.
  const relEl = (e.target as Element).closest("[data-relation-id]");
  if (showEntities && relEl instanceof SVGElement && relEl.dataset.relationId) {
    if (!entityLinkMode) selectRelation(relEl.dataset.relationId);
    return;
  }

  // Grabbing the ER overlay elsewhere drags it on its own translation.
  if (showEntities && (e.target as Element).closest(".entity-layer")) {
    gesture = {
      kind: "entity-pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: entityPanX,
      origY: entityPanY,
    };
    svg.classList.add("panning");
    svg.setPointerCapture(e.pointerId);
    return;
  }

  // Empty space: start a pan. A click with no movement deselects on pointerup.
  gesture = {
    kind: "pan",
    startX: e.clientX,
    startY: e.clientY,
    origPanX: panX,
    origPanY: panY,
    moved: false,
  };
  svg.classList.add("panning");
  svg.setPointerCapture(e.pointerId);
});

// Double-clicking a text element (or any element with a text label) edits its
// text in place on the canvas.
svg.addEventListener("dblclick", (e) => {
  if (tool !== "select") return;
  const elEl = (e.target as Element).closest("[data-id]");
  if (!(elEl instanceof SVGElement) || !elEl.dataset.id) return;
  const el = elements.get(elEl.dataset.id);
  if (!el) return;
  e.preventDefault();
  select(el.id);
  beginTextEdit(el.id);
});

svg.addEventListener("pointermove", (e) => {
  // One layout read shared between the gesture math and the edge-scroll check.
  const box = svg.getBoundingClientRect();
  if (gesture) {
    applyGesture(e, box);
    // A content drag near a viewport edge scrolls the canvas to reveal more.
    if (isDragGesture(gesture)) updateEdgeScroll(e.clientX, e.clientY, e.shiftKey, box);
    return;
  }
  // No gesture: when hover-scroll is enabled, a bare cursor resting near an edge
  // scrolls to reveal off-screen designs. updateEdgeScroll zeroes the velocity —
  // stopping the loop — once the cursor pulls back toward the middle.
  if (hoverScrollEnabled) updateEdgeScroll(e.clientX, e.clientY, e.shiftKey, box);
});

svg.addEventListener("pointerup", () => {
  if (!gesture) return;
  stopEdgeScroll();

  if (gesture.kind === "pan") {
    svg.classList.remove("panning");
    if (!gesture.moved) {
      // A plain click on empty space deselects (and cancels an in-flight link).
      if (linkMode) cancelLink();
      if (entityLinkMode) cancelEntityLink();
      selectInfra(null);
      selectEntity(null);
      selectRelation(null);
      select(null);
    }
    gesture = null;
    return;
  }

  if (gesture.kind === "infra-pan" || gesture.kind === "entity-pan") {
    svg.classList.remove("panning");
    gesture = null;
    return;
  }

  if (gesture.kind === "infra-move") {
    const { id, moved } = gesture;
    gesture = null;
    if (moved && source.saveInfraNode) {
      const n = infraNodes.get(id);
      if (n)
        void source.saveInfraNode({
          ...n,
          x: Math.round(n.x),
          y: Math.round(n.y),
          updatedAt: new Date().toISOString(),
        });
    }
    return;
  }

  if (gesture.kind === "entity-move") {
    const { id, moved } = gesture;
    gesture = null;
    if (moved && source.saveEntity) {
      const en = entities.get(id);
      if (en)
        void source.saveEntity({
          ...en,
          x: Math.round(en.x),
          y: Math.round(en.y),
          updatedAt: new Date().toISOString(),
        });
    }
    return;
  }

  const el = elements.get(gesture.id);
  const wasMove = gesture.kind === "move";
  guides = { v: [], h: [] };
  // A click that selects without moving or resizing changes nothing: don't
  // write (or re-nest) the element. A no-op save would still re-parent it and
  // stamp it, which turns an untouched code draft into a false import conflict.
  const untouched =
    el !== undefined &&
    (((gesture.kind === "move" || gesture.kind === "resize") && sameRect(rectOf(el), gesture.orig)) ||
      (gesture.kind === "rotate" && (el.rotation ?? 0) === gesture.origRotation));
  if (el && !untouched) {
    // On drop, recompute nesting and persist.
    const now = new Date().toISOString();
    const parentId = findParent(rectOf(el), el.id, elements.values());
    const finalEl = { ...el, parentId, updatedAt: now };
    elements.set(el.id, finalEl);
    void persistElement(finalEl);
    // A move drags the element's whole subtree along (see applyMove). Persist
    // the shifted descendants too, or the next sync reverts them to their old
    // stored positions and they appear to "fall out" of the moved frame.
    if (wasMove) {
      for (const cid of descendants(el.id, elements.values())) {
        const child = elements.get(cid);
        if (!child) continue;
        const movedChild = { ...child, updatedAt: now };
        elements.set(cid, movedChild);
        void persistElement(movedChild);
      }
    }
  }
  if (gesture.kind === "create") setTool("select");
  gesture = null;
  render();
});

// A cancelled/lost pointer (touch interrupted, or capture yanked when the
// canvas unmounts mid-drag) must not leave the auto-scroll loop spinning after
// the drag is gone.
svg.addEventListener("pointercancel", () => stopEdgeScroll());
svg.addEventListener("lostpointercapture", () => stopEdgeScroll());
// Bare-hover edge scroll holds no pointer capture, so a cursor that leaves the
// canvas must stop the loop or it would pan forever. A drag keeps capture and is
// ended by pointerup instead, so leave it running while a gesture is in flight.
svg.addEventListener("pointerleave", () => {
  if (!gesture) stopEdgeScroll();
});

// Track the element under the pointer so a documented one shows its doc leader
// on hover. Skip while a gesture is in flight to avoid churn during drags.
svg.addEventListener("pointerover", (e) => {
  if (gesture) return;
  const elEl = (e.target as Element).closest?.("[data-id]");
  const id = elEl instanceof SVGElement ? (elEl.dataset.id ?? null) : null;
  if (id !== hoverId) {
    hoverId = id;
    if (showDocs) render();
  }
});

// Right-click the design layer: on an element it offers selection actions (make
// component / place instance / delete); on empty canvas it offers "Add element"
// (the catalog), placing the new shape where you clicked.
svg.addEventListener("contextmenu", (e) => {
  // The "Add element" / element-action menu is a design-layer affordance only. The
  // infra/data (and other) views draw their own graphs on this same <svg>, so keep
  // the native menu there instead of offering to add design shapes.
  if (view !== "design") {
    closeContextMenu();
    return;
  }
  e.preventDefault();
  const elEl = (e.target as Element).closest?.("[data-id]");
  const id = elEl instanceof SVGElement ? elEl.dataset.id : undefined;
  const pt = toCanvas(e);
  if (id) {
    select(id);
    openElementMenu(id, pt.x, pt.y, e.clientX, e.clientY);
  } else {
    openAddMenu(pt.x, pt.y, e.clientX, e.clientY);
  }
});
} // end bindPointer

/** Append a clickable row (icon + label) to the open context menu. */
function ctxItem(
  icon: SVGElement,
  label: string,
  run: () => void,
  opts: { shortcut?: string; danger?: boolean } = {},
): void {
  const b = document.createElement("button");
  b.className = opts.danger ? "ctx-item ctx-item--danger" : "ctx-item";
  b.append(icon);
  const span = document.createElement("span");
  span.className = "ctx-label";
  span.textContent = label;
  b.append(span);
  if (opts.shortcut) {
    const sc = document.createElement("span");
    sc.className = "ctx-shortcut";
    sc.textContent = opts.shortcut;
    b.append(sc);
  }
  b.addEventListener("click", () => {
    closeContextMenu();
    run();
  });
  ctxMenuEl.append(b);
}

/** A thin divider between groups of context-menu items. */
function ctxSep(): void {
  const d = document.createElement("div");
  d.className = "ctx-sep";
  ctxMenuEl.append(d);
}

/** Append a non-interactive section label to the open context menu. */
function ctxHeader(label: string): void {
  const h = document.createElement("div");
  h.className = "ctx-head";
  h.textContent = label;
  ctxMenuEl.append(h);
}

/** Unhide the menu and clamp it inside the canvas root. clientX/Y are viewport
 * coords; the root (position:relative) is the offset parent. */
function showMenuAt(clientX: number, clientY: number): void {
  const root = ctxMenuEl.parentElement as HTMLElement;
  const box = root.getBoundingClientRect();
  ctxMenuEl.hidden = false; // unhide first so offsetWidth/Height are measurable
  const x = Math.min(clientX - box.left, box.width - ctxMenuEl.offsetWidth - 6);
  const y = Math.min(clientY - box.top, box.height - ctxMenuEl.offsetHeight - 6);
  ctxMenuEl.style.left = `${Math.max(4, x)}px`;
  ctxMenuEl.style.top = `${Math.max(4, y)}px`;
}

/** The menu for a right-clicked element. Mirrors the design: the shape catalog
 * (each inserted *as a child* of this element — "ADD TO <NAME>"), then the
 * element actions (make component / place instance, delete). Built fresh each
 * open so item availability reflects the selection. */
function openElementMenu(
  id: string,
  canvasX: number,
  canvasY: number,
  clientX: number,
  clientY: number,
): void {
  const el = elements.get(id);
  if (!el) return;
  ctxMenuEl.replaceChildren();
  ctxHeader(`Add to ${el.name}`);
  for (const { type, label, key, icon } of ELEMENT_CATALOG) {
    ctxItem(icon(), label, () => addElementAt(type, canvasX, canvasY, id), {
      shortcut: key.toUpperCase(),
    });
  }
  ctxSep();
  ctxItem(docsIcon(), el.apiBinding ? "Edit API docs" : "Add API docs", () =>
    openApiDocsFor(id),
  );
  ctxItem(linkIcon(), "Copy @adc anchor", () => copyAnchor(id));
  if (el.origin) {
    ctxItem(compIcon(), "Adopt draft from code", () => adoptDraft(id));
  }
  if (el.type !== "component" && el.type !== "instance") {
    ctxItem(compIcon(), "Make component", makeComponent);
  }
  if (el.type === "component") {
    ctxItem(instIcon(), "Place instance", placeInstance);
  }
  ctxSep();
  ctxItem(frontIcon(), "Bring to front", bringToFront);
  ctxItem(backIcon(), "Send to back", sendToBack);
  ctxSep();
  ctxItem(delIcon(), "Delete", deleteSelected, {
    shortcut: "⌫",
    danger: true,
  });
  showMenuAt(clientX, clientY);
}

/** The empty-canvas menu — one row per catalog entry, inserting at the
 * right-clicked point (nested by geometry). Grows with ELEMENT_CATALOG. */
function openAddMenu(
  canvasX: number,
  canvasY: number,
  clientX: number,
  clientY: number,
): void {
  ctxMenuEl.replaceChildren();
  ctxHeader("Add element");
  for (const { type, label, key, icon } of ELEMENT_CATALOG) {
    ctxItem(icon(), label, () => addElementAt(type, canvasX, canvasY), {
      shortcut: key.toUpperCase(),
    });
  }
  showMenuAt(clientX, clientY);
}

function closeContextMenu(): void {
  if (ctxMenuEl && !ctxMenuEl.hidden) ctxMenuEl.hidden = true;
}

/** Sensible default footprint for a point-and-place insert (the Add menu skips
 * the drag-to-size step that the keyboard-armed draw tools use). */
function defaultSize(type: ElementType): [number, number] {
  switch (type) {
    case "frame":
      return [240, 160];
    case "text":
      return [120, 24];
    case "ellipse":
      return [96, 96];
    default:
      return [140, 88]; // rectangle + future shapes
  }
}

/** Create a default-sized element at a canvas point, nest it under any frame it
 * lands in, persist, and select it. */
function addElementAt(
  type: ElementType,
  x: number,
  y: number,
  forceParentId?: string,
): void {
  const id = `el_${Date.now().toString(36)}`;
  const [w, h] = defaultSize(type);
  const sized: DesignElement = {
    ...newElement(id, type, Math.round(x), Math.round(y)),
    width: w,
    height: h,
  };
  // From the element menu the new shape nests under the right-clicked element
  // ("ADD TO <NAME>"); from the empty-canvas menu it nests by geometry.
  const parentId =
    forceParentId ?? findParent(rectOf(sized), id, elements.values());
  const final = { ...sized, parentId, updatedAt: new Date().toISOString() };
  elements.set(id, final);
  void persistElement(final);
  select(id);
}

/** Wire global keyboard shortcuts (called by mountCanvas; detached by destroy). */
function bindKeyboard(): void {
// Dismiss the context menu on any pointer activity outside it.
on(window, "pointerdown", (e) => {
  if (!e.composedPath().includes(ctxMenuEl)) closeContextMenu();
});

on(window, "keydown", (e) => {
  // ⌘S / Ctrl-S opens the save-checkpoint modal — handled even while typing so
  // it never falls through to the browser's "save page" dialog.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    if (source.createCheckpoint) {
      e.preventDefault();
      openSaveModal();
    }
    return;
  }
  // Esc closes the save modal first (it's the topmost layer when open).
  if (e.key === "Escape" && !saveModalEl.hidden) {
    closeSaveModal();
    return;
  }
  // Read the real innermost target via composedPath: the canvas lives in a
  // Shadow DOM, so events bubbling to window have e.target retargeted to the
  // shadow host — that would hide the panel's <input> and let Delete/Backspace
  // delete the selected element while the user is editing X/Y/W/H/Rotate.
  const target = (e.composedPath()[0] ?? e.target) as HTMLElement;
  if (isTypingTarget(target)) return;
  if (e.key === "Escape") {
    closeContextMenu();
    if (linkMode) cancelLink();
    if (entityLinkMode) cancelEntityLink();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedInfraId) {
      void deleteSelectedInfra();
    } else if (selectedEntityId) {
      void deleteSelectedEntity();
    } else if (selectedRelationId) {
      void deleteSelectedRelation();
    } else if (selectedId) {
      deleteSelected();
    }
    return;
  }
  // Single-key shortcuts, ignored when modified so they don't
  // clash with browser/OS chords. "v" is select/move; the rest arm a draw tool
  // from the catalog (then drag to size). Same catalog as the Add menu.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "v") {
    setTool("select");
    e.preventDefault();
    return;
  }
  const entry = ELEMENT_CATALOG.find((c) => c.key === key);
  if (entry) {
    setTool(entry.type);
    e.preventDefault();
  }
});
} // end bindKeyboard

/** True when keystrokes should be left to a focused text field, not handled as
 * canvas shortcuts. */
function isTypingTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

// ========================================================================
// Mutations
// ========================================================================
function newElement(
  id: string,
  type: ElementType,
  x: number,
  y: number,
): DesignElement {
  return DesignElement.parse({
    id,
    type,
    name: `${type} ${id.slice(-4)}`,
    x,
    y,
    width: type === "text" ? 120 : 8,
    height: type === "text" ? 24 : 8,
    parentId: null,
    z: nextZ(), // newest element stacks on top, matching draw-on-create order
    text: type === "text" ? "Text" : undefined,
    style:
      type === "frame"
        ? { fill: "#161a24", stroke: "#3a4250", radius: 8 }
        : type === "rectangle"
          ? { fill: "#1b2030", stroke: "#3a4250", radius: 6 }
          : type === "ellipse"
            ? { fill: "#1b2030", stroke: "#3a4250" }
            : { fontSize: 16 },
    updatedAt: new Date().toISOString(),
  });
}

function update(id: string, patch: Partial<DesignElement>): void {
  const el = elements.get(id);
  if (!el) return;
  elements.set(id, { ...el, ...patch });
}

/** Move an element and all of its descendants by a delta. */
function applyMove(id: string, dx: number, dy: number): void {
  const ids = [id, ...descendants(id, elements.values())];
  for (const cid of ids) {
    const el = elements.get(cid);
    if (el) elements.set(cid, { ...el, x: el.x + dx, y: el.y + dy });
  }
}

function select(id: string | null): void {
  selectedId = id;
  if (id) selectedInfraId = null; // design + infra selection are exclusive
  render();
}

// ---- inline text editing ------------------------------------------------
/** Open an in-place <textarea> over a text element (or any element carrying a
 * text label) so its content — newlines and all — can be edited on the canvas.
 * Blur / ⌘Enter commits; Escape cancels. */
function beginTextEdit(id: string): void {
  const el = elements.get(id);
  if (!el) return;
  finishTextEdit(true); // tear down any editor already open
  editingTextId = id;

  const style = el.style ?? {};
  const fontSize = style.fontSize ?? 16;
  const ta = document.createElement("textarea");
  ta.className = "fwd-text-editor";
  ta.value = el.text ?? "";
  // Position + size it to overlay the element in screen space (world → screen is
  // `world * zoom + pan`; the textarea sits inside #stage, which the SVG fills).
  // A text element's glyph starts at its top-left; a shape's label is inset 10px
  // and vertically centered, so line the editor up with wherever the label sits.
  const isTextEl = el.type === "text";
  const worldX = isTextEl ? el.x : el.x + 10;
  const worldY = isTextEl ? el.y : el.y + el.height / 2 - fontSize;
  Object.assign(ta.style, {
    position: "absolute",
    left: `${worldX * zoom + panX}px`,
    top: `${worldY * zoom + panY}px`,
    width: `${Math.max(isTextEl ? el.width : el.width - 20, 40) * zoom}px`,
    fontSize: `${fontSize * zoom}px`,
    fontFamily: style.fontFamily || "inherit",
    fontWeight: String(style.fontWeight ?? 400),
    // Match the glyph: color, else the legacy fill, else the CSS theme default.
    color: style.color ?? style.fill ?? "",
  });
  stageEl.append(ta);
  textEditor = ta;
  render(); // suppress the glyph now hidden behind the editor

  const grow = () => {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };
  grow();
  ta.addEventListener("input", grow);
  // Keystrokes here are for the textarea, not canvas shortcuts (delete, tool
  // hotkeys, etc.); Enter inserts a newline as usual.
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finishTextEdit(true);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finishTextEdit(false);
    }
  });
  ta.addEventListener("blur", () => finishTextEdit(false));
  ta.focus();
  ta.select();
}

/** Close the inline editor, committing its text unless `cancel`. Safe to call
 * when no editor is open. */
function finishTextEdit(cancel: boolean): void {
  const ta = textEditor;
  const id = editingTextId;
  textEditor = null; // clear first so the blur that `remove()` fires no-ops
  editingTextId = null;
  if (!ta) return;
  const value = ta.value;
  ta.remove();
  if (!cancel && id) {
    const el = elements.get(id);
    if (el && (el.text ?? "") !== value) {
      const patch: Partial<DesignElement> = { text: value };
      // Grow a text element's box to fit its lines so selection + hit area wrap
      // the whole thing (other shapes keep their author-set height).
      if (el.type === "text") {
        const fontSize = el.style?.fontSize ?? 16;
        const lines = Math.max(value.split("\n").length, 1);
        patch.height = Math.round(lines * fontSize * 1.2);
      }
      const updated = { ...el, ...patch, updatedAt: now() };
      elements.set(id, updated);
      void persistElement(updated);
    }
  }
  render();
}

// ========================================================================
// Layers sidebar (the "DESIGN TREE")
// ========================================================================

/** The tree-row glyph for each element type, reusing the rail/menu icons. */
function layerTypeIcon(type: ElementType): SVGElement {
  switch (type) {
    case "frame":
      return frameIcon();
    case "ellipse":
      return ellipseIcon();
    case "text":
      return textIcon();
    case "component":
      return compIcon();
    case "instance":
      return instIcon();
    default:
      return rectIcon();
  }
}

/** Show or hide the left Layers sidebar, reflowing the grid to match. */
function toggleLayers(): void {
  // From another view, the Layers button returns to the design workspace with
  // the sidebar open; within the design view it toggles the sidebar.
  if (view !== "design") {
    layersOpen = true;
    setView("design");
    return;
  }
  layersOpen = !layersOpen;
  canvasRootEl?.classList.toggle("layers-open", layersOpen);
  syncRailActive();
  renderLayers();
}

/** Hide/show a single element on the canvas (view-only, not persisted). */
function toggleHidden(id: string): void {
  if (hiddenIds.has(id)) hiddenIds.delete(id);
  else hiddenIds.add(id);
  render(); // re-paints the canvas (render() also calls renderLayers())
}

/** Rebuild the DESIGN TREE rows from the current elements + selection. */
function renderLayers(): void {
  if (!layersBodyEl) return;
  // Drop hidden ids whose element is gone (delete / restore / poll), so the set
  // never leaks stale ids across the various element-removal paths.
  for (const id of hiddenIds) if (!elements.has(id)) hiddenIds.delete(id);
  if (layersCountEl) layersCountEl.textContent = `${elements.size}`;
  layersBodyEl.replaceChildren();
  const label = document.createElement("div");
  label.className = "fwd-tree-label";
  label.textContent = "DESIGN TREE";
  layersBodyEl.append(label);

  for (const el of ordered()) {
    const row = document.createElement("div");
    row.className = "fwd-layer-row";
    if (el.id === selectedId) row.classList.add("selected");
    if (hiddenIds.has(el.id)) row.classList.add("hidden");

    const indent = document.createElement("span");
    indent.className = "fwd-layer-indent";
    indent.style.width = `${depthOf(el) * 14}px`;
    row.append(indent);

    row.append(layerTypeIcon(el.type));

    const name = document.createElement("span");
    name.className = "fwd-layer-name";
    name.textContent = el.name;
    row.append(name);

    if (el.apiBinding) {
      const dot = document.createElement("span");
      dot.className = "fwd-layer-dot";
      row.append(dot);
    }

    const eye = document.createElement("button");
    eye.className = "fwd-layer-eye";
    eye.type = "button";
    eye.title = hiddenIds.has(el.id) ? "Show" : "Hide";
    eye.append(hiddenIds.has(el.id) ? eyeOffIcon() : eyeIcon());
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleHidden(el.id);
    });
    row.append(eye);

    row.addEventListener("click", () => {
      select(el.id);
      revealElement(el.id); // glide the canvas to it if it's off-screen
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      select(el.id);
      openElementMenu(el.id, el.x, el.y, e.clientX, e.clientY);
    });
    layersBodyEl.append(row);
  }
}

function deleteSelected(): void {
  if (!selectedId) return;
  const id = selectedId;
  for (const cid of [id, ...descendants(id, elements.values())]) {
    elements.delete(cid);
    hiddenIds.delete(cid); // don't leak a stale hidden id
    // A genuinely in-flight upsert can land after this delete and resurrect the
    // row; tombstone it so the write's resolution issues a compensating delete.
    // (A failed/queued write is cleared below, so the retry loop skips it.)
    if (inflightWrites.has(cid) && !failedWrites.has(cid)) pendingDeletes.add(cid);
    inflightWrites.delete(cid);
    failedWrites.delete(cid);
    writeSeq.delete(cid);
    inflightDocs.delete(cid);
    failedDocs.delete(cid);
    docSeq.delete(cid);
    unsavedDocIds.delete(cid);
    draftDocIds.delete(cid);
    void source.deleteElement(cid);
  }
  select(null);
}

/**
 * Copy a ready-to-paste `@adc` anchor for an element to the clipboard, so a
 * developer never has to transcribe the opaque element id. The id is the stable
 * link; the element name rides along as a human-readable, quote-delimited label
 * (`// @adc el_xxx "Login button"`). The `//` comment is parsed regardless of
 * the destination file's language — the anchor reader is comment-agnostic.
 */
function copyAnchor(id: string): void {
  const el = elements.get(id);
  if (!el) return;
  // A quoted label can't hold a double-quote (it would close the label early);
  // soften any in the name so the pasted anchor stays well-formed.
  const label = el.name.trim().replace(/"/g, "'");
  const anchor = `// @adc ${el.id}${label ? ` "${label}"` : ""}`;
  if (!navigator.clipboard) {
    notify("Clipboard isn't available here — copy the id from the inspector.");
    return;
  }
  void navigator.clipboard.writeText(anchor).then(
    () => notify(`Copied anchor: ${anchor}`),
    () => notify("Couldn't copy the anchor to the clipboard."),
  );
}

function makeComponent(): void {
  if (!selectedId) return;
  const el = elements.get(selectedId);
  if (!el) return;
  const updated = { ...el, type: "component" as const, updatedAt: now() };
  elements.set(el.id, updated);
  void persistElement(updated);
  render();
}

/**
 * Adopt a draft generated from code — the element and every generated element
 * nested in it: drop `origin` so a later import never updates them. The store
 * removes a stored origin whenever a save leaves it out.
 */
function adoptDraft(id: string): void {
  const ids = [id, ...descendants(id, elements.values())];
  let count = 0;
  for (const target of ids) {
    const el = elements.get(target);
    if (!el?.origin) continue;
    const { origin: _origin, ...rest } = el;
    const adopted = { ...rest, updatedAt: now() };
    elements.set(target, adopted);
    void persistElement(adopted);
    count++;
  }
  render();
  notify(count === 1 ? "Draft adopted." : `${count} drafts adopted.`);
}

/** Restack the selected element and persist the new `z` (front = on top). */
function restack(id: string, z: number): void {
  const el = elements.get(id);
  if (!el || el.z === z) return;
  const updated = { ...el, z, updatedAt: now() };
  elements.set(id, updated);
  void persistElement(updated);
  render();
}

function bringToFront(): void {
  if (selectedId) restack(selectedId, nextZ());
}

function sendToBack(): void {
  if (selectedId) restack(selectedId, minZ());
}

function placeInstance(): void {
  if (!selectedId) return;
  const master = elements.get(selectedId);
  if (!master || master.type !== "component") {
    notify("Select a component first (◆ Comp), then place an instance.");
    return;
  }
  const id = `el_${Date.now().toString(36)}`;
  const inst = DesignElement.parse({
    ...master,
    id,
    type: "instance",
    componentId: master.id,
    name: `${master.name} instance`,
    x: master.x + 24,
    y: master.y + 24,
    parentId: null,
    z: nextZ(), // a freshly placed instance sits on top
    apiBinding: undefined,
    origin: undefined, // a hand-placed copy is not a code draft
    updatedAt: now(),
  });
  elements.set(id, inst);
  void persistElement(inst);
  select(id);
}

// ========================================================================
// Properties + API panel
// ========================================================================
/** Wire the top-right inspector toggle: paint its icon and flip `inspectorOpen`
 * on click. The inspector starts hidden and only this button reveals it. */
function wireInspectorToggle(): void {
  const btn = uiRoot.querySelector("#inspectorToggle") as HTMLButtonElement | null;
  if (!btn) return;
  btn.replaceChildren(inspectorIcon());
  btn.addEventListener("click", toggleInspector);
  syncInspectorToggle();
}

/** Toggle the right Inspector drawer open/closed and repaint it. */
function toggleInspector(): void {
  inspectorOpen = !inspectorOpen;
  syncInspectorToggle();
  renderSelectionPanel();
}

/** Reflect `inspectorOpen` on the top-right toggle button. */
function syncInspectorToggle(): void {
  const btn = uiRoot.querySelector("#inspectorToggle") as HTMLButtonElement | null;
  if (!btn) return;
  btn.classList.toggle("active", inspectorOpen);
  btn.setAttribute("aria-pressed", String(inspectorOpen));
}

/** Context-menu "Add/Edit API docs": seed a minimal binding if the element has
 * none (the same seed the panel's "Add documentation" button writes), open the
 * inspector, and land focus in the docs section's title field. */
function openApiDocsFor(id: string): void {
  const el = elements.get(id);
  if (!el) return;
  if (!el.apiBinding) {
    const updated = {
      ...el,
      apiBinding: { title: el.name || el.id, description: "" },
      updatedAt: now(),
    };
    elements.set(id, updated);
    // A local draft (the server strips a binding sent via saveElement); it's
    // committed by "Save documentation" and shielded from polls until then.
    unsavedDocIds.add(id);
    draftDocIds.add(id); // fresh seed — nothing on the server to unbind yet
  }
  if (!inspectorOpen) {
    inspectorOpen = true;
    syncInspectorToggle();
  }
  select(id); // render() repaints the canvas and rebuilds the drawer
  const title = panel.querySelector<HTMLInputElement>(".panel-section--docs input");
  title?.focus();
  title?.select();
}

/** Show or hide the right drawer, collapsing its grid column when hidden so the
 * stage reclaims the space (an explicit grid track keeps `display:none` alone
 * from closing the gap). */
function setPanelHidden(hidden: boolean): void {
  panel.hidden = hidden;
  canvasRootEl?.classList.toggle("panel-collapsed", hidden);
}

/** True when keyboard focus is inside an editable inspector field (INPUT /
 * TEXTAREA / SELECT). While one is focused, a rebuild would `replaceChildren()`
 * the field out from under the user and discard keystrokes that only commit on
 * blur — so background re-renders (data polls) skip the panel rebuild. */
function isPanelFieldFocused(): boolean {
  const active = uiRoot?.activeElement;
  if (!active || !panel.contains(active)) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function renderSelectionPanel(): void {
  // A poll-driven render() must not rebuild the inspector while the user is
  // mid-edit in one of its fields: the docs textarea (and the name/number
  // inputs) only write back on blur, so replaceChildren() here would wipe text
  // that hasn't been committed yet. The panel already reflects the selected
  // element; leave it intact and let the next render (after blur) rebuild it.
  if (isPanelFieldFocused()) return;
  // The right drawer carries only the design inspector and the Theme editor now.
  // Theme is allowed to take it over in *any* view; every other non-design view
  // suppresses the drawer entirely (their tools live in the view itself).
  setPanelHidden(false);
  if (showTheme) {
    renderThemeView(panel, theme, {
      onClose: toggleTheme,
      onChange: (patch) => setTheme({ ...theme, ...patch }),
      onApplyPreset: ({ name: _name, ...palette }: ThemePreset) =>
        setTheme({ ...theme, ...palette }),
    });
    return;
  }
  if (view !== "design") {
    setPanelHidden(true);
    return;
  }
  // Design mode: the inspector is revealed only via the top-right toggle —
  // selecting an element no longer auto-opens it. When closed, keep the drawer
  // collapsed and skip the (now-pointless) render work.
  setPanelHidden(!inspectorOpen);
  if (!inspectorOpen) return;
  const el = selectedId ? elements.get(selectedId) : undefined;
  const tl = selectedId ? (timelines.get(selectedId) ?? []) : [];
  // Explicit "Save documentation" — only offered when the source records history.
  const onDocument = source.documentElement
    ? (binding: ApiBinding) => {
        const id = selectedId;
        if (!id) return;
        const current = elements.get(id);
        if (!current) return;
        // First-ever doc save → "created"; any prior entry → "modified".
        const action = (timelines.get(id) ?? []).length === 0 ? "created" : "modified";
        const version = `v${(timelines.get(id) ?? []).length + 1}`;
        const changeLog =
          action === "created" ? "Documented API" : "Updated API documentation";
        // Keep the in-memory binding in step with what we version, then persist.
        elements.set(id, { ...current, apiBinding: binding, updatedAt: now() });
        render();
        // render() rebuilt the panel, wiping any inline button state — surface
        // the toast afterwards, and only claim "saved" once the server confirms;
        // a write that failed (connection down) is queued and announced as such.
        void persistDoc(id, binding, { version, changeLog, action }).then((outcome) => {
          if (outcome === "saved") notify("Documentation saved.");
          else if (outcome === "queued")
            notify("Connection lost — documentation queued; it will sync when back online.");
        });
      }
    : undefined;
  renderPanel(
    panel,
    el,
    tl,
    (patch) => {
      if (!selectedId) return;
      const id = selectedId;
      const current = elements.get(id);
      if (!current) return;
      const updated = { ...current, ...patch, updatedAt: now() };
      elements.set(id, updated);

      // The apiBinding is NOT a saveElement field — the server owns it via
      // bind()/unbind() (so it can version it) and strips anything sent through
      // saveElement. Route binding changes accordingly instead of persisting the
      // element (which would revert them on the write-adopt + next poll).
      if ("apiBinding" in patch) {
        if (patch.apiBinding === undefined) {
          const neverCommitted = draftDocIds.delete(id);
          unsavedDocIds.delete(id);
          if (!neverCommitted && current.apiBinding) {
            // A committed binding: unbind on the server (appends a "deleted" entry).
            void persistUndoc(id, current.apiBinding.title).then((o) =>
              notify(
                o === "saved"
                  ? "Documentation removed."
                  : "Connection lost — could not remove documentation.",
              ),
            );
          } else {
            notify("Documentation removed."); // an uncommitted draft — dropped locally
          }
        } else {
          // Seed/edit a draft binding: it lives locally (shielded from polls) until
          // "Save documentation" commits it. A patch onto a previously-undocumented
          // element is a fresh seed with nothing yet on the server to unbind.
          if (!current.apiBinding) draftDocIds.add(id);
          unsavedDocIds.add(id);
        }
        render();
        return;
      }

      void persistElement(updated);
      render();
    },
    onDocument,
    toggleInspector,
    el?.origin ? () => adoptDraft(el.id) : undefined,
  );
}

/**
 * The infra / data editing tools. They used to live in the right drawer; now
 * that those views are full-area takeovers they ride in a floating panel inside
 * the view itself. Reuses the same renderInfraPanel / renderEntityPanel builders,
 * just retargeted to the in-stage `#viewtools` container.
 */
function renderViewTools(): void {
  if (!viewToolsEl) return;
  const show = view === "infra" || view === "data";
  viewToolsEl.hidden = !show;
  // Both inspectors share the `ifp` floating-card layout (flex column, own-scroll
  // body); each is positioned via inline left/top from its own panel state.
  viewToolsEl.classList.toggle("ifp", show);
  if (!show) {
    viewToolsEl.replaceChildren();
    return;
  }
  if (view === "infra") {
    viewToolsEl.style.left = `${infraPanelPos.x}px`;
    viewToolsEl.style.top = `${infraPanelPos.y}px`;
    renderInfraPanel(viewToolsEl, {
      canEdit: Boolean(source.saveInfraNode),
      canLink: Boolean(source.saveInfraEdge),
      canUnlink: Boolean(source.deleteInfraEdge),
      linking: linkMode,
      linkSourceName: linkSourceId ? infraNodes.get(linkSourceId)?.label : undefined,
      nodes: [...infraNodes.values()],
      edges: infraEdges,
      node: selectedInfraId ? infraNodes.get(selectedInfraId) : undefined,
      search: infraSearch,
      typeFilter: infraTypeFilter,
      collapsed: infraPanelCollapsed,
      onSearch: (q) => {
        infraSearch = q;
        renderViewTools();
        // The panel DOM is rebuilt on each keystroke, so restore focus + caret
        // to the freshly-created search input to keep typing uninterrupted.
        const input = viewToolsEl.querySelector<HTMLInputElement>(".ifp-search input");
        if (input) {
          input.focus();
          const end = input.value.length;
          input.setSelectionRange(end, end);
        }
      },
      onFilter: (kind) => {
        infraTypeFilter = kind;
        renderViewTools();
      },
      onAddNode: () => void addInfraNodeOnCanvas(),
      onToggleLink: toggleLink,
      onToggleCollapse: toggleInfraPanelCollapse,
      onDragStart: (e) =>
        beginPanelDrag(e, infraPanelPos, (x, y) => {
          infraPanelPos = { x, y };
        }),
      // While the Link tool is armed, a list click picks a link endpoint (same as
      // clicking the node on the canvas); otherwise it opens the node's detail.
      onSelectNode: (id) => {
        if (id && linkMode) onLinkPick(id);
        else selectInfra(id);
      },
      onChangeNode: updateInfraNode,
      onRemoveNode: () => void deleteSelectedInfra(),
      onRemoveEdge: (id) => void removeInfraEdge(id),
    });
  } else {
    viewToolsEl.style.left = `${entityPanelPos.x}px`;
    viewToolsEl.style.top = `${entityPanelPos.y}px`;
    renderEntityPanel(viewToolsEl, {
      canEdit: Boolean(source.saveEntity),
      canRelate: Boolean(source.saveEntityRelation),
      canUnrelate: Boolean(source.deleteEntityRelation),
      relating: entityLinkMode,
      relateSourceName: entityLinkSourceId
        ? entities.get(entityLinkSourceId)?.name
        : undefined,
      collapsed: entityPanelCollapsed,
      entities: [...entities.values()],
      relations: entityRelations,
      entity: selectedEntityId ? entities.get(selectedEntityId) : undefined,
      relation: selectedRelationId
        ? entityRelations.find((r) => r.id === selectedRelationId)
        : undefined,
      search: entitySearch,
      entityName: (id) => entities.get(id)?.name ?? id,
      onSearch: (q) => {
        entitySearch = q;
        renderViewTools();
        // Restore focus + caret after the per-keystroke rebuild (see infra above).
        const input = viewToolsEl.querySelector<HTMLInputElement>(".ifp-search input");
        if (input) {
          input.focus();
          const end = input.value.length;
          input.setSelectionRange(end, end);
        }
      },
      onToggleCollapse: toggleEntityPanelCollapse,
      onDragStart: (e) =>
        beginPanelDrag(e, entityPanelPos, (x, y) => {
          entityPanelPos = { x, y };
        }),
      onAddEntity: () => void addEntityOnCanvas(),
      onViewDiagram: viewEntityDiagram,
      onToggleRelate: toggleEntityLink,
      // While the Relate tool is armed, a list click picks a relation endpoint;
      // otherwise it opens the entity's detail.
      onSelectEntity: (id) => {
        if (id && entityLinkMode) onEntityLinkPick(id);
        else selectEntity(id);
      },
      onSelectRelation: (id) => selectRelation(id),
      onChangeEntity: updateEntity,
      onRemoveEntity: () => void deleteSelectedEntity(),
      onChangeRelation: updateRelation,
      onRemoveRelation: () => void deleteSelectedRelation(),
      onRemoveRelationById: (id) => void removeEntityRelation(id),
    });
  }
}

// ========================================================================
// Member roster (the Member view)
// ========================================================================

/** Fetch the project's member roster for the Member view. */
async function loadMembers(): Promise<void> {
  if (!source.listMembers) {
    members = [];
    renderMemberPanel();
    return;
  }
  membersLoading = true;
  membersError = undefined;
  renderMemberPanel();
  try {
    members = await source.listMembers();
  } catch (err) {
    membersError = (err as Error).message;
  } finally {
    membersLoading = false;
    renderMemberPanel();
  }
}

function renderMemberPanel(): void {
  if (!memberEl) return;
  const show = view === "member";
  memberEl.hidden = !show;
  if (!show) {
    memberEl.replaceChildren();
    return;
  }
  renderMemberView(
    memberEl,
    {
      members,
      loading: membersLoading,
      error: membersError,
    },
    {
      onClose: () => setView("design"),
      onReload: () => void loadMembers(),
    },
  );
}

// ========================================================================
// Theme (local view preference: background/accent chrome + grid)
// ========================================================================

/** Replace the theme, apply it live, persist it, and refresh the drawer. */
function setTheme(next: CanvasTheme): void {
  theme = next;
  applyTheme();
  saveTheme();
  if (showTheme) renderSelectionPanel();
}

/** Push the current theme onto the canvas: the full UI palette as CSS custom
 * properties on the shadow host (so `:host` defaults are overridden) plus the
 * grid on/off class. This recolours the editor chrome but never the shapes,
 * which carry their own per-element fill/stroke. */
function applyTheme(): void {
  const hostStyle = (uiRoot.host as HTMLElement).style;
  for (const [cssVar, value] of Object.entries(themeVars(theme))) {
    hostStyle.setProperty(cssVar, value);
  }
  svg.classList.toggle("no-grid", !theme.grid);
  // The History overlay still has dark-tuned hardcoded colours; on a light
  // palette (e.g. "Paper") flip its text/buttons to dark via .theme-light.
  canvasRootEl?.classList.toggle("theme-light", isLightColor(theme.bg));
}

/** Map the palette fields onto their CSS custom-property names. */
function themeVars(t: CanvasTheme): Record<string, string> {
  return {
    "--bg": t.bg,
    "--bg-strip": t.bgStrip,
    "--bg-rail": t.bgRail,
    "--bg-panel": t.bgPanel,
    "--surface": t.surface,
    "--surface-2": t.surface2,
    "--surface-3": t.surface3,
    "--surface-4": t.surface4,
    "--line": t.line,
    "--line-2": t.line2,
    "--line-3": t.line3,
    "--text": t.text,
    "--text-2": t.text2,
    "--text-3": t.text3,
    "--muted": t.muted,
    "--muted-2": t.muted2,
    "--faint": t.faint,
    "--accent": t.accent,
  };
}

/** True when a hex colour is light enough to need dark foreground text on it. */
function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Perceived luminance (ITU-R BT.601); >0.6 ⇒ a light backdrop.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/** Load the saved theme for this project from localStorage, if any. */
function loadTheme(): void {
  if (!themeStorageKey) return;
  try {
    const raw = window.localStorage.getItem(themeStorageKey);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<CanvasTheme>;
    // Ignore themes saved under the old (shape-fill) model: a full palette has a
    // `bg` field. Older saves lack it and would corrupt the new chrome vars.
    if (typeof saved.bg !== "string") return;
    theme = { ...theme, ...saved };
  } catch {
    // Corrupt/blocked storage just falls back to the default theme.
  }
}

function saveTheme(): void {
  if (!themeStorageKey) return;
  try {
    window.localStorage.setItem(themeStorageKey, JSON.stringify(theme));
  } catch {
    // Storage unavailable (private mode, quota) — theme stays in-memory.
  }
}

/** Apply an edit from the infra drawer to the selected node and persist it. */
function updateInfraNode(patch: Partial<InfraNode>): void {
  const id = selectedInfraId;
  if (!id || !source.saveInfraNode) return;
  const n = infraNodes.get(id);
  if (!n) return;
  const updated = { ...n, ...patch, updatedAt: now() };
  infraNodes.set(id, updated);
  void source.saveInfraNode(updated);
  render();
}

// ========================================================================
// Project endpoint timeline (git-graph + catch-up digest)
// ========================================================================
function renderTimelinePanel(): void {
  historyEl.hidden = !showTimeline;
  if (!showTimeline) return;

  // The History timeline merges the server activity feed (design/api/infra/flow)
  // with the manual checkpoints, grouped by domain on a date-rail. Selecting an
  // event deep-links its element on the canvas; restoring rewinds a checkpoint.
  renderTimelineView(
    historyEl,
    projectTimeline,
    checkpoints,
    { elements, timelines, infraNodes, infraEdges, infraFlows },
    {
      onSelectElement: (id) => {
        if (elements.has(id)) {
          select(id);
          toggleTimeline(); // leave the History view to reveal the canvas selection
        }
      },
      onRestore: (id) => {
        void restoreCheckpoint(id);
      },
      ...(source.deleteCheckpoint
        ? {
            onDelete: (id: string) => {
              void deleteCheckpoint(id);
            },
          }
        : {}),
      renderMermaid: async (src) => {
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render(`hist_${++flowSeq}`, src);
        return svg;
      },
      onClose: toggleTimeline,
    },
  );
}

// ========================================================================
// Checkpoints (manual canvas snapshots) — Save button + save modal
// ========================================================================

/** Wire the top-strip Save button; shown only when checkpoints are supported. */
function wireSaveButton(): void {
  if (!saveBtnEl) return;
  if (!source.createCheckpoint) {
    saveBtnEl.hidden = true;
    return;
  }
  saveBtnEl.hidden = false;
  saveBtnEl.replaceChildren(saveGlyph(), document.createTextNode("Save design checkpoint"));
  saveBtnEl.addEventListener("click", openSaveModal);
  updateSavedLabel();
}

/** Refresh the "saved …" stamp from the most-recent checkpoint. */
function updateSavedLabel(): void {
  if (!savedLabelEl) return;
  const latest = checkpoints[0];
  savedLabelEl.textContent = latest
    ? `saved ${relTime(Date.parse(latest.createdAt))}`
    : "";
}

function openSaveModal(): void {
  if (!source.createCheckpoint) return;
  saveDraft = { title: "", description: "", tag: "checkpoint" };
  renderSaveModal();
}

function closeSaveModal(): void {
  saveModalEl.hidden = true;
  saveModalEl.replaceChildren();
}

async function commitSave(): Promise<void> {
  if (!source.createCheckpoint) return;
  const title = saveDraft.title.trim();
  if (!title) return;
  const input: CheckpointInput = {
    title,
    description: saveDraft.description.trim(),
    tag: saveDraft.tag,
  };
  closeSaveModal();
  try {
    await source.createCheckpoint(input);
  } catch (err) {
    console.warn("[canvas] save checkpoint failed:", err);
  }
}

async function restoreCheckpoint(id: string): Promise<void> {
  if (!source.restoreCheckpoint) return;
  const cp = checkpoints.find((c) => c.id === id);
  try {
    await source.restoreCheckpoint(id);
  } catch (err) {
    console.warn("[canvas] restore checkpoint failed:", err);
    return;
  }
  // A restore replaces (not merges) the design + infra, so reconcile the local
  // maps authoritatively from the snapshot we already hold — the merge-only
  // poller would otherwise leave behind elements the restore dropped, until the
  // next poll. (Infra polling already full-replaces, but design polling merges.)
  if (cp) {
    const snap = cp.snapshot;
    elements.clear();
    for (const el of snap.elements) elements.set(el.id, el);
    if (selectedId && !elements.has(selectedId)) selectedId = null;
    infraNodes.clear();
    for (const n of snap.infraNodes) infraNodes.set(n.id, n);
    infraEdges = snap.infraEdges;
    infraFlows.clear();
    for (const f of snap.infraFlows) infraFlows.set(f.id, f);
    if (selectedFlowId && !infraFlows.has(selectedFlowId)) selectedFlowId = null;
    if (selectedInfraId && !infraNodes.has(selectedInfraId)) selectedInfraId = null;
    render();
  }
}

async function deleteCheckpoint(id: string): Promise<void> {
  if (!source.deleteCheckpoint) return;
  try {
    await source.deleteCheckpoint(id);
  } catch (err) {
    console.warn("[canvas] delete checkpoint failed:", err);
  }
}

const TAG_OPTS: Array<{ key: CheckpointTag; label: string }> = [
  { key: "milestone", label: "Milestone" },
  { key: "checkpoint", label: "Checkpoint" },
  { key: "wip", label: "WIP" },
];

// ------------------------------------------------------------------------
// Async dialogs (a webview-safe replacement for window.prompt/confirm)
//
// VS Code webviews block the synchronous window.prompt/confirm/alert, and a
// synchronous modal can't work in any case. These render a small modal into
// #dialog (in the Shadow DOM, reusing the .fwd-modal styles) and resolve a
// Promise on OK / Cancel / Escape / backdrop — so the canvas authors infra,
// entities and flows the same way whether it's served by `forward serve`, exported for Pages, or in
// the VS Code extension.
// ------------------------------------------------------------------------

/** Tear down whatever dialog is open. */
function closeDialog(): void {
  dialogEl.hidden = true;
  dialogEl.replaceChildren();
}

/**
 * Build the shared modal chrome (backdrop + card + head). `onResolve` is invoked
 * (once) with the dialog's result for the dismiss paths (backdrop, Escape); the
 * caller wires OK/Cancel buttons into the returned body/footer.
 */
function dialogShell<T>(
  title: string,
  dismissValue: T,
  resolve: (v: T) => void,
): { body: HTMLElement; foot: HTMLElement } {
  dialogEl.hidden = false;
  dialogEl.replaceChildren();

  let done = false;
  const finish = (v: T): void => {
    if (done) return;
    done = true;
    closeDialog();
    document.removeEventListener("keydown", onKey, true);
    resolve(v);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(dismissValue);
    }
  };
  document.addEventListener("keydown", onKey, true);

  const backdrop = document.createElement("div");
  backdrop.className = "fwd-modal-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) finish(dismissValue);
  });
  const card = document.createElement("div");
  card.className = "fwd-modal";
  const head = document.createElement("div");
  head.className = "fwd-modal-head";
  const titleEl = document.createElement("div");
  titleEl.className = "fwd-modal-title";
  titleEl.append(spanEl("", "fwd-modal-dot"), spanEl(title));
  head.append(titleEl, spanEl("forward / canvas", "fwd-modal-sub"));

  const body = document.createElement("div");
  body.className = "fwd-modal-body";
  const foot = document.createElement("div");
  foot.className = "fwd-modal-foot";

  card.append(head, body, foot);
  backdrop.append(card);
  dialogEl.append(backdrop);

  // Expose finish to the caller through the body/foot closures below.
  (body as HTMLElement & { _finish?: (v: T) => void })._finish = finish;
  (foot as HTMLElement & { _finish?: (v: T) => void })._finish = finish;
  return { body, foot };
}

/** Ask for a line of text. Resolves the trimmed string, or null if cancelled. */
function promptText(opts: {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  okText?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const { body, foot } = dialogShell<string | null>(opts.title, null, resolve);
    const finish = (foot as HTMLElement & { _finish: (v: string | null) => void })._finish;

    if (opts.label) body.append(fieldLabel(opts.label));
    const input = document.createElement("input");
    input.className = "fwd-modal-input";
    input.value = opts.value ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    // OK/Enter resolve the entered string (possibly empty, for optional fields);
    // only the dismiss paths (Cancel / Escape / backdrop) resolve null.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(input.value.trim());
      }
    });
    body.append(input);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "fwd-modal-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => finish(null));
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "fwd-modal-save";
    ok.textContent = opts.okText ?? "OK";
    ok.addEventListener("click", () => finish(input.value.trim()));
    foot.append(cancel, ok);
    requestAnimationFrame(() => input.focus());
  });
}

/** Ask a yes/no question. Resolves true on confirm, false otherwise. */
function confirmAction(opts: {
  title: string;
  message: string;
  okText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const { body, foot } = dialogShell<boolean>(opts.title, false, resolve);
    const finish = (foot as HTMLElement & { _finish: (v: boolean) => void })._finish;

    body.append(spanEl(opts.message, "fwd-modal-message"));

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "fwd-modal-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => finish(false));
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = opts.danger ? "fwd-modal-save fwd-modal-danger" : "fwd-modal-save";
    ok.textContent = opts.okText ?? "OK";
    ok.addEventListener("click", () => finish(true));
    foot.append(cancel, ok);
    requestAnimationFrame(() => ok.focus());
  });
}

/** Build the save-checkpoint modal imperatively into #savemodal. */
function renderSaveModal(): void {
  saveModalEl.hidden = false;
  saveModalEl.replaceChildren();

  const backdrop = document.createElement("div");
  backdrop.className = "fwd-modal-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeSaveModal();
  });

  const card = document.createElement("div");
  card.className = "fwd-modal";

  const head = document.createElement("div");
  head.className = "fwd-modal-head";
  const title = document.createElement("div");
  title.className = "fwd-modal-title";
  title.append(spanEl("", "fwd-modal-dot"), spanEl("Save checkpoint"));
  const sub = spanEl("forward / canvas", "fwd-modal-sub");
  head.append(title, sub);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "fwd-modal-body";

  // Title field
  bodyWrap.append(fieldLabel("TITLE"));
  const titleInput = document.createElement("input");
  titleInput.className = "fwd-modal-input";
  titleInput.placeholder = "e.g. Decline state for Pay button";
  titleInput.value = saveDraft.title;
  titleInput.addEventListener("input", () => {
    saveDraft.title = titleInput.value;
    saveBtn.disabled = !titleInput.value.trim();
  });
  bodyWrap.append(titleInput);

  // Description field
  bodyWrap.append(fieldLabel("DESCRIPTION"));
  const desc = document.createElement("textarea");
  desc.className = "fwd-modal-textarea";
  desc.rows = 4;
  desc.placeholder =
    "What changed and why — context for whoever opens this next.";
  desc.value = saveDraft.description;
  desc.addEventListener("input", () => {
    saveDraft.description = desc.value;
  });
  bodyWrap.append(desc);

  // Tag chips
  bodyWrap.append(fieldLabel("LABEL"));
  const tags = document.createElement("div");
  tags.className = "fwd-modal-tags";
  for (const opt of TAG_OPTS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "fwd-tag-chip";
    chip.textContent = opt.label;
    chip.classList.toggle("active", saveDraft.tag === opt.key);
    chip.addEventListener("click", () => {
      saveDraft.tag = opt.key;
      for (const c of Array.from(tags.children)) c.classList.remove("active");
      chip.classList.add("active");
    });
    tags.append(chip);
  }
  bodyWrap.append(tags);

  // "Included in this save" summary
  const summary = document.createElement("div");
  summary.className = "fwd-modal-summary";
  summary.append(fieldLabel("INCLUDED IN THIS SAVE"));
  const chips = document.createElement("div");
  chips.className = "fwd-summary-chips";
  for (const label of [
    `${elements.size} element${elements.size === 1 ? "" : "s"}`,
    `${infraNodes.size} infra node${infraNodes.size === 1 ? "" : "s"}`,
    `${infraFlows.size} flow${infraFlows.size === 1 ? "" : "s"}`,
  ]) {
    chips.append(spanEl(label, "fwd-summary-chip"));
  }
  summary.append(chips);
  bodyWrap.append(summary);

  // Footer
  const foot = document.createElement("div");
  foot.className = "fwd-modal-foot";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "fwd-modal-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeSaveModal);
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "fwd-modal-save";
  saveBtn.textContent = "Save checkpoint";
  saveBtn.disabled = !saveDraft.title.trim();
  saveBtn.addEventListener("click", () => void commitSave());
  foot.append(cancel, saveBtn);

  card.append(head, bodyWrap, foot);
  backdrop.append(card);
  saveModalEl.append(backdrop);
  titleInput.focus();
}

function fieldLabel(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fwd-field-label";
  el.textContent = text;
  return el;
}

function spanEl(text: string, cls = ""): HTMLSpanElement {
  const s = document.createElement("span");
  if (cls) s.className = cls;
  if (text) s.textContent = text;
  return s;
}

/** A floppy-disk glyph for the Save button. */
function saveGlyph(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", "M5 4h11l3 3v13H5zM8 4v5h7M8 20v-6h8v6");
  svg.append(p);
  return svg;
}

/** The viewer's calendar date as `YYYY-MM-DD` (local time, not UTC). */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Render the task tracker. The list links into the design/infra layers: when an
 * element or flow is selected it offers a "only linked to selection" filter, and
 * new tasks created from here are pre-linked to that selection. Re-runs on every
 * render() so the filter tracks the live selection.
 */
function renderTasksPanel(): void {
  tasksEl.hidden = !showTasks;
  if (!showTasks || !source.subscribeTasks) return;
  tasksEl.classList.toggle("tk-wide", taskMode === "timeline");

  // Derive the current focus (a selected element or flow) for filtering + the
  // pre-link on new tasks.
  const selEl = selectedId ? elements.get(selectedId) : undefined;
  const focusFlow = selectedFlowId ? infraFlows.get(selectedFlowId) : undefined;
  const focus = {
    ...(selEl ? { elementId: selEl.id } : {}),
    ...(focusFlow ? { flowId: focusFlow.id } : {}),
    ...(selEl
      ? { label: selEl.name || selEl.id }
      : focusFlow
        ? { label: focusFlow.name }
        : {}),
  };
  const hasFocus = Boolean(focus.elementId || focus.flowId);

  let list = [...tasks.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  if (hasFocus && taskFilterLinked) {
    list = list.filter(
      (t) =>
        (focus.elementId &&
          (t.elementId === focus.elementId ||
            t.endpointId === focus.elementId)) ||
        (focus.flowId && t.flowId === focus.flowId),
    );
  }

  renderTasksView(
    tasksEl,
    list,
    {
      focus,
      filterLinked: hasFocus && taskFilterLinked,
      elementName: (id) => elements.get(id)?.name || elements.get(id)?.id,
      flowName: (id) => infraFlows.get(id)?.name,
      mode: taskMode,
      readOnly: !source.saveTask,
      today: localToday(),
    },
    {
      onClose: toggleTasks,
      onSetMode: (mode) => {
        taskMode = mode;
        renderTasksPanel();
      },
      onToggleFilter: () => {
        taskFilterLinked = !taskFilterLinked;
        renderTasksPanel();
      },
      onCreate: ({ title, elementId, flowId }) => {
        const task = newTask(
          { title, ...(elementId ? { elementId } : {}), ...(flowId ? { flowId } : {}) },
          { actor: TASK_ACTOR, existingKeys: [...tasks.values()].map((t) => t.key) },
        );
        // Optimistic insert; if the write is rejected (offline / locked DB),
        // undo it and tell the user rather than leaving a phantom task.
        tasks.set(task.id, task);
        saveTaskOptimistic(task, () => tasks.delete(task.id), "create");
        renderTasksPanel();
      },
      onChangeStatus: (id, status) => {
        const prev = tasks.get(id);
        if (!prev) return;
        const updated = applyTaskChange(prev, { status }, TASK_ACTOR);
        tasks.set(id, updated);
        saveTaskOptimistic(updated, () => tasks.set(id, prev), "update");
        renderTasksPanel();
      },
      onDelete: (id) => {
        const prev = tasks.get(id);
        if (!prev) return;
        tasks.delete(id);
        void source.deleteTask?.(id)?.catch((err) => {
          tasks.set(id, prev); // roll back the optimistic delete
          notify(`Couldn't delete task: ${(err as Error).message}`);
          renderTasksPanel();
        });
        renderTasksPanel();
      },
      onClearLink: (id, field) => {
        const prev = tasks.get(id);
        if (!prev) return;
        const updated = applyTaskChange(prev, { [field]: undefined }, TASK_ACTOR);
        tasks.set(id, updated);
        saveTaskOptimistic(updated, () => tasks.set(id, prev), "update");
        renderTasksPanel();
      },
      onSelectElement: (id) => {
        if (elements.has(id)) select(id);
      },
    },
  );
}

/**
 * Persist a task that's already been applied optimistically to the local map.
 * On a rejected write (offline / membership-locked database) it runs `rollback`
 * to restore the prior state, notifies, and re-renders — so the panel never
 * silently claims a save that didn't land.
 */
function saveTaskOptimistic(
  task: Task,
  rollback: () => void,
  verb: "create" | "update",
): void {
  void source.saveTask?.(task)?.catch((err) => {
    rollback();
    notify(`Couldn't ${verb} task: ${(err as Error).message}`);
    renderTasksPanel();
  });
}

// ========================================================================
// Infrastructure flows (rendered Mermaid diagrams)
// ========================================================================

/**
 * Toggle the rendered Flows view (defaults to the architecture component diagram).
 * Clicking the button again closes it — matching the Infra/Docs/Timeline buttons
 * — so the full-stage backdrop never traps the user with a button that does
 * nothing on a second click.
 */
function toggleFlows(): void {
  setView(view === "flow" ? "design" : "flow");
}

/**
 * Size the rendered diagram to the body: at flowZoom 1 it fits the pane (so no
 * scrollbar), and the −/+ controls scale around that fit. We set explicit pixel
 * width/height (rather than a CSS transform) so the body's overflow can pan to
 * every edge when the user zooms past the pane.
 */
function fitFlowSvg(): void {
  const body = flowPanelEl.querySelector(".flowview-body") as HTMLElement | null;
  const svgEl = body?.querySelector("svg") as SVGSVGElement | null;
  const label = flowPanelEl.querySelector(".flowview-zoom-label");
  if (label) label.textContent = `${Math.round(flowZoom * 100)}%`;
  if (!body || !svgEl) return;
  const vb = svgEl.viewBox.baseVal;
  const iw = vb?.width || svgEl.getBoundingClientRect().width;
  const ih = vb?.height || svgEl.getBoundingClientRect().height;
  if (!iw || !ih) return;
  const pad = 32; // .flowview-body padding, both sides
  const fit = Math.min((body.clientWidth - pad) / iw, (body.clientHeight - pad) / ih);
  const scale = Math.max(0.02, fit * flowZoom);
  svgEl.style.maxWidth = "none";
  svgEl.style.maxHeight = "none";
  svgEl.style.width = `${iw * scale}px`;
  svgEl.style.height = `${ih * scale}px`;
  // Only offer the grab cursor when the diagram overflows the pane (i.e. there's
  // somewhere to pan to); at fit it sits still, so a grab affordance would lie.
  markFlowPannable(body);
}

const FLOW_ZOOM_MIN = 0.2;
const FLOW_ZOOM_MAX = 6;

/** Step the Flows diagram zoom (minimize/maximize) around the pane centre. */
function zoomFlow(factor: number): void {
  const body = flowPanelEl.querySelector(".flowview-body") as HTMLElement | null;
  if (!body) {
    flowZoom = Math.min(FLOW_ZOOM_MAX, Math.max(FLOW_ZOOM_MIN, flowZoom * factor));
    fitFlowSvg();
    return;
  }
  const box = body.getBoundingClientRect();
  zoomFlowAt(factor, box.left + box.width / 2, box.top + box.height / 2);
}

/**
 * Zoom the diagram around a screen point, keeping whatever sits under the cursor
 * pinned there. The SVG is sized in real pixels inside the scrollable body, so we
 * re-anchor by scrolling: capture the fraction of the diagram under the pointer
 * before the resize, then scroll so that fraction lands back under the pointer.
 */
function zoomFlowAt(factor: number, clientX: number, clientY: number): void {
  const body = flowPanelEl.querySelector(".flowview-body") as HTMLElement | null;
  const svgEl = body?.querySelector("svg") as SVGSVGElement | null;
  const next = Math.min(FLOW_ZOOM_MAX, Math.max(FLOW_ZOOM_MIN, flowZoom * factor));
  if (!body || !svgEl || next === flowZoom) {
    flowZoom = next;
    fitFlowSvg();
    return;
  }
  const before = svgEl.getBoundingClientRect();
  const bodyBox = body.getBoundingClientRect();
  const fracX = before.width ? (clientX - before.left) / before.width : 0.5;
  const fracY = before.height ? (clientY - before.top) / before.height : 0.5;
  const px = clientX - bodyBox.left; // pointer offset inside the pane
  const py = clientY - bodyBox.top;
  flowZoom = next;
  fitFlowSvg();
  // Re-anchor: the svg's start in the body's scrollable content (rect delta plus
  // the current scroll is scroll-invariant), so scrolling the picked fraction to
  // the pointer keeps that point pinned across the resize + flex centring/padding.
  const after = svgEl.getBoundingClientRect();
  const svgLeftInContent = after.left - bodyBox.left + body.scrollLeft;
  const svgTopInContent = after.top - bodyBox.top + body.scrollTop;
  body.scrollLeft = svgLeftInContent + fracX * after.width - px;
  body.scrollTop = svgTopInContent + fracY * after.height - py;
}

// ---- Data/Flows diagram pan + edge auto-scroll --------------------------
// The rendered diagram lives in a scrollable body (its SVG sized in real px), so
// panning here means dragging the scroll offset rather than moving a viewport
// transform like the design canvas. A grab-drag scrolls 1:1 with the pointer, and
// a separate rAF loop keeps scrolling while the pointer rests against a pane edge
// so you can reach content past the corner without lifting the drag.
const FLOW_EDGE_MARGIN = 48; // px from an edge where auto-scroll begins
const FLOW_EDGE_MAX_SPEED = 20; // px/frame at (or past) the very edge
let flowPan: { body: HTMLElement; lastX: number; lastY: number; pointerId: number } | null = null;
let flowEdgeVX = 0;
let flowEdgeVY = 0;
let flowEdgeRAF: number | null = null;

/** Toggle the grab affordance: pannable only when the diagram overflows the pane. */
function markFlowPannable(body: HTMLElement): void {
  const canPan =
    body.scrollWidth > body.clientWidth + 1 ||
    body.scrollHeight > body.clientHeight + 1;
  body.classList.toggle("pannable", canPan);
}

function flowEdgeSpeed(dist: number): number {
  const t = Math.max(0, Math.min(1, 1 - dist / FLOW_EDGE_MARGIN));
  return t * FLOW_EDGE_MAX_SPEED;
}

/** Recompute edge-scroll velocity from the pointer's distance to each pane edge. */
function updateFlowEdgeScroll(body: HTMLElement, clientX: number, clientY: number): void {
  const box = body.getBoundingClientRect();
  const rightDist = box.right - clientX;
  const leftDist = clientX - box.left;
  const botDist = box.bottom - clientY;
  const topDist = clientY - box.top;
  flowEdgeVX =
    rightDist < FLOW_EDGE_MARGIN
      ? flowEdgeSpeed(rightDist)
      : leftDist < FLOW_EDGE_MARGIN
        ? -flowEdgeSpeed(leftDist)
        : 0;
  flowEdgeVY =
    botDist < FLOW_EDGE_MARGIN
      ? flowEdgeSpeed(botDist)
      : topDist < FLOW_EDGE_MARGIN
        ? -flowEdgeSpeed(topDist)
        : 0;
  if ((flowEdgeVX !== 0 || flowEdgeVY !== 0) && flowEdgeRAF === null) {
    flowEdgeRAF = requestAnimationFrame(flowEdgeScrollTick);
  }
}

function flowEdgeScrollTick(): void {
  flowEdgeRAF = null;
  if (!flowPan || (flowEdgeVX === 0 && flowEdgeVY === 0)) return;
  flowPan.body.scrollLeft += flowEdgeVX;
  flowPan.body.scrollTop += flowEdgeVY;
  flowEdgeRAF = requestAnimationFrame(flowEdgeScrollTick);
}

function stopFlowEdgeScroll(): void {
  flowEdgeVX = 0;
  flowEdgeVY = 0;
  if (flowEdgeRAF !== null) {
    cancelAnimationFrame(flowEdgeRAF);
    flowEdgeRAF = null;
  }
}

/** Wire grab-to-pan, edge auto-scroll, and cursor-anchored wheel zoom on the
 *  diagram body. Called fresh each render since the body is rebuilt. */
function wireFlowBodyPan(body: HTMLElement): void {
  body.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (
      body.scrollWidth <= body.clientWidth + 1 &&
      body.scrollHeight <= body.clientHeight + 1
    ) {
      return; // nothing to pan; leave clicks/selection to the diagram
    }
    flowPan = { body, lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
    body.setPointerCapture(e.pointerId);
    body.classList.add("grabbing");
    e.preventDefault();
  });
  body.addEventListener("pointermove", (e) => {
    if (!flowPan) return;
    body.scrollLeft -= e.clientX - flowPan.lastX;
    body.scrollTop -= e.clientY - flowPan.lastY;
    flowPan.lastX = e.clientX;
    flowPan.lastY = e.clientY;
    updateFlowEdgeScroll(body, e.clientX, e.clientY); // "border to scroll"
  });
  const endPan = (e: PointerEvent) => {
    if (!flowPan) return;
    body.classList.remove("grabbing");
    try {
      body.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    flowPan = null;
    stopFlowEdgeScroll();
  };
  body.addEventListener("pointerup", endPan);
  body.addEventListener("pointercancel", endPan);
  // Ctrl/⌘ + wheel zooms toward the cursor (matching the design canvas); plain
  // wheel keeps native scrolling. Stop propagation so the window-level design-
  // canvas zoom handler doesn't also fire on the hidden canvas beneath.
  body.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      zoomFlowAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
    },
    { passive: false },
  );
}

// Keep the diagram fitted when the window (and thus the pane) resizes.
/** Wire the window resize handler (called by mountCanvas; detached by destroy). */
function bindResize(): void {
  on(window, "resize", () => {
    if (flowOpen) fitFlowSvg();
  });
}

/**
 * Mermaid `%%{init}%%` theme override for the ER lens. Mermaid is initialized
 * once globally (`theme: "dark"`); this directive merges onto that theme for the
 * ER render only, remapping the entity-table / relationship colours to the
 * canvas's warm-dark palette (the same hexes the CSS variables resolve to) so the
 * diagram sits seamlessly on the `--bg` pane instead of Mermaid's stock dark
 * hues. Colours only — no `theme` swap — so the merge stays predictable, and no
 * key here is on Mermaid's secure list, so it survives `securityLevel: "strict"`.
 */
const ER_THEME_DIRECTIVE = `%%{init: ${JSON.stringify({
  themeVariables: {
    darkMode: true,
    background: "#0c0d11", // --bg (matches the pane behind it)
    mainBkg: "#1a1c23", // --surface-3 — entity header + box fill
    nodeBorder: "#3a3d47", // solid stand-in for --line-3 on the dark pane
    lineColor: "#7d7c76", // --muted-2 — crow's-foot relationship lines
    textColor: "#e8e5de", // --text
    attributeBackgroundColorOdd: "#171920", // --surface-2 (zebra rows)
    attributeBackgroundColorEven: "#121319", // --bg-panel (zebra rows)
    edgeLabelBackground: "#22242c", // relationship-label pill
    fontFamily: "Space Grotesk, sans-serif", // --sans
  },
})}}%%`;

/** The ER model serialised to a themed Mermaid `erDiagram` for the Data lens. */
function erDiagramSrc(
  entityList: Entity[],
  relations: EntityRelation[],
): string {
  return `${ER_THEME_DIRECTIVE}\n${entityToMermaid(entityList, relations)}`;
}

/** Copy Mermaid text to the clipboard with a small confirmation. */
function copyMermaid(text: string): void {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => notify("Flow diagram copied to clipboard (Mermaid)."))
    .catch(() => notify("Couldn't copy — clipboard unavailable."));
}

/**
 * Render the real Flows view on its own surface. A dropdown chooses which flow to show
 * as its sequence diagram (the architecture/component view already lives in
 * the Infra overlay). Same `flowToMermaid` the Copy action emits, rendered to
 * SVG via (lazily loaded) Mermaid. The backdrop hides the canvas so the diagram
 * reads on its own — no overlay beneath.
 */
async function renderFlowPanel(): Promise<void> {
  flowPanelEl.hidden = !flowOpen;
  if (!flowOpen) {
    flowPan = null; // a rebuild/close mid-drag must not keep scrolling a stale body
    stopFlowEdgeScroll();
    flowPanelEl.replaceChildren();
    return;
  }
  // Any full re-render replaces the body, so drop an in-flight pan on the old one.
  flowPan = null;
  stopFlowEdgeScroll();

  // Drop a stale flow selection so the dropdown + render stay consistent.
  if (selectedFlowId && !infraFlows.has(selectedFlowId)) selectedFlowId = null;
  // The Flows panel renders one behavioural sequence diagram per narrated flow.
  // (The Agents rail button shares this surface for the agent/MCP wiring lens.)
  // Default to the first flow so opening Flows lands on a diagram, not a blank pane.
  if (!selectedFlowAgents && !selectedFlowEr && !selectedFlowId) {
    const [first] = infraFlows.values();
    selectedFlowId = first ? first.id : null;
  }
  const flow = selectedFlowId ? infraFlows.get(selectedFlowId) : undefined;
  const mermaidSrc = selectedFlowEr
    ? entities.size
      ? erDiagramSrc([...entities.values()], entityRelations)
      : null
    : selectedFlowAgents
      ? agentNodes.size || mcpServers.size
        ? agentsToComponentMermaid(
            [...agentNodes.values()],
            [...mcpServers.values()],
          )
        : null
      : flow
        ? flowToMermaid(flow, infraNodes)
        : null;
  const canEditFlows = Boolean(source.saveInfraFlow);
  // The flow editor only applies to a selected sequence flow, never the read-only
  // agents/ER lenses.
  if (!canEditFlows || selectedFlowAgents || selectedFlowEr) flowEdit = false;

  // Backdrop: clicking outside the card closes the view.
  flowPanelEl.replaceChildren();
  flowPanelEl.onclick = (e) => {
    if (e.target === flowPanelEl) closeFlow();
  };

  const card = document.createElement("div");
  card.className = "flowview-card";

  // Header: the what-to-render dropdown in the left corner, then (pushed right)
  // the flow actions, zoom −/+ controls, copy, and close.
  const head = document.createElement("div");
  head.className = "flowview-head";

  // The Agents and ER lenses (each opened from its own surface, not the journey
  // list) share this diagram pane for a single structural render, so they show a
  // static title instead of the journey picker.
  if (selectedFlowAgents || selectedFlowEr) {
    head.append(
      hEl(
        "h3",
        selectedFlowEr ? "Data model — ER diagram" : "Agents & MCP — wiring diagram",
      ),
    );
  } else {
    // The Flows picker lists one entry per narrated flow — each renders as a
    // sequence diagram. The structural lenses (component / ER) live on their own
    // Infra and Data rails, not here.
    const select = document.createElement("select");
    select.className = "flowview-select";
    if (infraFlows.size === 0) {
      const none = document.createElement("option");
      none.textContent = "No sequence flows defined";
      none.disabled = true;
      none.selected = true;
      select.append(none);
    }
    for (const f of infraFlows.values()) {
      const o = document.createElement("option");
      o.value = `flow:${f.id}`;
      o.textContent = `${f.name} — sequence diagram`;
      if (f.id === selectedFlowId) o.selected = true;
      select.append(o);
    }
    select.addEventListener("change", () => {
      const val = select.value;
      if (val.startsWith("flow:")) selectedFlowId = val.slice(5);
      void renderFlowPanel();
    });
    head.append(select);
  }

  const headActions = document.createElement("div");
  headActions.className = "flowview-head-actions";

  // Authoring. The ER lens leads with a read-only diagram whose only authoring
  // affordance is "Edit" — it drops to the editable ER graph underneath (shown
  // only when the source can persist entities). The Flows lens instead offers
  // journey creation + the step editor toggle.
  if (selectedFlowEr) {
    if (source.saveEntity) {
      const editBtn = document.createElement("button");
      editBtn.className = "flowview-action";
      editBtn.textContent = "Edit";
      editBtn.title = "Edit the data model as a graph";
      editBtn.addEventListener("click", editErDiagram);
      headActions.append(editBtn);
    }
  } else if (canEditFlows) {
    const newBtn = document.createElement("button");
    newBtn.className = "flowview-action";
    newBtn.textContent = "+ New journey";
    newBtn.addEventListener("click", () => void createFlow());
    const editBtn = document.createElement("button");
    editBtn.className = flowEdit ? "flowview-action active" : "flowview-action";
    editBtn.textContent = "Edit";
    editBtn.disabled = !flow;
    editBtn.addEventListener("click", () => {
      flowEdit = !flowEdit;
      void renderFlowPanel();
    });
    headActions.append(newBtn, editBtn);
  }

  const zoomOut = document.createElement("button");
  zoomOut.className = "flowview-zoom";
  zoomOut.title = "Zoom out (minimize)";
  zoomOut.textContent = "−";
  zoomOut.disabled = !mermaidSrc;
  zoomOut.addEventListener("click", () => zoomFlow(1 / 1.2));
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "flowview-zoom-label";
  const zoomIn = document.createElement("button");
  zoomIn.className = "flowview-zoom";
  zoomIn.title = "Zoom in (maximize)";
  zoomIn.textContent = "+";
  zoomIn.disabled = !mermaidSrc;
  zoomIn.addEventListener("click", () => zoomFlow(1.2));

  const copyBtn = document.createElement("button");
  copyBtn.className = "flowview-copy";
  copyBtn.title = "Copy as Mermaid text";
  copyBtn.textContent = "⧉";
  copyBtn.disabled = !mermaidSrc;
  copyBtn.addEventListener("click", () => {
    if (mermaidSrc) copyMermaid(mermaidSrc);
  });
  const close = document.createElement("button");
  close.className = "flowview-close";
  close.title = "Close";
  close.textContent = "✕";
  close.addEventListener("click", closeFlow);
  headActions.append(zoomOut, zoomLabel, zoomIn, copyBtn, close);
  head.append(headActions);
  card.append(head);

  // Caption only when not editing (the editor owns the description field).
  if (!flowEdit && flow?.description) {
    card.append(hEl("p", flow.description, "flowview-desc"));
  }

  // Content row: the diagram, plus the editor column when editing.
  const content = document.createElement("div");
  content.className = "flowview-content";
  const body = document.createElement("div");
  body.className = "flowview-body";
  content.append(body);
  if (flowEdit && flow) content.append(buildFlowEditor(flow));
  card.append(content);
  flowPanelEl.append(card);

  if (!mermaidSrc) {
    const message = selectedFlowEr
      ? source.saveEntity
        ? 'No entities yet — click "Edit" to add tables to the data model.'
        : "No entities yet in this data model."
      : selectedFlowAgents
        ? "No agents or MCP servers yet — document them from VS Code or an AI agent (the Forward MCP server) to see this diagram."
        : canEditFlows
          ? 'No journeys yet — click "+ New journey" to author one.'
          : "No journeys to render. Add a flow to the infrastructure graph.";
    body.append(hEl("p", message, "flowview-empty"));
    return;
  }

  body.append(hEl("p", "Rendering…", "flowview-empty"));
  const token = ++flowSeq; // also the Mermaid render id; guards against races
  try {
    const mermaid = await getMermaid();
    const { svg } = await mermaid.render(`flow_${token}`, mermaidSrc);
    if (!flowOpen || token !== flowSeq) return; // superseded by a newer render/close
    body.innerHTML = svg;
    fitFlowSvg(); // size the diagram to the pane (no scrollbar at 100%)
    wireFlowBodyPan(body); // grab-to-pan, edge auto-scroll, cursor-anchored zoom
  } catch (err) {
    body.innerHTML = "";
    body.append(hEl("pre", `Couldn't render flow diagram:\n${(err as Error).message}`, "flowview-error"));
  }
}

/** Close the rendered Flows view. */
function closeFlow(): void {
  // The Flows/Agents panels and the Data view's ER diagram (now the Data view's
  // default face) all route their ✕ / backdrop back to design; setView() tears the
  // panel down + syncs the rail.
  setView("design");
}

/**
 * The ER diagram's "Edit" action: drop the read-only Mermaid `erDiagram` to reveal
 * the editable ER graph underneath (view stays "data"). Its counterpart is the
 * inspector's "Diagram" button (`viewEntityDiagram`), which brings the diagram back.
 */
function editErDiagram(): void {
  selectedFlowEr = false;
  flowOpen = false;
  void renderFlowPanel(); // hides + clears the overlay, leaving the editable graph
}

/**
 * Open the ER (data-model) diagram as a themed Mermaid `erDiagram` over the Data
 * view — the polished, read-only twin of the editable ER graph. Reuses the Flows
 * diagram surface (zoom / copy / fit / sanitize) with the ER lens flag, and stays
 * in the "data" view so "Edit" drops back to the editable graph.
 */
function viewEntityDiagram(): void {
  selectedFlowEr = true;
  selectedFlowAgents = false;
  selectedFlowId = null;
  flowOpen = true;
  flowZoom = 1; // open at fit
  flowEdit = false;
  void renderFlowPanel();
}

// ------------------------------------------------------------------------
// Flow authoring — the sequence diagram is a pure render of a flow's
// steps, so editing the flow here *is* editing the flow. Each change persists
// and re-renders the diagram live.
// ------------------------------------------------------------------------

/** Create a new (empty) flow, select it, and open the editor on it. */
async function createFlow(): Promise<void> {
  if (!source.saveInfraFlow) return;
  const name = (
    await promptText({
      title: "New journey",
      label: "JOURNEY NAME",
      placeholder: "e.g. User sign up, Admin approves application, Refund",
      okText: "Create journey",
    })
  )?.trim();
  if (!name) return;
  const flow: InfraFlow = {
    id: `flow_${Date.now().toString(36)}`,
    name,
    description: "",
    steps: [],
    updatedAt: now(),
  };
  infraFlows.set(flow.id, flow);
  selectedFlowId = flow.id;
  flowEdit = true;
  void source.saveInfraFlow(flow);
  void renderFlowPanel();
}

/** Merge a patch into the selected flow, persist, and re-render the diagram. */
function updateFlow(patch: Partial<InfraFlow>): void {
  const id = selectedFlowId;
  if (!id || !source.saveInfraFlow) return;
  const f = infraFlows.get(id);
  if (!f) return;
  const updated: InfraFlow = { ...f, ...patch, updatedAt: now() };
  infraFlows.set(id, updated);
  void source.saveInfraFlow(updated);
  void renderFlowPanel();
}

/** Delete the selected flow after confirmation (its nodes/edges stay). */
async function deleteFlow(): Promise<void> {
  const id = selectedFlowId;
  if (!id || !source.deleteInfraFlow) return;
  const f = infraFlows.get(id);
  const ok = await confirmAction({
    title: "Delete journey",
    message: `Delete journey "${f?.name ?? id}"? Its nodes and edges are left intact.`,
    okText: "Delete",
    danger: true,
  });
  if (!ok) return;
  infraFlows.delete(id);
  selectedFlowId = null;
  flowEdit = false;
  void source.deleteInfraFlow(id);
  void renderFlowPanel();
}

/** Append a step to the selected flow (defaults to the first node(s)). */
function addFlowStepToSelected(): void {
  const id = selectedFlowId;
  const f = id ? infraFlows.get(id) : undefined;
  if (!f) return;
  const ids = [...infraNodes.keys()];
  if (!ids.length) {
    notify("Add infra nodes first (Infra → + Add node).");
    return;
  }
  const step: InfraFlowStep = {
    from: ids[0] ?? "",
    to: ids[1] ?? ids[0] ?? "",
    label: "",
    kind: "sync",
  };
  updateFlow({ steps: [...f.steps, step] });
}

/** Replace step `i` of the selected flow with `{...step, ...patch}`. */
function updateFlowStep(i: number, patch: Partial<InfraFlowStep>): void {
  const id = selectedFlowId;
  const f = id ? infraFlows.get(id) : undefined;
  if (!f) return;
  const steps = f.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
  updateFlow({ steps });
}

/** Remove step `i`, or move it up/down (dir = -1 / +1) within the flow. */
function mutateFlowSteps(i: number, action: "remove" | -1 | 1): void {
  const id = selectedFlowId;
  const f = id ? infraFlows.get(id) : undefined;
  if (!f) return;
  const steps = [...f.steps];
  if (action === "remove") {
    steps.splice(i, 1);
  } else {
    const j = i + action;
    if (j < 0 || j >= steps.length) return;
    const a = steps[i];
    const b = steps[j];
    if (!a || !b) return;
    steps[i] = b;
    steps[j] = a;
  }
  updateFlow({ steps });
}

/** The right-hand editor column for one flow: name, description, and steps. */
function buildFlowEditor(flow: InfraFlow): HTMLElement {
  const aside = document.createElement("aside");
  aside.className = "flowview-editor";
  aside.append(hEl("h3", "Edit journey"));

  // Name + description.
  aside.append(flowField("Name", flow.name, (v) => updateFlow({ name: v.trim() || flow.name })));
  aside.append(
    flowField("Notes", flow.description, (v) => updateFlow({ description: v }), true),
  );

  // Steps.
  aside.append(hEl("h4", "Steps"));
  const nodeOpts = [...infraNodes.values()];
  if (!nodeOpts.length) {
    aside.append(
      hEl("p", "No infra nodes yet — add nodes in the Infra overlay first.", "flowview-empty"),
    );
  }
  flow.steps.forEach((step, i) => {
    aside.append(buildFlowStep(step, i, flow.steps.length, nodeOpts));
  });

  const addStep = document.createElement("button");
  addStep.className = "doc-add";
  addStep.textContent = "+ Add step";
  addStep.disabled = !nodeOpts.length;
  addStep.addEventListener("click", addFlowStepToSelected);
  aside.append(addStep);

  const del = document.createElement("button");
  del.className = "doc-remove";
  del.textContent = "Delete journey";
  del.disabled = !source.deleteInfraFlow;
  del.addEventListener("click", () => void deleteFlow());
  aside.append(del);
  return aside;
}

/** One step row: from → to, a label, the message kind, and move/remove. */
function buildFlowStep(
  step: InfraFlowStep,
  i: number,
  count: number,
  nodes: InfraNode[],
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "flowview-step";

  const fromTo = document.createElement("div");
  fromTo.className = "flowview-step-row";
  fromTo.append(hEl("span", `${i + 1}.`, "flowview-step-num"));
  fromTo.append(nodeSelect(step.from, nodes, (v) => updateFlowStep(i, { from: v })));
  fromTo.append(hEl("span", "→", "flowview-step-arrow"));
  fromTo.append(nodeSelect(step.to, nodes, (v) => updateFlowStep(i, { to: v })));
  wrap.append(fromTo);

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.value = step.label;
  labelInput.placeholder = "what happens (e.g. POST /login)";
  labelInput.addEventListener("change", () => updateFlowStep(i, { label: labelInput.value }));
  wrap.append(labelInput);

  const row2 = document.createElement("div");
  row2.className = "flowview-step-row";
  const kind = document.createElement("select");
  for (const k of ["sync", "async", "reply"] as const) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = k;
    if (k === step.kind) o.selected = true;
    kind.append(o);
  }
  kind.addEventListener("change", () =>
    updateFlowStep(i, { kind: kind.value as InfraFlowStep["kind"] }),
  );
  row2.append(kind);

  const up = miniBtn("↑", "Move up", i === 0, () => mutateFlowSteps(i, -1));
  const down = miniBtn("↓", "Move down", i === count - 1, () => mutateFlowSteps(i, 1));
  const rm = miniBtn("✕", "Remove step", false, () => mutateFlowSteps(i, "remove"));
  row2.append(up, down, rm);
  wrap.append(row2);

  // Optional branch guard: consecutive steps sharing one render as an alt/else block.
  const cond = document.createElement("input");
  cond.type = "text";
  cond.value = step.condition ?? "";
  cond.placeholder = "branch guard (optional, e.g. token valid) — groups into an alt block";
  cond.addEventListener("change", () => {
    const v = cond.value.trim();
    updateFlowStep(i, { condition: v || undefined });
  });
  wrap.append(cond);
  return wrap;
}

/** A labelled text/textarea field for the flow editor. */
function flowField(
  label: string,
  value: string,
  onChange: (v: string) => void,
  area = false,
): HTMLElement {
  const div = document.createElement("div");
  div.className = area ? "row row-stack" : "row";
  div.append(hEl("label", label));
  const input = area
    ? document.createElement("textarea")
    : document.createElement("input");
  if (input instanceof HTMLTextAreaElement) input.rows = 3;
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  div.append(input);
  return div;
}

/** A node dropdown bound to a step endpoint. */
function nodeSelect(
  value: string,
  nodes: InfraNode[],
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = document.createElement("select");
  // Tolerate a step that points at a since-deleted node.
  if (!nodes.some((n) => n.id === value) && value) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = "(missing node)";
    o.selected = true;
    sel.append(o);
  }
  for (const n of nodes) {
    const o = document.createElement("option");
    o.value = n.id;
    o.textContent = n.label;
    if (n.id === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

/** A small square button used for step move/remove. */
function miniBtn(
  glyph: string,
  title: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "flowview-mini";
  b.textContent = glyph;
  b.title = title;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

// ========================================================================
// Small helpers
// ========================================================================
function toCanvas(
  e: { clientX: number; clientY: number },
  box: DOMRect = svg.getBoundingClientRect(),
): { x: number; y: number } {
  // Invert the viewport transform: screen -> world.
  return {
    x: (e.clientX - box.left - panX) / zoom,
    y: (e.clientY - box.top - panY) / zoom,
  };
}

// ========================================================================
// Zoom & pan
// ========================================================================
function wireZoomControls(): void {
  uiRoot
    .getElementById("zoomIn")
    ?.addEventListener("click", () => zoomToCenter(zoom * ZOOM_STEP));
  uiRoot
    .getElementById("zoomOut")
    ?.addEventListener("click", () => zoomToCenter(zoom / ZOOM_STEP));
  uiRoot.getElementById("zoomFit")?.addEventListener("click", fitView);
  const edgeBtn = uiRoot.getElementById("edgeScrollToggle");
  if (edgeBtn) {
    const syncEdgeBtn = () => {
      edgeBtn.setAttribute("aria-pressed", String(hoverScrollEnabled));
      edgeBtn.title = hoverScrollEnabled
        ? "Edge hover-scroll: on — click to disable"
        : "Edge hover-scroll: off — click to enable";
    };
    syncEdgeBtn();
    edgeBtn.addEventListener("click", () => {
      hoverScrollEnabled = !hoverScrollEnabled;
      syncEdgeBtn();
      // Turning it off mid-hover-scroll must halt the loop; a drag holds its own
      // pointer capture and isn't affected (you can't click a button mid-drag).
      if (!hoverScrollEnabled && !gesture) stopEdgeScroll();
      saveHoverScrollPref();
    });
  }
  // Ctrl/⌘ + wheel zooms toward the cursor; plain wheel scrolls as usual.
  on(
    window,
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, e.clientX, e.clientY);
    },
    { passive: false },
  );
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
function updateZoomLabel(): void {
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}
/** Zoom toward a screen point, keeping the world point under it fixed. */
function zoomAt(next: number, clientX: number, clientY: number): void {
  cancelViewAnim(); // a user zoom wins over an in-flight camera glide
  const box = svg.getBoundingClientRect();
  const z = clampZoom(next);
  const wx = (clientX - box.left - panX) / zoom;
  const wy = (clientY - box.top - panY) / zoom;
  zoom = z;
  panX = clientX - box.left - wx * zoom;
  panY = clientY - box.top - wy * zoom;
  render();
}
function zoomToCenter(next: number): void {
  const box = svg.getBoundingClientRect();
  zoomAt(next, box.left + box.width / 2, box.top + box.height / 2);
}
/** Fit all elements into the viewport with a little padding. */
function fitView(): void {
  cancelViewAnim();
  const els = [...elements.values()];
  if (!els.length) {
    zoom = 1;
    panX = 0;
    panY = 0;
    render();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }
  const box = svg.getBoundingClientRect();
  const pad = 40;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  zoom = clampZoom(
    Math.min((box.width - pad * 2) / w, (box.height - pad * 2) / h),
  );
  panX = (box.width - w * zoom) / 2 - minX * zoom;
  panY = (box.height - h * zoom) / 2 - minY * zoom;
  render();
}
/** Center the viewport on one element (for deep links), keeping the current zoom
 * unless the element is tiny/huge relative to the pane, in which case fit it. */
function centerOn(id: string, animate = false): void {
  const el = elements.get(id);
  if (!el) return;
  const r = rectOf(el);
  const box = svg.getBoundingClientRect();
  const pad = 80;
  const fit = clampZoom(
    Math.min(
      (box.width - pad * 2) / Math.max(1, r.width),
      (box.height - pad * 2) / Math.max(1, r.height),
    ),
  );
  // Zoom out to fit only when the element wouldn't comfortably fit at the
  // current zoom; never zoom further in than where the user already was.
  const targetZoom = Math.min(zoom, fit);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const targetPanX = box.width / 2 - cx * targetZoom;
  const targetPanY = box.height / 2 - cy * targetZoom;
  if (animate) {
    animateView(targetPanX, targetPanY, targetZoom);
  } else {
    cancelViewAnim();
    zoom = targetZoom;
    panX = targetPanX;
    panY = targetPanY;
    render();
  }
}

/** Cancel any in-flight viewport tween (e.g. the user grabbed the canvas). */
function cancelViewAnim(): void {
  if (viewAnimFrame !== null) {
    cancelAnimationFrame(viewAnimFrame);
    viewAnimFrame = null;
  }
}

/**
 * Ease the viewport (pan + zoom) toward a target over ~340ms so a jump to an
 * off-screen element reads as a glide, not a teleport. Honours
 * prefers-reduced-motion (and a zero duration) by snapping instantly.
 */
function animateView(
  toPanX: number,
  toPanY: number,
  toZoom: number,
  ms = 340,
): void {
  cancelViewAnim();
  const reduce =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || ms <= 0) {
    panX = toPanX;
    panY = toPanY;
    zoom = toZoom;
    render();
    return;
  }
  const fromPanX = panX;
  const fromPanY = panY;
  const fromZoom = zoom;
  const start = performance.now();
  const ease = (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // easeInOutQuad
  const step = (nowT: number): void => {
    const t = Math.min(1, (nowT - start) / ms);
    const k = ease(t);
    panX = fromPanX + (toPanX - fromPanX) * k;
    panY = fromPanY + (toPanY - fromPanY) * k;
    zoom = fromZoom + (toZoom - fromZoom) * k;
    render();
    viewAnimFrame = t < 1 ? requestAnimationFrame(step) : null;
  };
  viewAnimFrame = requestAnimationFrame(step);
}

/**
 * Is the element comfortably framed by the current viewport — either fully
 * inside it (small element) or covering it (a frame larger than the screen)?
 * Used to skip needless camera moves when the layer is already on screen.
 */
function isInView(el: DesignElement): boolean {
  const r = rectOf(el);
  const box = svg.getBoundingClientRect();
  const left = r.x * zoom + panX;
  const top = r.y * zoom + panY;
  const right = (r.x + r.width) * zoom + panX;
  const bottom = (r.y + r.height) * zoom + panY;
  const m = 24; // keep a small margin off the viewport edges
  const contained =
    left >= m && top >= m && right <= box.width - m && bottom <= box.height - m;
  const covers =
    left <= m && top <= m && right >= box.width - m && bottom >= box.height - m;
  return contained || covers;
}

/** Glide the canvas to a layer's element only when it isn't already on screen. */
function revealElement(id: string): void {
  const el = elements.get(id);
  if (!el || isInView(el)) return;
  centerOn(id, true);
}
function rectOf(el: DesignElement): Rect {
  const r = resolved(el);
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
function otherRects(excludeId: string): Rect[] {
  const out: Rect[] = [];
  for (const el of elements.values())
    if (el.id !== excludeId) out.push(rectOf(el));
  return out;
}
function now(): string {
  return new Date().toISOString();
}
/** Compact relative time ("just now", "2h ago", "3 days ago") from epoch ms. */
function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (w < 5) return w === 1 ? "last week" : `${w} weeks ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
/** A plain HTML element with text content and an optional class. */
function hEl(tag: string, content: string, cls = ""): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (cls) node.className = cls;
  return node;
}
function notify(msg: string): void {
  setPanelHidden(false); // the drawer may be hidden in design mode; show the toast
  panel.querySelector(".empty")?.remove();
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = msg;
  panel.prepend(p);
}

/** A toolbar button whose glyph is an inline line-SVG icon over a text label. */
function iconButton(
  icon: SVGElement,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.title = label;
  b.append(icon);
  const span = document.createElement("span");
  span.textContent = label;
  b.append(span);
  b.addEventListener("click", onClick);
  return b;
}

/** Build a 24×24 stroked line icon from a list of <path>/<rect>/… children. */
function lineIcon(children: SVGElement[]): SVGElement {
  const svg = svgEl("svg", {
    class: "tb-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  for (const c of children) svg.append(c);
  return svg;
}
// Icon primitives + factories are function declarations (not const) so they are
// hoisted and safe to call from buildToolbar(), which runs during module init.
function path(d: string): SVGElement {
  return svgEl("path", { d });
}
function poly(points: string): SVGElement {
  return svgEl("polyline", { points });
}
function circle(cx: number, cy: number, r: number): SVGElement {
  return svgEl("circle", { cx: `${cx}`, cy: `${cy}`, r: `${r}` });
}
function rect(x: number, y: number, w: number, h: number, r = 2): SVGElement {
  return svgEl("rect", { x: `${x}`, y: `${y}`, width: `${w}`, height: `${h}`, rx: `${r}` });
}
// Layers: a stacked-diamond (sheets) glyph, matching the imported design.
function layersIcon(): SVGElement {
  return lineIcon([path("M12 3l9 5-9 5-9-5z"), path("M3 13l9 5 9-5")]);
}
// Inspector: a panel frame with a right-hand drawer column, for the toggle.
function inspectorIcon(): SVGElement {
  return lineIcon([rect(3, 4, 18, 16, 2), line(15, 4, 15, 20)]);
}
// Eye (visible) / eye-with-slash (hidden), for the layer-row visibility toggle.
function eyeIcon(): SVGElement {
  return lineIcon([path("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"), circle(12, 12, 2.8)]);
}
function eyeOffIcon(): SVGElement {
  return lineIcon([
    path("M9.6 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 3.9"),
    path("M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 3.9-.8"),
    line(3, 3, 21, 21),
  ]);
}
// Frame: a crop/frame grid.
function frameIcon(): SVGElement {
  return lineIcon([line(2, 6, 22, 6), line(2, 18, 22, 18), line(6, 2, 6, 22), line(18, 2, 18, 22)]);
}
// Rectangle.
function rectIcon(): SVGElement {
  return lineIcon([rect(4, 6, 16, 12, 2)]);
}
// Ellipse / circle.
function ellipseIcon(): SVGElement {
  return lineIcon([svgEl("ellipse", { cx: "12", cy: "12", rx: "9", ry: "7" })]);
}
// Text: a capital-T type glyph.
function textIcon(): SVGElement {
  return lineIcon([poly("4 7 4 4 20 4 20 7"), line(12, 4, 12, 20), line(9, 20, 15, 20)]);
}
// Component: the diamond.
function compIcon(): SVGElement {
  return lineIcon([path("M12 2 22 12 12 22 2 12Z")]);
}
// Instance: an overlapping-copies glyph.
function instIcon(): SVGElement {
  return lineIcon([
    rect(9, 9, 11, 11, 2),
    path("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"),
  ]);
}
// Bring to front: a filled square lifted above an outlined one.
function frontIcon(): SVGElement {
  return lineIcon([rect(3, 3, 12, 12, 2), path("M9 21h10a2 2 0 0 0 2-2V9")]);
}
// Send to back: a square dropped behind an outlined one.
function backIcon(): SVGElement {
  return lineIcon([rect(9, 9, 12, 12, 2), path("M15 3H5a2 2 0 0 0-2 2v10")]);
}
// Delete: a trash can.
function delIcon(): SVGElement {
  return lineIcon([
    poly("3 6 5 6 21 6"),
    path("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
    line(10, 11, 10, 17),
    line(14, 11, 14, 17),
  ]);
}
// Add member: a user with a plus.
function memberIcon(): SVGElement {
  return lineIcon([
    path("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
    circle(9, 7, 4),
    line(19, 8, 19, 14),
    line(16, 11, 22, 11),
  ]);
}
// Document with text lines.
function docsIcon(): SVGElement {
  return lineIcon([
    path("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"),
    path("M14 3v5h5"),
    path("M9 13h6"),
    path("M9 17h6"),
  ]);
}
// Chain link, for "copy anchor" — two interlocked link halves.
function linkIcon(): SVGElement {
  return lineIcon([
    path("M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"),
    path("M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"),
  ]);
}
// Sitemap: one node branching to two below.
function infraIcon(): SVGElement {
  return lineIcon([
    svgEl("rect", { x: "9", y: "2", width: "6", height: "6", rx: "1.2" }),
    svgEl("rect", { x: "3", y: "16", width: "6", height: "6", rx: "1.2" }),
    svgEl("rect", { x: "15", y: "16", width: "6", height: "6", rx: "1.2" }),
    path("M12 8v4"),
    path("M6 16v-2.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 13.5V16"),
  ]);
}
// Data: a stacked-table / database glyph for the ER (data-model) overlay.
function entityIcon(): SVGElement {
  return lineIcon([
    svgEl("rect", { x: "4", y: "3", width: "16", height: "18", rx: "2" }),
    line(4, 9, 20, 9),
    line(4, 15, 20, 15),
    line(12, 9, 12, 21),
  ]);
}
// Flow: two component boxes joined by a dependency arrow.
function flowIcon(): SVGElement {
  return lineIcon([
    svgEl("rect", { x: "3", y: "4", width: "8", height: "6", rx: "1.2" }),
    svgEl("rect", { x: "13", y: "14", width: "8", height: "6", rx: "1.2" }),
    path("M7 10v3a2 2 0 0 0 2 2h4"),
  ]);
}
// Agents: a bot head (antenna + face) for the agent / MCP layer.
function agentsIcon(): SVGElement {
  return lineIcon([
    svgEl("rect", { x: "4", y: "8", width: "16", height: "12", rx: "2" }),
    path("M12 4v4"),
    svgEl("circle", { cx: "12", cy: "4", r: "1" }),
    line(9, 13, 9, 15),
    line(15, 13, 15, 15),
    path("M2 12v3"),
    path("M22 12v3"),
  ]);
}
// Clock with a counter-clockwise "history" arrow.
function historyIcon(): SVGElement {
  return lineIcon([
    path("M3 3v5h5"),
    path("M3.05 13A9 9 0 1 0 6 5.3L3 8"),
    path("M12 7v5l4 2"),
  ]);
}
// Checklist: a clipboard with two ticked lines.
function tasksIcon(): SVGElement {
  return lineIcon([
    svgEl("rect", { x: "4", y: "4", width: "16", height: "18", rx: "2" }),
    svgEl("rect", { x: "9", y: "2", width: "6", height: "4", rx: "1" }),
    poly("8 11 9.5 12.5 12 10"),
    poly("8 17 9.5 18.5 12 16"),
    line(14, 11, 17, 11),
    line(14, 17, 17, 17),
  ]);
}
// Theme: a paint droplet with a dot, evoking colour/recolour.
function themeIcon(): SVGElement {
  return lineIcon([
    path("M12 3 L18 11 a6 6 0 1 1 -12 0 Z"),
    circle(12, 13, 1.5),
  ]);
}
function svgEl(name: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
function text(
  content: string,
  x: number,
  y: number,
  cls = "",
  centerBlock = false,
): SVGTextElement {
  const t = svgEl("text", { x: String(x), y: String(y) }) as SVGTextElement;
  if (cls) t.setAttribute("class", cls);
  // SVG <text> ignores "\n", so a multiline string is laid out as one <tspan>
  // per line, each dropped a line-height below the previous (dy is relative to
  // the element's own font-size, so this scales with the text's size).
  if (content.includes("\n")) {
    const lines = content.split("\n");
    // A shape label (centerBlock) is anchored at the box's vertical middle, so
    // lift the first line by half the block's height to keep the whole run
    // centered; a text element top-anchors at `y`, so the first line stays put.
    const firstDy = centerBlock ? `-${((lines.length - 1) * 1.2) / 2}em` : "0";
    lines.forEach((lineText, i) => {
      const span = svgEl("tspan", { x: String(x), dy: i === 0 ? firstDy : "1.2em" });
      span.textContent = lineText;
      t.append(span);
    });
  } else {
    t.textContent = content;
  }
  return t;
}
function badge(content: string, x: number, y: number): SVGTextElement {
  return text(content, x, y, "el-badge");
}
function line(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  return svgEl("line", {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    class: "snapline",
  }) as SVGLineElement;
}
