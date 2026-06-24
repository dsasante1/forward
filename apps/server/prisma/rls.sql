-- Defense-in-depth: Postgres Row-Level Security.
--
-- The Node service already scopes every query by projectId after checking
-- membership, so this is a SECOND wall: even a query that forgets its WHERE
-- projectId cannot cross tenants. The app connects as a role that is subject to
-- RLS and sets the current user id per transaction:
--
--   SET LOCAL app.user_id = '<clerk user id>';
--
-- (PrismaService.withUser() does this around each request.)
--
-- Apply after `prisma migrate deploy`:  psql "$DIRECT_URL" -f prisma/rls.sql

ALTER TABLE "DesignElement"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VersionEntry"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimelineEvent"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InfraNode"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InfraEdge"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InfraFlow"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectMember"  ENABLE ROW LEVEL SECURITY;

-- A row is visible only if the current app user is a member of its project.
CREATE OR REPLACE FUNCTION app_is_member(pid text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "ProjectMember" m
    WHERE m."projectId" = pid
      AND m."userId" = current_setting('app.user_id', true)
  );
$$ LANGUAGE sql STABLE;

CREATE POLICY tenant_isolation ON "DesignElement"
  USING (app_is_member("projectId")) WITH CHECK (app_is_member("projectId"));
CREATE POLICY tenant_isolation ON "InfraNode"
  USING (app_is_member("projectId")) WITH CHECK (app_is_member("projectId"));
CREATE POLICY tenant_isolation ON "InfraEdge"
  USING (app_is_member("projectId")) WITH CHECK (app_is_member("projectId"));
CREATE POLICY tenant_isolation ON "InfraFlow"
  USING (app_is_member("projectId")) WITH CHECK (app_is_member("projectId"));
CREATE POLICY tenant_isolation ON "Task"
  USING (app_is_member("projectId")) WITH CHECK (app_is_member("projectId"));

-- Version history is readable by members and INSERT-only (no UPDATE/DELETE policy).
CREATE POLICY tenant_read ON "VersionEntry"
  FOR SELECT USING (app_is_member("projectId"));
CREATE POLICY tenant_insert ON "VersionEntry"
  FOR INSERT WITH CHECK (app_is_member("projectId"));

-- The unified activity feed is likewise member-readable + INSERT-only.
CREATE POLICY tenant_read ON "TimelineEvent"
  FOR SELECT USING (app_is_member("projectId"));
CREATE POLICY tenant_insert ON "TimelineEvent"
  FOR INSERT WITH CHECK (app_is_member("projectId"));

CREATE POLICY member_self ON "ProjectMember"
  USING (app_is_member("projectId")) WITH CHECK (app_is_member("projectId"));
