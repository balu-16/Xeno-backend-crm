-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'RCS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignEventType" AS ENUM ('CampaignCreated', 'CampaignLaunched', 'MessageQueued', 'MessageSent', 'MessageDelivered', 'MessageOpened', 'MessageClicked', 'MessageConverted', 'MessageFailed');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'CONVERTED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ToolExecutionStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "audienceSizeSnapshot" INTEGER NOT NULL DEFAULT 0,
    "launchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "CampaignEventType" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT,
    "attributedOrderId" TEXT,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "failureReason" TEXT,
    "attributedOrderId" TEXT,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAnalytics" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "totalAudience" INTEGER NOT NULL DEFAULT 0,
    "totalQueued" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalDelivered" INTEGER NOT NULL DEFAULT 0,
    "totalOpened" INTEGER NOT NULL DEFAULT 0,
    "totalClicked" INTEGER NOT NULL DEFAULT 0,
    "totalConverted" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "deliveryRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clickRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueAccrued" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CampaignEventType" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConversation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "grounding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIToolExecution" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" "ToolExecutionStatus" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingFailure" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobId" TEXT,
    "correlationId" TEXT,
    "reason" TEXT NOT NULL,
    "diagnostics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessingFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

-- Search and JSON metadata indexes used by customer lists and segment previews.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Customer_email_trgm_idx" ON "Customer" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "Customer_metadata_city_idx" ON "Customer" ((metadata->>'city'));
CREATE INDEX "Customer_metadata_email_engagement_idx" ON "Customer" ((metadata->>'emailEngagement'));

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Segment_createdAt_idx" ON "Segment"("createdAt");

-- CreateIndex
CREATE INDEX "Segment_name_idx" ON "Segment"("name");

-- CreateIndex
CREATE INDEX "Campaign_segmentId_idx" ON "Campaign"("segmentId");

-- CreateIndex
CREATE INDEX "Campaign_status_createdAt_idx" ON "Campaign"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_channel_idx" ON "Campaign"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_eventId_key" ON "CampaignEvent"("eventId");

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_type_occurredAt_idx" ON "CampaignEvent"("campaignId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignEvent_customerId_occurredAt_idx" ON "CampaignEvent"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignEvent_correlationId_idx" ON "CampaignEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLog_attributedOrderId_key" ON "CampaignLog"("attributedOrderId");

-- CreateIndex
CREATE INDEX "CampaignLog_campaignId_status_idx" ON "CampaignLog"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignLog_customerId_updatedAt_idx" ON "CampaignLog"("customerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLog_campaignId_customerId_key" ON "CampaignLog"("campaignId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignAnalytics_campaignId_key" ON "CampaignAnalytics"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignAnalytics_updatedAt_idx" ON "CampaignAnalytics"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_eventId_key" ON "WebhookReceipt"("eventId");

-- CreateIndex
CREATE INDEX "WebhookReceipt_receivedAt_idx" ON "WebhookReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookReceipt_campaignId_receivedAt_idx" ON "WebhookReceipt"("campaignId", "receivedAt");

-- CreateIndex
CREATE INDEX "AIConversation_updatedAt_idx" ON "AIConversation"("updatedAt");

-- CreateIndex
CREATE INDEX "AIMessage_conversationId_createdAt_idx" ON "AIMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIToolExecution_conversationId_createdAt_idx" ON "AIToolExecution"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIToolExecution_toolName_createdAt_idx" ON "AIToolExecution"("toolName", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessingFailure_queue_createdAt_idx" ON "ProcessingFailure"("queue", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_attributedOrderId_fkey" FOREIGN KEY ("attributedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_attributedOrderId_fkey" FOREIGN KEY ("attributedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAnalytics" ADD CONSTRAINT "CampaignAnalytics_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookReceipt" ADD CONSTRAINT "WebhookReceipt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMessage" ADD CONSTRAINT "AIMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIToolExecution" ADD CONSTRAINT "AIToolExecution_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Campaign events are append-only. Development seed/reset code must opt in
-- explicitly within its transaction before removing event history.
CREATE OR REPLACE FUNCTION prevent_campaign_event_mutation()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_campaign_event_mutation', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'CampaignEvent records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_event_immutable
BEFORE UPDATE OR DELETE ON "CampaignEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_campaign_event_mutation();
