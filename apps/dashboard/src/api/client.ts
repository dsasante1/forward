import { useAuth } from "@clerk/react";
import { useCallback, useMemo } from "react";
import * as api from "forward-core/api";
import type { ApiTokenSummary, InviteSummary } from "forward-core/api";
import type { Task, ProjectRole, DesignElement } from "forward-core";

const BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

/** A member preview row carried by the projects list (drives card avatars). */
export interface ProjectMemberPreview {
  userId: string;
  email: string | null;
  role: ProjectRole;
}

/** A project as returned by `GET /projects` (the server's projects.service shape). */
export interface Project {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  /** Last time the project's content changed — the "edited" stamp. */
  updatedAt: string;
  /** Present on the list endpoint: the caller's role in this project. */
  role?: ProjectRole;
  /** Present on the list endpoint: the caller's "star" on this project. */
  favorite?: boolean;
  /** Total members; `members` is a capped preview for avatar stacks. */
  memberCount?: number;
  members?: ProjectMemberPreview[];
}

/** Search / sort options for the projects list (server-side). */
export interface ListProjectsOptions {
  q?: string;
  sort?: "recent" | "name";
}

/** A roster member — exactly the shared client's listMembers row shape. */
export type Member = Awaited<ReturnType<typeof api.listMembers>>[number];

/** A pending email invitation — the shared client's invite shape. */
export type Invite = InviteSummary;

/**
 * The single data-access hook. Every call fetches a *fresh* Clerk session token
 * (they are short-lived) and sends it as `Authorization: Bearer` — exactly what
 * the backend's ClerkAuthGuard expects. Project-scoped calls are delegated to the
 * shared `forward-core/api` client so the dashboard speaks the same contract as
 * the canvas, extension and MCP; account-level project list/create live above the
 * project scope that client covers, so they go direct.
 */
export function useApi() {
  const { getToken } = useAuth();

  const cfgFor = useCallback(
    async (projectId: string): Promise<api.ApiConfig> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      return { baseUrl: BASE_URL, projectId, token };
    },
    [getToken],
  );

  const accountFetch = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init?.body ? { "content-type": "application/json" } : {}),
          ...init?.headers,
        },
      });
      if (!res.ok) {
        throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status})`);
      }
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    },
    [getToken],
  );

  return useMemo(
    () => ({
      // --- account-level (above project scope) ---
      listProjects: (opts: ListProjectsOptions = {}) => {
        const params = new URLSearchParams();
        if (opts.q) params.set("q", opts.q);
        if (opts.sort) params.set("sort", opts.sort);
        const qs = params.toString();
        return accountFetch<Project[]>(`/projects${qs ? `?${qs}` : ""}`);
      },
      createProject: (name: string) =>
        accountFetch<Project>("/projects", {
          method: "POST",
          body: JSON.stringify({ name }),
        }),
      renameProject: (projectId: string, name: string) =>
        accountFetch<Project>(`/projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        }),
      deleteProject: (projectId: string) =>
        accountFetch<{ ok: true }>(`/projects/${projectId}`, {
          method: "DELETE",
        }),
      duplicateProject: (projectId: string) =>
        accountFetch<Project>(`/projects/${projectId}/duplicate`, {
          method: "POST",
        }),
      setProjectFavorite: (projectId: string, favorite: boolean) =>
        accountFetch<{ favorite: boolean }>(`/projects/${projectId}/favorite`, {
          method: "PUT",
          body: JSON.stringify({ favorite }),
        }),
      // The (member-only) realtime channel name to subscribe to — the server
      // derives an unguessable name so the broadcast bus stays tenant-scoped.
      realtimeChannel: (projectId: string) =>
        accountFetch<{ channel: string }>(`/projects/${projectId}/realtime`),

      // --- Personal Access Tokens (account-level; for the VS Code extension) ---
      listApiTokens: () => accountFetch<ApiTokenSummary[]>("/tokens"),
      // `expiresInDays`: omit for the 90-day default. Every token expires.
      createApiToken: (name: string, expiresInDays?: number) =>
        accountFetch<ApiTokenSummary & { token: string }>("/tokens", {
          method: "POST",
          body: JSON.stringify({ name, expiresInDays }),
        }),
      rotateApiToken: (id: string, expiresInDays?: number) =>
        accountFetch<ApiTokenSummary & { token: string }>(`/tokens/${id}/rotate`, {
          method: "POST",
          body: JSON.stringify({ expiresInDays }),
        }),
      revokeApiToken: (id: string) =>
        accountFetch<{ ok: true }>(`/tokens/${id}`, { method: "DELETE" }),

      // --- membership roster (project-scoped, via forward-core/api) ---
      listMembers: async (projectId: string): Promise<Member[]> =>
        api.listMembers(await cfgFor(projectId)),
      updateMemberRole: async (projectId: string, uid: string, role: ProjectRole) =>
        api.updateMemberRole(await cfgFor(projectId), uid, role),
      removeMember: async (projectId: string, uid: string) =>
        api.removeMember(await cfgFor(projectId), uid),

      // --- email invitations (project-scoped, via forward-core/api) ---
      listInvites: async (projectId: string) =>
        api.listInvites(await cfgFor(projectId)),
      createInvite: async (projectId: string, email: string, role: ProjectRole) =>
        api.createInvite(await cfgFor(projectId), email, role),
      revokeInvite: async (projectId: string, inviteId: string) =>
        api.revokeInvite(await cfgFor(projectId), inviteId),
      acceptInvite: async (token: string) =>
        api.acceptInvite(await cfgFor(""), token),

      // --- tasks (project-scoped) ---
      listTasks: async (projectId: string): Promise<Task[]> =>
        api.fetchTasks(await cfgFor(projectId)),
      saveTask: async (projectId: string, task: Task) =>
        api.saveTask(await cfgFor(projectId), task),
      patchTask: async (
        projectId: string,
        taskId: string,
        patch: Partial<Omit<Task, "id" | "createdAt">>,
      ) => api.patchTask(await cfgFor(projectId), taskId, patch),
      deleteTask: async (projectId: string, taskId: string) =>
        api.deleteTask(await cfgFor(projectId), taskId),

      // --- documentation (design elements + their version timeline) ---
      listElements: async (projectId: string): Promise<DesignElement[]> =>
        api.fetchElements(await cfgFor(projectId)),
      timeline: async (projectId: string) => {
        const { timelines } = await api.fetchTimelinesConditional(
          await cfgFor(projectId),
          undefined,
        );
        return timelines;
      },
    }),
    [accountFetch, cfgFor],
  );
}
