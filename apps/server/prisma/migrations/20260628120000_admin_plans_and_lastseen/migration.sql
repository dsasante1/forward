-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('solo', 'team', 'enterprise');

-- AlterTable (Organization): subscription tier + seats + region
ALTER TABLE "Organization" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'solo',
ADD COLUMN     "seatLimit" INTEGER,
ADD COLUMN     "region" TEXT;

-- AlterTable (User): last-seen stamp for the staff console
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);
