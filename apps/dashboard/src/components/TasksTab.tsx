import { useEffect, useMemo, useState } from "react";
import {
  applyTaskChange,
  commentOnTask,
  newTask,
  type Task,
  type TaskActivity,
  type TaskStatus,
  type TaskType,
} from "forward-core";
import { useApi, type Member } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { useProject } from "../api/ProjectContext.js";
import { Avatar, AvatarStack } from "./Avatar.js";
import { TaskGantt } from "./TaskGantt.js";
import {
  KNOWN_LABELS,
  dateInputValue,
  metaColor,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
  TYPE_META,
  labelColor,
  personOf,
  relTime,
  shortDate,
  tint,
  type Person,
} from "./tasks-format.js";

export function TasksTab() {
  const api = useApi();
  const { projectId, canWrite, myUid, members, lastChange } = useProject();
  const { data: tasks, loading, error, reload } = useAsync(
    () => api.listTasks(projectId),
    [api, projectId],
  );

  // Live: refetch when the shared project channel reports a tasks change.
  useEffect(() => {
    if (lastChange?.resource === "tasks") reload();
  }, [lastChange, reload]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "timeline">("list");
  const [mutateError, setMutateError] = useState<string>();

  // The uid stamped on activity events this user creates.
  const actor = myUid ?? "you";

  /** Persist a whole task, then refresh. The server re-stamps updatedAt. */
  async function save(task: Task) {
    setMutateError(undefined);
    try {
      await api.saveTask(projectId, task);
      reload();
    } catch (err) {
      setMutateError((err as Error).message);
    }
  }

  const selected = tasks?.find((t) => t.id === selectedId) ?? null;

  return (
    <section className="tab-body">
      {mutateError && <p className="error">{mutateError}</p>}
      {error && <p className="error">{error}</p>}

      {selected ? (
        <TaskDetail
          task={selected}
          allTasks={tasks ?? []}
          canWrite={canWrite}
          members={members}
          myUid={myUid}
          actor={actor}
          onOpen={setSelectedId}
          onBack={() => setSelectedId(null)}
          onSave={save}
        />
      ) : (
        <>
          <div className="tk-viewswitch">
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              List
            </button>
            <button
              type="button"
              className={view === "timeline" ? "active" : ""}
              onClick={() => setView("timeline")}
            >
              Timeline
            </button>
          </div>

          {view === "list" ? (
            <TaskList
              tasks={tasks}
              loading={loading}
              canWrite={canWrite}
              members={members}
              myUid={myUid}
              actor={actor}
              onOpen={setSelectedId}
              onSave={save}
              onCreate={async (title) => {
                await save(
                  newTask(
                    { title },
                    { actor, existingKeys: (tasks ?? []).map((t) => t.key) },
                  ),
                );
              }}
              onDelete={async (id) => {
                setMutateError(undefined);
                try {
                  await api.deleteTask(projectId, id);
                  reload();
                } catch (err) {
                  setMutateError((err as Error).message);
                }
              }}
            />
          ) : (
            <TaskGantt
              tasks={tasks}
              members={members}
              myUid={myUid}
              onOpen={setSelectedId}
            />
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

type Filter = "all" | TaskStatus;

function TaskList({
  tasks,
  loading,
  canWrite,
  members,
  myUid,
  actor,
  onOpen,
  onCreate,
  onDelete,
  onSave,
}: {
  tasks: Task[] | undefined;
  loading: boolean;
  canWrite: boolean;
  members: Member[] | undefined;
  myUid: string | undefined;
  actor: string;
  onOpen: (id: string) => void;
  onCreate: (title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSave: (task: Task) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onCreate(title.trim());
    setTitle("");
    setBusy(false);
  }

  function cycleStatus(task: Task) {
    const i = STATUS_ORDER.indexOf(task.status);
    const next = STATUS_ORDER[(i + 1) % STATUS_ORDER.length]!;
    void onSave(applyTaskChange(task, { status: next }, actor));
  }

  const visible = (tasks ?? []).filter((t) =>
    filter === "all" ? true : t.status === filter,
  );
  const openCount = (tasks ?? []).filter((t) => t.status !== "done").length;
  const doneCount = (tasks ?? []).filter((t) => t.status === "done").length;

  return (
    <div className="tasks">
      {canWrite ? (
        <form className="row" onSubmit={add}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New task title"
          />
          <button type="submit" disabled={busy || !title.trim()}>
            {busy ? "Adding…" : "Add task"}
          </button>
        </form>
      ) : (
        <p className="muted small">You have read-only access to this project.</p>
      )}

      <div className="tk-filters">
        {(["all", ...STATUS_ORDER] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`tk-pill ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : STATUS_META[f].label}
          </button>
        ))}
        <span className="tk-counts mono">
          {openCount} open · {doneCount} done
        </span>
      </div>

      {loading && !tasks && <p className="muted">Loading tasks…</p>}
      {tasks && visible.length === 0 && (
        <p className="muted">No tasks{filter === "all" ? " yet" : " in this view"}.</p>
      )}

      <div className="tk-rows">
        {visible.map((t) => (
          <div key={t.id} className="tk-row">
            <button
              type="button"
              className="tk-row-open"
              onClick={() => onOpen(t.id)}
            >
              <span
                className="tk-type-dot"
                style={{ background: TYPE_META[t.type].color }}
                title={TYPE_META[t.type].label}
              />
              <div className="tk-row-main">
                <div className="tk-row-head">
                  <span className="tk-key mono">{t.key ?? "—"}</span>
                  <span className="tk-row-title">{t.title}</span>
                </div>
                {t.labels.length > 0 && (
                  <div className="tk-row-labels">
                    {t.labels.map((l) => (
                      <span
                        key={l}
                        className="tk-label mono"
                        style={{ color: labelColor(l), background: tint(labelColor(l), 0.14) }}
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="tk-due mono">{shortDate(t.dueDate)}</span>
              <AvatarStack people={t.assignees.map((u) => personOf(u, members, myUid))} />
            </button>
            <div className="tk-row-meta">
              <button
                type="button"
                className="tk-status-btn"
                disabled={!canWrite}
                onClick={(e) => {
                  e.stopPropagation();
                  cycleStatus(t);
                }}
              >
                <span
                  className="tk-dot"
                  style={{ background: STATUS_META[t.status].color }}
                />
                {STATUS_META[t.status].label}
              </button>
              {canWrite && (
                <button
                  type="button"
                  className="danger tk-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(t.id);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function TaskDetail({
  task,
  allTasks,
  canWrite,
  members,
  myUid,
  actor,
  onOpen,
  onBack,
  onSave,
}: {
  task: Task;
  allTasks: Task[];
  canWrite: boolean;
  members: Member[] | undefined;
  myUid: string | undefined;
  actor: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  onSave: (task: Task) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [desc, setDesc] = useState(task.description);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [depPickerOpen, setDepPickerOpen] = useState(false);

  // Re-seed the description editor whenever the task changes (switching tasks,
  // or a realtime refetch brings a newer body).
  useEffect(() => {
    setDesc(task.description);
  }, [task.description]);

  function change(patch: Parameters<typeof applyTaskChange>[1]) {
    void onSave(applyTaskChange(task, patch, actor));
  }

  function saveDescription() {
    const next = desc.trim();
    if (next === task.description.trim()) return;
    change({ description: next });
  }

  const type = TYPE_META[task.type];
  const links = useMemo(
    () =>
      [
        task.elementId && { label: "element", value: task.elementId },
        task.endpointId && { label: "endpoint", value: task.endpointId },
        task.flowId && { label: "flow", value: task.flowId },
      ].filter(Boolean) as { label: string; value: string }[],
    [task.elementId, task.endpointId, task.flowId],
  );

  function toggleAssignee(uid: string) {
    const has = task.assignees.includes(uid);
    change({
      assignees: has
        ? task.assignees.filter((u) => u !== uid)
        : [...task.assignees, uid],
    });
  }
  function toggleLabel(name: string) {
    const has = task.labels.includes(name);
    change({
      labels: has
        ? task.labels.filter((l) => l !== name)
        : [...task.labels, name],
    });
  }
  function toggleDependency(id: string) {
    const has = task.dependsOn.includes(id);
    change({
      dependsOn: has
        ? task.dependsOn.filter((d) => d !== id)
        : [...task.dependsOn, id],
    });
  }

  // Other tasks this one can depend on, and a resolver for the stored ids.
  const byId = useMemo(
    () => new Map(allTasks.map((t) => [t.id, t])),
    [allTasks],
  );
  const dependencyOptions = allTasks.filter((t) => t.id !== task.id);
  const label = (t: Task) => `${t.key ?? "—"} ${t.title}`;
  function addComment() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    void onSave(commentOnTask(task, actor, body));
  }

  const assignablePeople = (members ?? []).map((m) => m.uid);
  const reporter = task.reporter ? personOf(task.reporter, members, myUid) : null;

  return (
    <div className="tk-detail">
      <button type="button" className="tk-back" onClick={onBack}>
        ← All tasks
      </button>

      <div className="tk-detail-grid">
        {/* ---- main column ---- */}
        <div className="tk-detail-main">
          <div className="tk-detail-head">
            <span
              className="tk-type-badge mono"
              style={{ color: type.color, background: tint(type.color, 0.14) }}
            >
              {type.label}
            </span>
            <span className="tk-key mono">{task.key ?? "—"}</span>
          </div>
          <h1 className="tk-detail-title">{task.title}</h1>

          <div className="section-label">Description</div>
          {canWrite ? (
            <>
              <textarea
                className="tk-desc-box tk-desc-edit"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Add a description…"
                rows={3}
              />
              {desc !== task.description && (
                <div className="tk-desc-actions">
                  <button
                    type="button"
                    className="tk-desc-save"
                    onClick={saveDescription}
                  >
                    Save description
                  </button>
                  <button
                    type="button"
                    className="tk-desc-discard"
                    onClick={() => setDesc(task.description)}
                  >
                    Discard
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="tk-desc-box">
              {task.description.trim() || (
                <span className="muted">No description yet.</span>
              )}
            </div>
          )}

          {links.length > 0 && (
            <div className="tk-links">
              {links.map((l) => (
                <div key={l.label} className="tk-link-row">
                  <span className="tk-dot" style={{ background: "var(--accent)" }} />
                  <span className="mono muted">linked {l.label}</span>
                  <span className="mono">{l.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="tk-activity-head">
            <span className="section-label" style={{ margin: 0 }}>
              History &amp; activity
            </span>
            <span className="mono muted small">{task.activity.length} events</span>
          </div>

          <div className="tk-feed">
            {task.activity.map((a) => (
              <ActivityRow
                key={a.id}
                entry={a}
                person={personOf(a.actor, members, myUid)}
                resolveName={(uid) => personOf(uid, members, myUid).name}
              />
            ))}

            {canWrite && (
              <div className="tk-composer-row">
                <Avatar person={personOf(myUid ?? "you", members, myUid)} size={30} />
                <div className="tk-composer">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Leave a comment, @mention a teammate…"
                    rows={2}
                  />
                  <div className="tk-composer-actions">
                    {(members ?? [])
                      .filter((m) => m.uid !== myUid)
                      .slice(0, 4)
                      .map((m) => {
                        const p = personOf(m.uid, members, myUid);
                        return (
                          <button
                            key={m.uid}
                            type="button"
                            className="tk-mention"
                            onClick={() =>
                              setDraft((d) => `${d.replace(/\s*$/, "")} @${p.name} `.trimStart())
                            }
                          >
                            <Avatar person={p} size={18} />
                            {p.name}
                          </button>
                        );
                      })}
                    <button
                      type="button"
                      className="tk-comment-btn"
                      onClick={addComment}
                      disabled={!draft.trim()}
                    >
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- sidebar ---- */}
        <aside className="tk-sidebar">
          <div className="tk-side-block">
            <div className="section-label" style={{ margin: "0 0 0.6rem" }}>Status</div>
            <div className="tk-chip-grid">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!canWrite}
                  className={`tk-choice ${s === task.status ? "active" : ""}`}
                  style={s === task.status ? activeChip(STATUS_META[s].color) : undefined}
                  onClick={() => change({ status: s })}
                >
                  <span className="tk-dot" style={{ background: STATUS_META[s].color }} />
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>

          <div className="tk-side-block">
            <div className="section-label" style={{ margin: "0 0 0.6rem" }}>Type</div>
            <div className="tk-chip-grid">
              {(Object.keys(TYPE_META) as TaskType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={!canWrite}
                  className={`tk-choice ${t === task.type ? "active" : ""}`}
                  style={t === task.type ? activeChip(TYPE_META[t].color) : undefined}
                  onClick={() => change({ type: t })}
                >
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          <div className="tk-side-block">
            <div className="section-label" style={{ margin: "0 0 0.6rem" }}>Assignees</div>
            <div className="tk-people">
              {task.assignees.length === 0 && (
                <span className="muted small">Unassigned</span>
              )}
              {task.assignees.map((u) => {
                const p = personOf(u, members, myUid);
                return (
                  <div key={u} className="tk-person">
                    <Avatar person={p} size={26} />
                    <span>{p.name}</span>
                  </div>
                );
              })}
            </div>
            {canWrite && (
              <button
                type="button"
                className="tk-add-dashed"
                onClick={() => setAssigneePickerOpen((o) => !o)}
              >
                + Assign person
              </button>
            )}
            {assigneePickerOpen && (
              <div className="tk-picker">
                {assignablePeople.map((u) => {
                  const p = personOf(u, members, myUid);
                  const on = task.assignees.includes(u);
                  return (
                    <button
                      key={u}
                      type="button"
                      className="tk-picker-row"
                      onClick={() => toggleAssignee(u)}
                    >
                      <Avatar person={p} size={20} />
                      <span className="tk-picker-name">{p.name}</span>
                      {on && <span className="tk-check mono">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="tk-side-block">
            <div className="section-label" style={{ margin: "0 0 0.6rem" }}>Reporter</div>
            {reporter ? (
              <div className="tk-person">
                <Avatar person={reporter} size={26} />
                <span>{reporter.name}</span>
              </div>
            ) : (
              <span className="muted small">Unknown</span>
            )}
          </div>

          <div className="tk-side-block">
            <div className="section-label" style={{ margin: "0 0 0.6rem" }}>Priority</div>
            <div className="tk-chip-grid">
              {PRIORITY_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!canWrite}
                  className={`tk-choice ${p === task.priority ? "active" : ""}`}
                  style={p === task.priority ? activeChip(PRIORITY_META[p].color) : undefined}
                  onClick={() => change({ priority: p })}
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </div>

          <div className="tk-side-block">
            <div className="section-label" style={{ margin: "0 0 0.6rem" }}>Labels</div>
            <div className="tk-row-labels">
              {task.labels.length === 0 && <span className="muted small">None</span>}
              {task.labels.map((l) => (
                <span
                  key={l}
                  className="tk-label mono"
                  style={{ color: labelColor(l), background: tint(labelColor(l), 0.14) }}
                >
                  {l}
                </span>
              ))}
            </div>
            {canWrite && (
              <button
                type="button"
                className="tk-add-dashed"
                onClick={() => setLabelPickerOpen((o) => !o)}
              >
                + Add label
              </button>
            )}
            {labelPickerOpen && (
              <div className="tk-picker">
                {KNOWN_LABELS.map((l) => {
                  const on = task.labels.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      className="tk-picker-row"
                      onClick={() => toggleLabel(l)}
                    >
                      <span className="tk-dot" style={{ background: labelColor(l) }} />
                      <span className="tk-picker-name">{l}</span>
                      {on && <span className="tk-check mono">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="tk-side-block">
            <div className="section-label" style={{ margin: "0 0 0.6rem" }}>Depends on</div>
            <div className="tk-deps">
              {task.dependsOn.length === 0 && <span className="muted small">Nothing</span>}
              {task.dependsOn.map((id) => {
                const dep = byId.get(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="tk-dep-chip"
                    onClick={() => dep && onOpen(id)}
                    title={dep ? label(dep) : id}
                  >
                    <span className="mono">{dep?.key ?? "—"}</span>
                    <span className="tk-dep-title">{dep ? dep.title : "(deleted task)"}</span>
                  </button>
                );
              })}
            </div>
            {canWrite && dependencyOptions.length > 0 && (
              <button
                type="button"
                className="tk-add-dashed"
                onClick={() => setDepPickerOpen((o) => !o)}
              >
                + Add dependency
              </button>
            )}
            {depPickerOpen && (
              <div className="tk-picker">
                {dependencyOptions.map((t) => {
                  const on = task.dependsOn.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="tk-picker-row"
                      onClick={() => toggleDependency(t.id)}
                    >
                      <span
                        className="tk-dot"
                        style={{ background: TYPE_META[t.type].color }}
                      />
                      <span className="tk-picker-name">
                        <span className="mono muted">{t.key ?? "—"}</span> {t.title}
                      </span>
                      {on && <span className="tk-check mono">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="tk-side-block tk-dates">
            <div className="tk-date-row">
              <span className="mono muted">Due</span>
              {canWrite ? (
                <input
                  type="date"
                  className="tk-date-input"
                  value={dateInputValue(task.dueDate)}
                  onChange={(e) => change({ dueDate: e.target.value || undefined })}
                />
              ) : (
                <span>{shortDate(task.dueDate)}</span>
              )}
            </div>
            <div className="tk-date-row">
              <span className="mono muted">Created</span>
              <span className="muted">{shortDate(task.createdAt)}</span>
            </div>
            <div className="tk-date-row">
              <span className="mono muted">Updated</span>
              <span className="muted">{relTime(task.updatedAt)}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ActivityRow({
  entry,
  person,
  resolveName,
}: {
  entry: TaskActivity;
  person: Person;
  /** Resolve a uid target (e.g. an assignee) to its display name. */
  resolveName: (uid: string) => string;
}) {
  if (entry.kind === "comment") {
    return (
      <div className="tk-event tk-comment">
        <Avatar person={person} size={30} className="tk-event-avatar" />
        <div className="tk-event-body">
          <div className="tk-event-meta">
            <span className="tk-event-actor">{person.name}</span>
            <span className="mono muted small">{relTime(entry.at)}</span>
          </div>
          <div className="tk-comment-box">{entry.body}</div>
        </div>
      </div>
    );
  }
  // Assignee events store the uid in `target`; resolve it to a name for display.
  const isPersonTarget = entry.verb === "assigned" || entry.verb === "unassigned";
  const displayTarget =
    entry.target && isPersonTarget ? resolveName(entry.target) : entry.target;
  const targetColor = entry.target ? metaColor(entry.target) : undefined;
  const badgeColor = metaColor(entry.badge ?? "") ?? "#bf5a36";
  return (
    <div className="tk-event">
      <span className="tk-event-dot" style={{ background: person.color }} />
      <div className="tk-event-line">
        <span className="tk-event-actor">{person.name}</span> {entry.verb}
        {displayTarget &&
          (targetColor ? (
            <>
              {" "}
              <span
                className="tk-event-tag mono"
                style={{ color: targetColor, background: tint(targetColor, 0.14) }}
              >
                {displayTarget}
              </span>
            </>
          ) : (
            ` ${displayTarget}`
          ))}
        {entry.badge && (
          <span
            className="tk-event-tag mono"
            style={{ color: badgeColor, background: tint(badgeColor, 0.14) }}
          >
            {entry.badge}
          </span>
        )}
        <span className="mono muted small"> · {relTime(entry.at)}</span>
      </div>
    </div>
  );
}

function activeChip(color: string): React.CSSProperties {
  return { borderColor: color, background: tint(color, 0.12) };
}
