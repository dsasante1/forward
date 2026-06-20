import { useState } from "react";
import { useUser } from "@clerk/clerk-react";
import type { ProjectRole } from "forward-core";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { useProjectRealtime } from "../api/realtime.js";

const ROLES: ProjectRole[] = ["viewer", "editor", "owner"];
const ROLE_HELP: Record<ProjectRole, string> = {
  viewer: "Read-only",
  editor: "Read + write",
  owner: "Full control + manage members",
};

/**
 * The project's people: pending email invitations and current members.
 *
 * Owners invite by email (the backend emails a tokenized accept link), change
 * roles, and revoke. Non-owners see a read-only roster. Role semantics:
 * viewer = read-only, editor = read+write, owner = also manages members.
 */
export function MembersTab({ projectId }: { projectId: string }) {
  const api = useApi();
  const { user } = useUser();
  const members = useAsync(() => api.listMembers(projectId), [api, projectId]);
  const invites = useAsync(() => api.listInvites(projectId), [api, projectId]);

  // Live updates: roster + invite changes both broadcast as the "members" resource.
  useProjectRealtime(projectId, (e) => {
    if (e.resource === "members") {
      members.reload();
      invites.reload();
    }
  });

  const myRole = members.data?.find((m) => m.uid === user?.id)?.role;
  const isOwner = myRole === "owner";

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("editor");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const res = await api.createInvite(projectId, email.trim(), role);
      setEmail("");
      setNotice(
        res.emailSent
          ? `Invitation emailed to ${res.email}.`
          : `Invite created for ${res.email}, but the email could not be sent — check the server's Mailtrap config.`,
      );
      invites.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(uid: string, next: ProjectRole) {
    setError(undefined);
    try {
      await api.updateMemberRole(projectId, uid, next);
      members.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeMember(uid: string) {
    setError(undefined);
    try {
      await api.removeMember(projectId, uid);
      members.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revokeInvite(id: string) {
    setError(undefined);
    try {
      await api.revokeInvite(projectId, id);
      invites.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="tab-body">
      {isOwner && (
        <form className="row" onSubmit={invite}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@email.com"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ProjectRole)}
            title={ROLE_HELP[role]}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy || !email.trim()}>
            {busy ? "Inviting…" : "Send invite"}
          </button>
        </form>
      )}
      {isOwner && (
        <p className="muted small">
          viewer = read-only · editor = read + write · owner = also manages members
        </p>
      )}
      {notice && <p className="muted small">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {/* Pending invitations */}
      {invites.data && invites.data.length > 0 && (
        <>
          <h3 className="section-label">Pending invitations</h3>
          <ul className="list">
            {invites.data.map((inv) => (
              <li key={inv.id} className="list-row">
                <span className="badge pending">invited</span>
                <span className="list-title">{inv.email}</span>
                <span className="badge">{inv.role}</span>
                {isOwner && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => revokeInvite(inv.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Members */}
      <h3 className="section-label">Members</h3>
      {members.loading && <p className="muted">Loading members…</p>}
      {members.error && <p className="error">{members.error}</p>}
      <ul className="list">
        {members.data?.map((m) => {
          const isSelf = m.uid === user?.id;
          return (
            <li key={m.uid} className="list-row">
              <span className="list-title">{m.email ?? m.uid}</span>
              {isOwner && !isSelf ? (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.uid, e.target.value as ProjectRole)}
                  title={ROLE_HELP[m.role]}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={`badge ${m.role}`}>{m.role}</span>
              )}
              {isOwner && !isSelf && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => removeMember(m.uid)}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
