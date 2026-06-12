ALTER TABLE "AIToolExecution"
  ADD COLUMN "providerCallId" TEXT,
  ADD COLUMN "round" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sources" JSONB,
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedBy" TEXT;

CREATE INDEX "AIToolExecution_providerCallId_idx"
  ON "AIToolExecution"("providerCallId");
