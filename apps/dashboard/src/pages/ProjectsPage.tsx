import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  useApi,
  type Project,
  type ProjectMemberPreview,
} from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { Loading, RetryError } from "../components/AsyncStates.js";
import { relTime } from "../components/tasks-format.js";

type View = "grid" | "list";
type Sort = "recent" | "name";

const VIEW_KEY = "forward.projects.view";
const SORT_KEY = "forward.projects.sort";

/** Debounce (ms) before a search keystroke hits the server list endpoint. */
const SEARCH_DEBOUNCE = 280;

/** Hue palette for project cover art — mirrors the Projects design. */
const HUES = [295, 230, 160, 30, 70, 200, 340, 120];

/** Avatar fills, matching the warm palette used across the tasks tracker. */
const AVATAR_COLORS = [
  "#3a6ea8",
  "#a98f5e",
  "#8a6db0",
  "#5b8c6e",
  "#bf5a36",
  "#7a6f60",
  "#c0492f",
  "#b3402a",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic cover hue for a project, from its id. */
function hueOf(p: Project): number {
  return HUES[hash(p.id) % HUES.length] ?? 230;
}

/** Two-letter initials + a stable colour for a member-preview avatar. */
function avatarOf(m: ProjectMemberPreview): { initials: string; color: string } {
  const base = m.email ? m.email.split("@")[0]! : m.userId;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0]![0]! + parts[1]![0]!).toUpperCase()
      : base.slice(0, 2).toUpperCase();
  return {
    initials,
    color: AVATAR_COLORS[hash(m.userId) % AVATAR_COLORS.length]!,
  };
}

/**
 * Projects landing page: every project the signed-in user belongs to, with
 * create, search, sort, and grid/list views. Search and sort are driven off the
 * server list endpoint (search debounced); favorite, rename, duplicate and
 * delete persist on the server. The chosen view is remembered locally.
 */
