import { useEffect, useMemo, useState } from "react";
import type {
  Task,
  TaskActivity,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "forward-core";
import { useApi, type Member } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { useProject } from "../api/ProjectContext.js";
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
  nextKey,
  personOf,
  relTime,
  shortDate,
  tint,
  type Person,
} from "./tasks-format.js";

function uuid(): string {
  return crypto.randomUUID();
}

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
  const [mutateError, setMutateError] = useState<string>();

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

  /** Append an activity entry stamped to the current user + now. */
  function withActivity(task: Task, entry: Omit<TaskActivity, "id" | "actor" | "at">): Task {
    return {
      ...task,
      updatedAt: new Date().toISOString(),
      activity: [
        ...task.activity,
        { id: uuid(), actor: myUid ?? "you", at: new Date().toISOString(), ...entry },
      ],
    };
  }

  const selected = tasks?.find((t) => t.id === selectedId) ?? null;

  return (
    <section className="tab-body">
      {mutateError && <p className="error">{mutateError}</p>}
      {error && <p className="error">{error}</p>}

      {selected ? (
        <TaskDetail
          task={selected}
          canWrite={canWrite}
          members={members}
          myUid={myUid}
          onBack={() => setSelectedId(null)}
          onSave={save}
          withActivity={withActivity}
        />
      ) : (
        <TaskList
          tasks={tasks}
          loading={loading}
          canWrite={canWrite}
          members={members}
          myUid={myUid}
          onOpen={setSelectedId}
          onSave={save}
          withActivity={withActivity}
          onCreate={async (title) => {
            const now = new Date().toISOString();
            const task: Task = {
              id: uuid(),
              key: nextKey((tasks ?? []).map((t) => t.key)),
              title,
              description: "",
              type: "task",
              status: "todo",
              priority: "medium",
              labels: [],
              assignees: [],
              reporter: myUid,
              activity: [
                { id: uuid(), kind: "event", actor: myUid ?? "you", at: now, verb: "created this task" },
              ],
              createdAt: now,
              updatedAt: now,
            };
            await save(task);
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
  onOpen,
  onCreate,
  onDelete,
  onSave,
  withActivity,
}: {
  tasks: Task[] | undefined;
  loading: boolean;
  canWrite: boolean;
  members: Member[] | undefined;
  myUid: string | undefined;
  onOpen: (id: string) => void;
  onCreate: (title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSave: (task: Task) => Promise<void>;
  withActivity: (task: Task, e: Omit<TaskActivity, "id" | "actor" | "at">) => Task;
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
    void onSave(
      withActivity({ ...task, status: next }, {
        kind: "event",
        verb: "changed status to",
        target: STATUS_META[next].label,
      }),
    );
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
  canWrite,
  members,
  myUid,
  onBack,
  onSave,
  withActivity,
}: {
  task: Task;
  canWrite: boolean;
  members: Member[] | undefined;
  myUid: string | undefined;
  onBack: () => void;
  onSave: (task: Task) => Promise<void>;
  withActivity: (task: Task, e: Omit<TaskActivity, "id" | "actor" | "at">) => Task;
}) {
  const [draft, setDraft] = useState("");
  const [desc, setDesc] = useState(task.description);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);

  // Re-seed the description editor whenever the task changes (switching tasks,
  // or a realtime refetch brings a newer body).
  useEffect(() => {
    setDesc(task.description);
  }, [task.description]);

  function saveDescription() {
    const next = desc.trim();
    if (next === task.description.trim()) return;
    void onSave(
      withActivity({ ...task, description: next }, {
        kind: "event",
        verb: task.description.trim() ? "edited the description" : "added a description",
      }),
    );
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

  function setStatus(s: TaskStatus) {
    if (s === task.status) return;
    void onSave(
      withActivity({ ...task, status: s }, {
        kind: "event",
        verb: "changed status to",
        target: STATUS_META[s].label,
      }),
    );
  }
  function setPriority(p: TaskPriority) {
    if (p === task.priority) return;
    void onSave(
      withActivity({ ...task, priority: p }, {
        kind: "event",
        verb: "set priority",
        badge: PRIORITY_META[p].label,
      }),
    );
  }
  function setType(t: TaskType) {
    if (t === task.type) return;
    void onSave(
      withActivity({ ...task, type: t }, {
        kind: "event",
        verb: "changed type to",
        target: TYPE_META[t].label,
      }),
    );
  }
  function toggleAssignee(uid: string) {
    const has = task.assignees.includes(uid);
    const assignees = has
      ? task.assignees.filter((u) => u !== uid)
      : [...task.assignees, uid];
    void onSave(
      withActivity({ ...task, assignees }, {
        kind: "event",
        verb: has ? "unassigned" : "assigned",
        target: personOf(uid, members, myUid).name,
      }),
    );
  }
  function toggleLabel(name: string) {
    const has = task.labels.includes(name);
    const labels = has
      ? task.labels.filter((l) => l !== name)
      : [...task.labels, name];
    void onSave(
      withActivity({ ...task, labels }, {
        kind: "event",
        verb: has ? "removed label" : "added label",
        badge: name,
      }),
    );
  }
  function addComment() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    void onSave(withActivity(task, { kind: "comment", body }));
  }
  function setDueDate(value: string) {
    const next = value || undefined; // empty input clears the due date
    if ((next ?? "") === (task.dueDate ?? "")) return;
    void onSave(
      withActivity({ ...task, dueDate: next }, {
        kind: "event",
        verb: next ? "set due date" : "cleared the due date",
        target: next ? shortDate(next) : undefined,
      }),
    );
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
                  onClick={() => setStatus(s)}
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
                  onClick={() => setType(t)}
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
                  onClick={() => setPriority(p)}
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

          <div className="tk-side-block tk-dates">
            <div className="tk-date-row">
              <span className="mono muted">Due</span>
              {canWrite ? (
                <input
                  type="date"
                  className="tk-date-input"
                  value={dateInputValue(task.dueDate)}
                  onChange={(e) => setDueDate(e.target.value)}
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

function ActivityRow({ entry, person }: { entry: TaskActivity; person: Person }) {
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
  const targetColor = entry.target ? metaColor(entry.target) : undefined;
  const badgeColor = metaColor(entry.badge ?? "") ?? "#bf5a36";
  return (
    <div className="tk-event">
      <span className="tk-event-dot" style={{ background: person.color }} />
      <div className="tk-event-line">
        <span className="tk-event-actor">{person.name}</span> {entry.verb}
        {entry.target &&
          (targetColor ? (
            <>
              {" "}
              <span
                className="tk-event-tag mono"
                style={{ color: targetColor, background: tint(targetColor, 0.14) }}
              >
                {entry.target}
              </span>
            </>
          ) : (
            ` ${entry.target}`
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

function Avatar({
  person,
  size,
  className = "",
}: {
  person: Person;
  size: number;
  className?: string;
}) {
  return (
    <span
      className={`tk-avatar ${className}`}
      style={{
        width: size,
        height: size,
        background: person.color,
        fontSize: Math.round(size * 0.38),
      }}
      title={person.name}
    >
      {person.initials}
    </span>
  );
}

function AvatarStack({ people }: { people: Person[] }) {
  if (people.length === 0) return null;
  return (
    <div className="tk-avatar-stack">
      {people.map((p) => (
        <Avatar key={p.uid} person={p} size={24} className="tk-stacked" />
      ))}
    </div>
  );
}

function activeChip(color: string): React.CSSProperties {
  return { borderColor: color, background: tint(color, 0.12) };
}
