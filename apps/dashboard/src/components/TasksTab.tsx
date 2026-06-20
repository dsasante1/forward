import { useEffect, useState } from "react";
import type { Task, TaskStatus } from "forward-core";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { useProject } from "../api/ProjectContext.js";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export function TasksTab() {
  const api = useApi();
  const { projectId, canWrite, lastChange } = useProject();
  const { data: tasks, loading, error, reload } = useAsync(
    () => api.listTasks(projectId),
    [api, projectId],
  );

  // Live: refetch when the shared project channel reports a tasks change.
  useEffect(() => {
    if (lastChange?.resource === "tasks") reload();
  }, [lastChange, reload]);

  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutateError, setMutateError] = useState<string>();

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setMutateError(undefined);
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      title: title.trim(),
      description: "",
      status: "todo",
      createdAt: now,
      updatedAt: now,
    };
    try {
      await api.saveTask(projectId, task);
      setTitle("");
      reload();
    } catch (err) {
      setMutateError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(task: Task, status: TaskStatus) {
    setMutateError(undefined);
    try {
      // Save the in-hand task with the new status (server re-stamps updatedAt);
      // avoids patchTask's full-list refetch just to read the one task.
      await api.saveTask(projectId, { ...task, status });
      reload();
    } catch (err) {
      setMutateError((err as Error).message);
    }
  }

  async function remove(task: Task) {
    setMutateError(undefined);
    try {
      await api.deleteTask(projectId, task.id);
      reload();
    } catch (err) {
      setMutateError((err as Error).message);
    }
  }

  return (
    <section className="tab-body">
      {canWrite ? (
        <form className="row" onSubmit={addTask}>
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
      {mutateError && <p className="error">{mutateError}</p>}

      {loading && <p className="muted">Loading tasks…</p>}
      {error && <p className="error">{error}</p>}
      {tasks && tasks.length === 0 && <p className="muted">No tasks yet.</p>}

      <ul className="list">
        {tasks?.map((t) => (
          <li key={t.id} className="list-row">
            <span className={`status-dot ${t.status}`} />
            <span className="list-title">{t.title}</span>
            {canWrite ? (
              <>
                <select
                  value={t.status}
                  onChange={(e) => setStatus(t, e.target.value as TaskStatus)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <button type="button" className="danger" onClick={() => remove(t)}>
                  Delete
                </button>
              </>
            ) : (
              <span className="badge">{STATUS_LABEL[t.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
