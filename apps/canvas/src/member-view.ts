import type { ProjectRole, RosterMember } from "./source.js";

/**
 * The project member roster (the Member view): one full-area panel listing the
 * project's people, with controls to add a collaborator by uid, change a
 * member's role, and remove them. A read-only host (no mutation methods on the
 * source) gets the list alone, with the controls omitted.
 *
 * This module only draws; the roster lives behind the CanvasSource and the
 * writes go back through it via the callbacks.
 */

const ROLES: ProjectRole[] = ["viewer", "editor", "owner"];
const ROLE_HELP: Record<ProjectRole, string> = {
  viewer: "Read-only",
  editor: "Read + write",
  owner: "Full control + manage members",
};

export interface MemberViewState {
  members: RosterMember[];
  loading: boolean;
  error?: string;
  /** Whether the host can mutate the roster (add / change role / remove). */
  canManage: boolean;
}

export interface MemberCallbacks {
  onClose: () => void;
  onReload: () => void;
  onAdd: (uid: string, role: ProjectRole) => void;
  onChangeRole: (uid: string, role: ProjectRole) => void;
  onRemove: (uid: string) => void;
}

function hEl(tag: string, content = "", cls = ""): HTMLElement {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (cls) node.className = cls;
  return node;
}

export function renderMemberView(
  host: HTMLElement,
  state: MemberViewState,
  cb: MemberCallbacks,
): void {
  host.replaceChildren();

  // --- header ---
  const head = hEl("div", "", "mb-head");
  head.append(hEl("h2", "Members"));
  const close = hEl("button", "✕", "mb-close") as HTMLButtonElement;
  close.title = "Close";
  close.addEventListener("click", cb.onClose);
  head.append(close);
  host.append(head);

  const body = hEl("div", "", "mb-body");
  host.append(body);

  // --- add-by-uid row (omitted on a read-only host) ---
  if (state.canManage) {
    const form = hEl("form", "", "mb-add") as HTMLFormElement;
    const input = document.createElement("input");
    input.className = "mb-input";
    input.placeholder = "Add collaborator by user id (uid)…";
    const roleSel = roleSelect("editor");
    roleSel.classList.add("mb-add-role");
    const addBtn = hEl("button", "Add", "mb-add-btn") as HTMLButtonElement;
    addBtn.type = "submit";
    form.append(input, roleSel, addBtn);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const uid = input.value.trim();
      if (!uid) return;
      cb.onAdd(uid, roleSel.value as ProjectRole);
      input.value = "";
    });
    body.append(form);
    body.append(hEl("p", "They see their uid in the banner when locked out of this project.", "mb-hint"));
  }

  if (state.loading) {
    body.append(hEl("p", "Loading members…", "mb-empty"));
    return;
  }
  if (state.error) {
    const err = hEl("div", "", "mb-error");
    err.append(hEl("span", state.error, "mb-error-msg"));
    const retry = hEl("button", "Retry", "mb-retry") as HTMLButtonElement;
    retry.addEventListener("click", cb.onReload);
    err.append(retry);
    body.append(err);
    return;
  }
  if (!state.members.length) {
    body.append(hEl("p", "No members yet.", "mb-empty"));
    return;
  }

  for (const m of state.members) body.append(memberRow(m, state.canManage, cb));
}

function memberRow(
  m: RosterMember,
  canManage: boolean,
  cb: MemberCallbacks,
): HTMLElement {
  const row = hEl("div", "", "mb-row");

  const avatar = hEl("span", initials(m), "mb-avatar");
  if (m.imageUrl) {
    avatar.textContent = "";
    avatar.style.backgroundImage = `url(${m.imageUrl})`;
    avatar.classList.add("mb-avatar-img");
  }
  row.append(avatar);

  const identity = hEl("div", "", "mb-identity");
  identity.append(hEl("span", m.name || m.email || m.uid, "mb-name"));
  if (m.email && (m.name || m.email !== m.uid)) {
    identity.append(hEl("span", m.email, "mb-sub"));
  }
  row.append(identity);

  if (canManage) {
    const sel = roleSelect(m.role);
    sel.classList.add("mb-row-role");
    sel.addEventListener("change", () =>
      cb.onChangeRole(m.uid, sel.value as ProjectRole),
    );
    row.append(sel);
    const del = hEl("button", "✕", "mb-del") as HTMLButtonElement;
    del.title = "Remove member";
    del.addEventListener("click", () => cb.onRemove(m.uid));
    row.append(del);
  } else {
    row.append(hEl("span", m.role, "mb-role-badge"));
  }

  return row;
}

function roleSelect(value: ProjectRole): HTMLSelectElement {
  const sel = document.createElement("select");
  sel.className = "mb-role-select";
  for (const r of ROLES) {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    opt.title = ROLE_HELP[r];
    if (r === value) opt.selected = true;
    sel.append(opt);
  }
  return sel;
}

function initials(m: RosterMember): string {
  const base = m.name || m.email || m.uid;
  return base.slice(0, 2).toUpperCase();
}
