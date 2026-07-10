import { useEffect, useState } from "react";
import type { ProjectRole } from "forward-core";
import { useApi } from "../api/client.js";
import { useAsync } from "../api/useAsync.js";
import { useProject } from "../api/ProjectContext.js";
import { Loading, RetryError } from "./AsyncStates.js";
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
  // Id (member uid or invite id) whose action is in flight, to disable its row.
  const [rowBusy, setRowBusy] = useState<string>();
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
    setRowBusy(uid);
    try {
      await api.updateMemberRole(projectId, uid, next);
      reloadMembers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(undefined);
    }
  }

  async function removeMember(uid: string, label: string) {
    if (
      !window.confirm(
        `Remove ${label} from this project? They lose access immediately.`,
      )
    )
      return;
    setError(undefined);
    setRowBusy(uid);
    try {
      await api.removeMember(projectId, uid);
      reloadMembers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(undefined);
    }
  }

  async function revokeInvite(id: string, label: string) {
    if (
      !window.confirm(`Revoke the invitation for ${label}? The link stops working.`)
    )
      return;
    setError(undefined);
    setRowBusy(id);
    try {
      await api.revokeInvite(projectId, id);
      invites.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(undefined);
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
            aria-label="Invite email address"
            autoComplete="email"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ProjectRole)}
            title={ROLE_HELP[role]}
            aria-label="Invite role"
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
      {notice && (
        <p className="muted small" aria-live="polite">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {/* Pending invitations */}
      {invites.error && (
        <RetryError message={invites.error} onRetry={invites.reload} />
      )}
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
                    onClick={() => revokeInvite(inv.id, inv.email)}
                    disabled={rowBusy === inv.id}
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
      {membersLoading && !members && <Loading>Loading members…</Loading>}
      {membersError && (
        <RetryError message={membersError} onRetry={reloadMembers} />
      )}
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
                  aria-label={`Role for ${m.name ?? person.name}`}
                  disabled={rowBusy === m.uid}
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
                  onClick={() => removeMember(m.uid, m.name ?? person.name)}
                  disabled={rowBusy === m.uid}
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
