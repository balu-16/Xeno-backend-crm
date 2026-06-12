-- Fix cascade deletion: CampaignEvent and CampaignLog should not destroy analytics on customer delete

-- CampaignEvent: change onDelete from CASCADE to SET NULL
ALTER TABLE "CampaignEvent" DROP CONSTRAINT "CampaignEvent_customerId_fkey";
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CampaignLog: make customerId nullable and change onDelete from CASCADE to SET NULL
ALTER TABLE "CampaignLog" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "CampaignLog" DROP CONSTRAINT "CampaignLog_customerId_fkey";
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add conversation-level authorization: userId on AIConversation
ALTER TABLE "AIConversation" ADD COLUMN "userId" TEXT;
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AIConversation_userId_idx" ON "AIConversation"("userId");
