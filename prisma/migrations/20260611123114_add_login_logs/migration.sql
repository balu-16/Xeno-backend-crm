/*
  Warnings:

  - Made the column `customerId` on table `CampaignLog` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "CampaignLog" DROP CONSTRAINT "CampaignLog_customerId_fkey";

-- DropIndex
DROP INDEX "Customer_email_trgm_idx";

-- DropIndex
DROP INDEX "Customer_name_trgm_idx";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignLog" ALTER COLUMN "customerId" SET NOT NULL;

-- CreateTable
CREATE TABLE "CustomerLoginLog" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "loggedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerLoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLoginLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "loggedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerLoginLog_customerId_loggedInAt_idx" ON "CustomerLoginLog"("customerId", "loggedInAt");

-- CreateIndex
CREATE INDEX "AdminLoginLog_userId_loggedInAt_idx" ON "AdminLoginLog"("userId", "loggedInAt");

-- CreateIndex
CREATE INDEX "Campaign_scheduledAt_idx" ON "Campaign"("scheduledAt");

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
