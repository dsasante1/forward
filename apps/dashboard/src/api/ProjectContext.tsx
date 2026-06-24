import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useUser } from "@clerk/react";
import type { ProjectRole } from "forward-core";
import { useApi, type Member } from "./client.js";
import { useAsync } from "./useAsync.js";
import { useProjectRealtime, type ProjectChange } from "./realtime.js";

interface ProjectCtx {
  projectId: string;
  /** The signed-in user's Clerk id (matches the server's member uid). */
  myUid: string | undefined;
  members: Member[] | undefined;
  membersLoading: boolean;
  membersError?: string;
  reloadMembers: () => void;
  /** The signed-in user's role on this project (undefined while loading). */
  myRole: ProjectRole | undefined;
  /** false only for a confirmed viewer; optimistic-writable while role loads. */
  canWrite: boolean;
  /** The most recent realtime change, so tabs can refetch their own resource. */
  lastChange: ProjectChange | null;
}

const Ctx = createContext<ProjectCtx | null>(null);

export function useProject(): ProjectCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProject must be used within <ProjectProvider>");
  return ctx;
}

/**
 * One place per open project that owns the member roster, the caller's role, and
 * the SINGLE realtime subscription. Tabs read from here instead of each fetching
 * the roster and opening their own channel (which duplicated I/O and could tear
 * down a sibling's subscription on the shared Supabase client).
 */
export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const api = useApi();
  const { user } = useUser();
  const {
    data: members,
    loading,
    error,
    reload,
  } = useAsync(() => api.listMembers(projectId), [api, projectId]);
  const [lastChange, setLastChange] = useState<ProjectChange | null>(null);

  useProjectRealtime(projectId, (e) => {
    setLastChange(e);
    if (e.resource === "members") reload();
  });

  const myRole = members?.find((m) => m.uid === user?.id)?.role;
  const canWrite = myRole !== "viewer";

  const value = useMemo<ProjectCtx>(
    () => ({
      projectId,
      myUid: user?.id,
      members,
      membersLoading: loading,
      membersError: error,
      reloadMembers: reload,
      myRole,
      canWrite,
      lastChange,
    }),
    [projectId, user?.id, members, loading, error, reload, myRole, canWrite, lastChange],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
