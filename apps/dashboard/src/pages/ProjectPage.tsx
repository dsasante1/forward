import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { useProjectRealtime } from "../api/realtime.js";
import { TasksTab } from "../components/TasksTab.js";
import { DocsTab } from "../components/DocsTab.js";
import { MembersTab } from "../components/MembersTab.js";

type Tab = "tasks" | "docs" | "members";

/** A single project: its tasks, documentation and member roster. */
export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>("tasks");
  const api = useApi();
  const { user } = useUser();
  const { data: members, reload: reloadMembers } = useAsync(
    () => (projectId ? api.listMembers(projectId) : Promise.resolve([])),
    [api, projectId],
  );
  useProjectRealtime(projectId, (e) => {
    if (e.resource === "members") reloadMembers();
  });

  if (!projectId) return <p className="error">Missing project id.</p>;

  // viewer is read-only; default to writable while the role is still loading
  // (the server is the real guard, so an optimistic UI just avoids a flicker).
  const myRole = members?.find((m) => m.uid === user?.id)?.role;
  const canWrite = myRole !== "viewer";

  return (
    <div className="page">
      <div className="page-head">
        <Link to="/" className="link">
          ← Projects
        </Link>
      </div>

      <nav className="tabs">
        {(["tasks", "docs", "members"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={t === tab ? "tab active" : "tab"}
            onClick={() => setTab(t)}
          >
            {t === "tasks" ? "Tasks" : t === "docs" ? "Documentation" : "Members"}
          </button>
        ))}
      </nav>

      {tab === "tasks" && <TasksTab projectId={projectId} canWrite={canWrite} />}
      {tab === "docs" && <DocsTab projectId={projectId} />}
      {tab === "members" && <MembersTab projectId={projectId} />}
    </div>
  );
}
