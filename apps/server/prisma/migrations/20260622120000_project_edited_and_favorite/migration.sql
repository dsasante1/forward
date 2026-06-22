-- Project: track last-edited time so the projects dashboard can show an "edited"
-- stamp. Existing rows seed to their createdAt; the app stamps it on every write
-- (Prisma @updatedAt).
ALTER TABLE "Project" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Project" SET "updatedAt" = "createdAt";

-- ProjectMember: per-user "star"/favorite on the projects dashboard.
ALTER TABLE "ProjectMember" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
