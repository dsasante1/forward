import { useEffect, useState } from "react";
import type { ProjectRole } from "forward-core";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { useProject } from "../api/ProjectContext.js";
import { Avatar } from "./Avatar.js";
import { personOf } from "./tasks-format.js";

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
 * roles, and revoke. Non-owners see a read-only roster. The roster + the caller's
 * role come from ProjectContext (one fetch, one realtime subscription per
 * project); only the invites list is owned here.
 */
export function MembersTab() {
  const api = useApi();
  const {
    projectId,
    myUid,
    members,
    membersLoading,
    membersError,
    reloadMembers,
    myRole,
    lastChange,
  } = useProject();
  const invites = useAsync(() => api.listInvites(projectId), [api, projectId]);

  // Invite changes broadcast as the "members" resource; refetch invites on them.
  useEffect(() => {
    if (lastChange?.resource === "members") invites.reload();
  }, [lastChange, invites]);

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
      reloadMembers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeMember(uid: string) {
    setError(undefined);
    try {
      await api.removeMember(projectId, uid);
      reloadMembers();
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
          {ROLES.map((r) => `${r} = ${ROLE_HELP[r].toLowerCase()}`).join(" · ")}
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
      {membersLoading && <p className="muted">Loading members…</p>}
      {membersError && <p className="error">{membersError}</p>}
      <ul className="list">
        {members?.map((m) => {
          const isSelf = m.uid === myUid;
          const person = personOf(m.uid, members, myUid);
          return (
            <li key={m.uid} className="list-row">
              {m.imageUrl ? (
                <img className="tk-avatar" src={m.imageUrl} alt="" width={28} height={28} />
              ) : (
                <Avatar person={person} size={28} />
              )}
              <span className="member-identity">
                <span className="list-title">{m.name ?? person.name}</span>
                {m.email && m.email !== m.name && (
                  <span className="muted small">{m.email}</span>
                )}
              </span>
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
