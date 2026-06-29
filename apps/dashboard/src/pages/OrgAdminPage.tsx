import { useState } from "react";
import { useOrganization } from "@clerk/react";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { AsyncStates } from "../components/AsyncStates.js";

type Tab = "overview" | "projects" | "members" | "tokens" | "activity" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "members", label: "Members" },
  { id: "tokens", label: "Tokens" },
  { id: "activity", label: "Activity" },
  { id: "audit", label: "Audit log" },
];

/**
 * The Org Admin portal: an org admin's control panel over everything filed under
 * the *active* Clerk organization. Gated twice — only rendered for the org:admin
 * role here, and re-checked server-side by OrgAdminGuard on every call. Member
 * invites/roles themselves stay in Clerk's <OrganizationProfile/> (the Account
 * page); this surfaces what Clerk doesn't: projects, token governance, activity
 * and the audit trail.
 */
export function OrgAdminPage() {
  const { organization, membership, isLoaded } = useOrganization();
  const [tab, setTab] = useState<Tab>("overview");

  if (!isLoaded) return <p className="muted loading-row">Loading…</p>;
  if (!organization) {
    return (
      <div className="org-admin">
        <h1>Organization admin</h1>
        <p className="muted">
          Select or create an organization (top bar) to administer it.
        </p>
      </div>
    );
  }
  const isAdmin = membership?.role === "org:admin" || membership?.role === "admin";
  if (!isAdmin) {
    return (
      <div className="org-admin">
        <h1>Organization admin</h1>
        <p className="muted">You must be an admin of {organization.name}.</p>
      </div>
    );
  }

  return (
    <div className="org-admin">
      <h1>{organization.name} — admin</h1>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <section className="tab-panel">
        {tab === "overview" && <OverviewPanel orgId={organization.id} />}
        {tab === "projects" && <ProjectsPanel orgId={organization.id} />}
        {tab === "members" && <MembersPanel orgId={organization.id} />}
        {tab === "tokens" && <TokensPanel orgId={organization.id} />}
        {tab === "activity" && <ActivityPanel orgId={organization.id} />}
        {tab === "audit" && <AuditPanel orgId={organization.id} />}
      </section>
    </div>
  );
}

function OverviewPanel({ orgId }: { orgId: string }) {
  const api = useApi();
  const state = useAsync(() => api.orgUsage(orgId), [orgId]);
  return (
    <>
      <AsyncStates state={state} />
      {state.data && (
        <div className="stat-grid">
          <Stat label="Projects" value={state.data.projectCount} />
          <Stat label="Members" value={state.data.memberCount} />
          <Stat label="Design elements" value={state.data.elementCount} />
          <Stat label="Activity events" value={state.data.eventCount} />
          <Stat label="Active tokens" value={state.data.tokenCount} />
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function ProjectsPanel({ orgId }: { orgId: string }) {
  const api = useApi();
  const state = useAsync(() => api.orgProjects(orgId), [orgId]);
  const [busy, setBusy] = useState<string | null>(null);

  const transfer = async (projectId: string) => {
    const userId = window.prompt("Transfer to org member (user id):")?.trim();
    if (!userId) return;
    setBusy(projectId);
    try {
      await api.transferOrgProject(orgId, projectId, userId);
      state.reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (projectId: string, name: string) => {
    if (!window.confirm(`Delete "${name}" and all its data? This cannot be undone.`))
      return;
    setBusy(projectId);
    try {
      await api.deleteOrgProject(orgId, projectId);
      state.reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <AsyncStates
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={<p className="muted">No projects in this organization yet.</p>}
      />
      {state.data && state.data.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Owner</th>
              <th>Members</th>
              <th>Edited</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.data.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.owner.name ?? p.owner.email ?? p.ownerId}</td>
                <td>{p.memberCount}</td>
                <td>{new Date(p.updatedAt).toLocaleDateString()}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="link"
                    disabled={busy === p.id}
                    onClick={() => transfer(p.id)}
                  >
                    Transfer
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    disabled={busy === p.id}
                    onClick={() => remove(p.id, p.name)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function MembersPanel({ orgId }: { orgId: string }) {
  const api = useApi();
  const state = useAsync(() => api.orgMembers(orgId), [orgId]);
  return (
    <>
      <p className="muted">
        Invite or remove members from the Account → Organization page (Clerk owns
        the roster). This is the mirror the admin API uses.
      </p>
      <AsyncStates state={state} isEmpty={(d) => d.length === 0} empty={<p className="muted">No members.</p>} />
      {state.data && state.data.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {state.data.map((m) => (
              <tr key={m.userId}>
                <td>{m.name ?? m.email ?? m.userId}</td>
                <td>{m.role}</td>
                <td>{new Date(m.addedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function TokensPanel({ orgId }: { orgId: string }) {
  const api = useApi();
  const state = useAsync(() => api.orgTokens(orgId), [orgId]);
  const [busy, setBusy] = useState<string | null>(null);

  const revoke = async (tokenId: string) => {
    if (!window.confirm("Revoke this token? The client using it will lose access."))
      return;
    setBusy(tokenId);
    try {
      await api.revokeOrgToken(orgId, tokenId);
      state.reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <AsyncStates
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={<p className="muted">No active personal access tokens.</p>}
      />
      {state.data && state.data.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Owner</th>
              <th>Last used</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.data.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name} <code className="muted">{t.prefix}…</code>
                </td>
                <td>{t.ownerName ?? t.ownerEmail ?? t.userId}</td>
                <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "—"}</td>
                <td>{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "—"}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="link danger"
                    disabled={busy === t.id}
                    onClick={() => revoke(t.id)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ActivityPanel({ orgId }: { orgId: string }) {
  const api = useApi();
  const state = useAsync(() => api.orgActivity(orgId, 100), [orgId]);
  return (
    <>
      <AsyncStates
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={<p className="muted">No activity yet.</p>}
      />
      {state.data && state.data.length > 0 && (
        <ul className="feed">
          {state.data.map((e) => (
            <li key={e.seq}>
              <span className={`badge badge-${e.domain}`}>{e.domain}</span>{" "}
              <strong>{e.title}</strong> {e.action} in {e.projectName}
              <span className="muted"> · {new Date(e.ts).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AuditPanel({ orgId }: { orgId: string }) {
  const api = useApi();
  const state = useAsync(() => api.orgAudit(orgId, 100), [orgId]);
  return (
    <>
      <AsyncStates
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={<p className="muted">No admin actions recorded.</p>}
      />
      {state.data && state.data.length > 0 && (
        <ul className="feed">
          {state.data.map((e) => (
            <li key={e.id}>
              <code>{e.action}</code> {e.targetType} <code>{e.targetId}</code>
              {e.detail && <> — {e.detail}</>}
              <span className="muted">
                {" "}
                · {e.actorId} · {new Date(e.ts).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
