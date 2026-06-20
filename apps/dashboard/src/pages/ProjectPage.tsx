import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ProjectProvider } from "../api/ProjectContext.js";
import { TasksTab } from "../components/TasksTab.js";
import { DocsTab } from "../components/DocsTab.js";
import { MembersTab } from "../components/MembersTab.js";

type Tab = "tasks" | "docs" | "members";

/** A single project: its tasks, documentation and member roster. */
export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>("tasks");

  if (!projectId) return <p className="error">Missing project id.</p>;

  return (
    <ProjectProvider projectId={projectId}>
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
              {t === "tasks"
                ? "Tasks"
                : t === "docs"
                  ? "Documentation"
                  : "Members"}
            </button>
          ))}
        </nav>

        {tab === "tasks" && <TasksTab />}
        {tab === "docs" && <DocsTab projectId={projectId} />}
        {tab === "members" && <MembersTab />}
      </div>
    </ProjectProvider>
  );
}
