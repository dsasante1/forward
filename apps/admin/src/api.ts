import { useAuth } from "@clerk/react";
import { useCallback, useMemo } from "react";

const BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

export type Plan = "solo" | "team" | "enterprise";

// --- Response shapes (mirror apps/server AdminService return types) ---

export interface Trend {
  perWeek: number[];
  cumulative: number[];
}

export interface Alert {
  type: "suspended" | "seats";
  title: string;
  sub: string;
  orgId: string;
  severity: "error" | "warn";
}

export interface Overview {
  counts: {
    users: number;
    suspendedUsers: number;
    platformAdmins: number;
    orgs: number;
    suspendedOrgs: number;
    projects: number;
    activeTokens: number;
    timelineEvents: number;
    activeEditors: number;
  };
  mrr: number | null;
  orgTrend: Trend;
  userTrend: Trend;
  planDistribution: { plan: Plan; count: number }[];
  alerts: Alert[];
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string | null;
  plan: Plan;
  seatLimit: number | null;
  region: string | null;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  projectCount: number;
  ownerName: string | null;
  ownerEmail: string | null;
}

export interface OrgDetail extends AdminOrg {
  members: {
    userId: string;
    role: "admin" | "member";
    name: string | null;
    email: string | null;
  }[];
  projects: {
    id: string;
    name: string;
    memberCount: number;
    updatedAt: string;
  }[];
}

export interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  isPlatformAdmin: boolean;
  suspendedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  ownedProjects: number;
  memberships: number;
  orgName: string | null;
  role: string | null;
}

export interface AdminProject {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  scope: "org" | "platform";
  orgId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  ts: number;
}

export interface Impersonation {
  token: string;
  userId: string;
  email: string | null;
}

/**
 * Data-access hook for the Platform Admin API. Every call attaches a fresh Clerk
 * session token; the backend's PlatformAdminGuard is the real gate — a signed-in
 * non-admin simply gets 403 on every call.
 */
export function useAdminApi() {
  const { getToken } = useAuth();

  const call = useCallback(
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
        const detail =
          res.status === 403
            ? "Forbidden — your account is not a platform admin."
            : `${init?.method ?? "GET"} ${path} failed (${res.status})`;
        throw new Error(detail);
      }
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    },
    [getToken],
  );

  return useMemo(
    () => ({
      overview: () => call<Overview>("/admin/overview"),

      listOrgs: (q?: string) =>
        call<AdminOrg[]>(`/admin/orgs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      orgDetail: (id: string) => call<OrgDetail>(`/admin/orgs/${id}`),
      setOrgPlan: (
        id: string,
        body: { plan?: Plan; seatLimit?: number | null; region?: string | null },
      ) =>
        call<{ ok: true }>(`/admin/orgs/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      suspendOrg: (id: string, suspend: boolean) =>
        call<{ ok: true }>(`/admin/orgs/${id}/suspend`, {
          method: "POST",
          body: JSON.stringify({ suspend }),
        }),

      listUsers: (q?: string) =>
        call<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      suspendUser: (id: string, suspend: boolean) =>
        call<{ ok: true }>(`/admin/users/${id}/suspend`, {
          method: "POST",
          body: JSON.stringify({ suspend }),
        }),
      setPlatformAdmin: (id: string, value: boolean) =>
        call<{ ok: true }>(`/admin/users/${id}/platform-admin`, {
          method: "POST",
          body: JSON.stringify({ value }),
        }),
      impersonate: (id: string) =>
        call<Impersonation>(`/admin/users/${id}/impersonate`, { method: "POST" }),

      listProjects: (q?: string) =>
        call<AdminProject[]>(
          `/admin/projects${q ? `?q=${encodeURIComponent(q)}` : ""}`,
        ),
      deleteProject: (id: string) =>
        call<{ ok: true }>(`/admin/projects/${id}`, { method: "DELETE" }),

      audit: (params: { scope?: string; limit?: number } = {}) => {
        const qs = new URLSearchParams();
        if (params.scope) qs.set("scope", params.scope);
        if (params.limit) qs.set("limit", String(params.limit));
        const s = qs.toString();
        return call<AuditEvent[]>(`/admin/audit${s ? `?${s}` : ""}`);
      },
    }),
    [call],
  );
}
