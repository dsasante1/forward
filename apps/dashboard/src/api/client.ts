import { useAuth } from "@clerk/clerk-react";
import { useCallback, useMemo } from "react";
import * as api from "forward-core/api";
import type { Task, ProjectRole, DesignElement } from "forward-core";

const BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

/** A project as returned by `GET /projects` (the server's projects.service shape). */
export interface Project {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  /** Present on the list endpoint: the caller's role in this project. */
  role?: ProjectRole;
}

/** A roster member (the backend's GET /members shape, mapped to `uid`). */
export interface Member {
  uid: string;
  email: string | null;
  role: ProjectRole;
  addedAt: string;
}

/** A pending email invitation (GET /projects/:p/invites). */
export interface Invite {
  id: string;
  email: string;
  role: ProjectRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
}

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
      listProjects: () => accountFetch<Project[]>("/projects"),
      createProject: (name: string) =>
        accountFetch<Project>("/projects", {
          method: "POST",
          body: JSON.stringify({ name }),
        }),

      // --- membership roster (project-scoped) ---
      // Direct fetch (not forward-core/api) so we keep each member's email.
      listMembers: async (projectId: string): Promise<Member[]> => {
        const rows = await accountFetch<
          Array<{ userId: string; email: string | null; role: ProjectRole; addedAt: string }>
        >(`/projects/${projectId}/members`);
        return (rows ?? []).map((m) => ({
          uid: m.userId,
          email: m.email,
          role: m.role,
          addedAt: m.addedAt,
        }));
      },
      updateMemberRole: (projectId: string, uid: string, role: ProjectRole) =>
        accountFetch<{ ok: true }>(
          `/projects/${projectId}/members/${encodeURIComponent(uid)}`,
          { method: "PATCH", body: JSON.stringify({ role }) },
        ),
      removeMember: async (projectId: string, uid: string) =>
        api.removeMember(await cfgFor(projectId), uid),

      // --- email invitations (project-scoped) ---
      listInvites: (projectId: string) =>
        accountFetch<Invite[]>(`/projects/${projectId}/invites`),
      createInvite: (projectId: string, email: string, role: ProjectRole) =>
        accountFetch<Invite & { emailSent: boolean }>(
          `/projects/${projectId}/invites`,
          { method: "POST", body: JSON.stringify({ email, role }) },
        ),
      revokeInvite: (projectId: string, inviteId: string) =>
        accountFetch<{ ok: true }>(
          `/projects/${projectId}/invites/${encodeURIComponent(inviteId)}`,
          { method: "DELETE" },
        ),
      acceptInvite: (token: string) =>
        accountFetch<{ projectId: string; role: ProjectRole }>(
          `/invites/${encodeURIComponent(token)}/accept`,
          { method: "POST" },
        ),

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