export function ProjectsPage() {
  const api = useApi();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>(
    () => (localStorage.getItem(SORT_KEY) as Sort) || "recent",
  );
  const [view, setView] = useState<View>(
    () => (localStorage.getItem(VIEW_KEY) as View) || "grid",
  );

  // Debounce the search box so each keystroke doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE);
    return () => clearTimeout(t);
  }, [query]);

  const { data: projects, loading, error, reload } = useAsync(
    () => api.listProjects({ q: debounced || undefined, sort }),
    [api, debounced, sort],
  );

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  // Optimistic favorite overrides, keyed by project id, until the next reload.
  const [favOverride, setFavOverride] = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);
  useEffect(() => localStorage.setItem(SORT_KEY, sort), [sort]);

  // Close any open card menu when clicking outside it.
  useEffect(() => {
    if (!openMenu) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-keepmenu]")) setOpenMenu(null);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [openMenu]);

  const isFav = (p: Project) => favOverride[p.id] ?? p.favorite ?? false;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api.createProject(name.trim());
      setName("");
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rename(p: Project, newName: string) {
    setActionError(undefined);
    try {
      await api.renameProject(p.id, newName);
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function duplicate(p: Project) {
    setOpenMenu(null);
    setActionError(undefined);
    try {
      await api.duplicateProject(p.id);
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function remove(p: Project) {
    setOpenMenu(null);
    if (
      !window.confirm(
        `Delete "${p.name}"? This permanently removes the project and everything in it.`,
      )
    )
      return;
    setActionError(undefined);
    try {
      await api.deleteProject(p.id);
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function toggleStar(p: Project) {
    const next = !isFav(p);
    setFavOverride((o) => ({ ...o, [p.id]: next }));
    try {
      await api.setProjectFavorite(p.id, next);
    } catch (err) {
      setFavOverride((o) => ({ ...o, [p.id]: !next })); // revert on failure
      setActionError((err as Error).message);
    }
  }

  const visible = projects ?? [];
  const total = visible.length;
  const isEmpty = !loading && !error && total === 0;

  const cardHandlers = (p: Project) => ({
    project: p,
    favorite: isFav(p),
    menuOpen: openMenu === p.id,
    onStar: () => toggleStar(p),
    onMenu: () => setOpenMenu((m) => (m === p.id ? null : p.id)),
    onRename: (n: string) => rename(p, n),
    onDuplicate: () => duplicate(p),
    onDelete: () => remove(p),
  });

  return (
    <div className="projects">
      <div className="pj-head">
        <div className="pj-title-row">
          <h1>Projects</h1>
          <span className="pj-count">{total}</span>
        </div>
        <p className="pj-sub">Everything you're building, in one place.</p>
      </div>

      <form className="pj-create" onSubmit={create}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          maxLength={120}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
      {actionError && <p className="error">{actionError}</p>}

      <div className="pj-toolbar">
        <label className="pj-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
          />
        </label>
        <div className="pj-toolbar-spacer" />
        <div className="pj-seg">
          <button
            type="button"
            className={sort === "recent" ? "pj-seg-btn active" : "pj-seg-btn"}
            onClick={() => setSort("recent")}
          >
            Recent
          </button>
          <button
            type="button"
            className={sort === "name" ? "pj-seg-btn active" : "pj-seg-btn"}
            onClick={() => setSort("name")}
          >
            Name
          </button>
        </div>
        <div className="pj-seg">
          <button
            type="button"
            className={view === "grid" ? "pj-icon-btn active" : "pj-icon-btn"}
            onClick={() => setView("grid")}
            title="Grid view"
            aria-label="Grid view"
          >
            <GridIcon />
          </button>
          <button
            type="button"
            className={view === "list" ? "pj-icon-btn active" : "pj-icon-btn"}
            onClick={() => setView("list")}
            title="List view"
            aria-label="List view"
          >
            <ListIcon />
          </button>
        </div>
      </div>

      {loading && !projects && <Loading>Loading projects…</Loading>}
      {error && <RetryError message={error} onRetry={reload} />}

      {isEmpty && (
        <div className="pj-empty">
          <div className="pj-empty-mark" />
          <div className="pj-empty-title">
            {debounced ? "No matching projects" : "No projects yet"}
          </div>
          <div className="pj-empty-body">
            {debounced
              ? "Nothing matches your search. Try a different name."
              : "Create your first project above to get started."}
          </div>
        </div>
      )}

      {!isEmpty &&
        (view === "grid" ? (
          <div className="pj-grid">
            {visible.map((p) => (
              <ProjectCard key={p.id} {...cardHandlers(p)} />
            ))}
          </div>
        ) : (
          <div className="pj-list">
            {visible.map((p) => (
              <ProjectRow key={p.id} {...cardHandlers(p)} />
            ))}
          </div>
        ))}
    </div>
  );
}

interface CardProps {
  project: Project;
  favorite: boolean;
  menuOpen: boolean;
  onStar: () => void;
  onMenu: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** A subtle striped cover, tinted by the project's hue. */
function coverStyle(hue: number): React.CSSProperties {
  const tint = `oklch(0.93 0.035 ${hue})`;
  const stripe = `oklch(0.875 0.045 ${hue})`;
  return {
    background: tint,
    backgroundImage: `repeating-linear-gradient(135deg, ${stripe} 0 1.5px, transparent 1.5px 12px)`,
  };
}

function ProjectCard({
  project,
  favorite,
  menuOpen,
  onStar,
  onMenu,
  onRename,
  onDuplicate,
  onDelete,
}: CardProps) {
  const hue = hueOf(project);
  const role = project.role ?? "viewer";
  return (
    <div className="pj-card">
      <Link
        className="pj-hit"
        to={`/app/projects/${project.id}`}
        aria-label={`Open ${project.name}`}
      />
      <div className="pj-cover" style={coverStyle(hue)}>
        <span
          className="pj-cover-mono"
          style={{ color: `oklch(0.55 0.09 ${hue})` }}
        >
          {project.name.charAt(0).toUpperCase()}
        </span>
        <StarButton
          favorite={favorite}
          onStar={onStar}
          className="pj-cover-star"
        />
      </div>
      <div className="pj-card-body">
        <EditableTitle
          name={project.name}
          editable={role === "owner"}
          className="pj-card-name"
          onRename={onRename}
        />
        <div className="pj-card-meta">
          <span className={`badge ${role}`}>{role}</span>
          <span className="pj-edited">{relTime(project.updatedAt)}</span>
        </div>
        <div className="pj-card-foot">
          <MemberAvatars project={project} />
          <Menu
            open={menuOpen}
            onMenu={onMenu}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            canDelete={role === "owner"}
          />
        </div>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  favorite,
  menuOpen,
  onStar,
  onMenu,
  onRename,
  onDuplicate,
  onDelete,
}: CardProps) {
  const hue = hueOf(project);
  const role = project.role ?? "viewer";
  return (
    <div className="pj-row">
      <Link
        className="pj-hit"
        to={`/app/projects/${project.id}`}
        aria-label={`Open ${project.name}`}
      />
      <div
        className="pj-row-square"
        style={{ ...coverStyle(hue), color: `oklch(0.55 0.09 ${hue})` }}
      >
        {project.name.charAt(0).toUpperCase()}
      </div>
      <div className="pj-row-text">
        <EditableTitle
          name={project.name}
          editable={role === "owner"}
          className="pj-row-name"
          onRename={onRename}
        />
        <div className="pj-edited">Edited {relTime(project.updatedAt)}</div>
      </div>
      <div className="pj-row-spacer" />
      <MemberAvatars project={project} />
      <span className={`badge ${role}`}>{role}</span>
      <StarButton favorite={favorite} onStar={onStar} />
      <Menu
        open={menuOpen}
        onMenu={onMenu}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        canDelete={role === "owner"}
      />
    </div>
  );
}

/**
 * The project name. For owners it's double-click-to-rename: an inline input
 * commits on Enter/blur and cancels on Escape. It sits above the card's
 * stretched link so the double-click lands on the text, not the navigation.
 */
function EditableTitle({
  name,
  editable,
  className,
  onRename,
}: {
  name: string;
  editable: boolean;
  className: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  if (!editable) return <div className={className}>{name}</div>;

  function commit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setEditing(false);
  }

  function startEditing() {
    setValue(name);
    setEditing(true);
  }

  if (editing) {
    return (
      <input
        ref={(el) => el?.focus()}
        className={`${className} pj-rename`}
        value={value}
        maxLength={120}
        onClick={(e) => e.preventDefault()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setValue(name);
            setEditing(false);
          }
        }}
      />
    );
  }

  // Double-click (mouse) or Enter/F2 (keyboard) starts the inline rename. A real
  // button (chrome reset in CSS) keeps it focusable and above the card's link.
  return (
    <button
      type="button"
      className={`${className} pj-name-editable`}
      title="Double-click to rename"
      onClick={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startEditing();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          startEditing();
        }
      }}
    >
      {name}
    </button>
  );
}

/** Overlapping avatar stack for a project's member preview, with +N overflow. */
function MemberAvatars({ project }: { project: Project }) {
  const members = project.members ?? [];
  if (members.length === 0) return null;
  const extra = (project.memberCount ?? members.length) - members.length;
  return (
    <div className="pj-avatars">
      {members.map((m) => {
        const a = avatarOf(m);
        return (
          <span
            key={m.userId}
            className="pj-avatar"
            style={{ background: a.color }}
            title={m.email ?? m.userId}
          >
            {a.initials}
          </span>
        );
      })}
      {extra > 0 && <span className="pj-avatar pj-avatar-more">+{extra}</span>}
    </div>
  );
}

function StarButton({
  favorite,
  onStar,
  className,
}: {
  favorite: boolean;
  onStar: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`pj-star ${className ?? ""} ${favorite ? "on" : ""}`}
      aria-label={favorite ? "Unstar project" : "Star project"}
      aria-pressed={favorite}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onStar();
      }}
    >
      {favorite ? "★" : "☆"}
    </button>
  );
}

function Menu({
  open,
  onMenu,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  open: boolean;
  onMenu: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div className="pj-menu" data-keepmenu>
      <button
        type="button"
        className="pj-menu-btn"
        aria-label="Project actions"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMenu();
        }}
      >
        <span />
        <span />
        <span />
      </button>
      {open && (
        <div className="pj-menu-pop">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDuplicate();
            }}
          >
            Duplicate
          </button>
          {canDelete && (
            <button
              type="button"
              className="pj-menu-danger"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pj-search-icon"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M11 11l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <span className="pj-grid-glyph" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function ListIcon() {
  return (
    <span className="pj-list-glyph" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
