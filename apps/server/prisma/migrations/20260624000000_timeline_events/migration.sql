-- CreateTable
CREATE TABLE "TimelineEvent" (
    "seq" BIGSERIAL NOT NULL,
    "projectId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL,
    "ts" BIGINT NOT NULL,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "TimelineEvent_projectId_ts_idx" ON "TimelineEvent"("projectId", "ts");

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for TimelineEvent (ENABLE + member-read/INSERT-only policies,
-- mirroring VersionEntry) is defined in prisma/rls.sql, applied out-of-band after
-- `prisma migrate deploy`. It is kept out of the migration because the policies
-- reference app_is_member(), which rls.sql defines and the shadow database lacks.
