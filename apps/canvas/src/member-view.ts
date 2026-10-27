import type { RosterMember } from "./source.js";

/**
 * The contributor roster (the Member view): a read-only panel listing who has
 * worked on the project. In repo mode access is managed by the git host, so the
 * roster comes from git history and there is nothing to add, change or remove.
 *
 * This module only draws; the roster lives behind the CanvasSource.
 */

export interface MemberViewState {
  members: RosterMember[];
  loading: boolean;
  error?: string;
}

export interface MemberCallbacks {
  onClose: () => void;
  onReload: () => void;
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

  const head = hEl("div", "", "mb-head");
  head.append(hEl("h2", "Contributors"));
  const close = hEl("button", "✕", "mb-close") as HTMLButtonElement;
  close.title = "Close";
  close.addEventListener("click", cb.onClose);
  head.append(close);
  host.append(head);

  const body = hEl("div", "", "mb-body");
  host.append(body);
  body.append(
    hEl("p", "Everyone who has committed to .forward/. Access is managed by your git host.", "mb-hint"),
  );

  if (state.loading) {
    body.append(hEl("p", "Loading contributors…", "mb-empty"));
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
    body.append(hEl("p", "No contributors yet.", "mb-empty"));
    return;
  }

  for (const m of state.members) body.append(memberRow(m));
}

function memberRow(m: RosterMember): HTMLElement {
  const row = hEl("div", "", "mb-row");
  row.append(hEl("span", initials(m), "mb-avatar"));

  const identity = hEl("div", "", "mb-identity");
  identity.append(hEl("span", m.name || m.email || m.uid, "mb-name"));
  if (m.email && (m.name || m.email !== m.uid)) {
    identity.append(hEl("span", m.email, "mb-sub"));
  }
  row.append(identity);
  return row;
}

function initials(m: RosterMember): string {
  const base = m.name || m.email || m.uid;
  return base.slice(0, 2).toUpperCase();
}
