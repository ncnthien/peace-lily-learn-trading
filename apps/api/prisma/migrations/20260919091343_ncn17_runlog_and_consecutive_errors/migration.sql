-- DropForeignKey
ALTER TABLE "AutomationItem" DROP CONSTRAINT "AutomationItem_accountId_fkey";

-- AlterTable
ALTER TABLE "AutomationItem" ADD COLUMN     "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "condition" SET DATA TYPE JSONB;

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationItemId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "message" TEXT,
    "ranAt" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRun_automationItemId_ranAt_idx" ON "AutomationRun"("automationItemId", "ranAt");

-- AddForeignKey
ALTER TABLE "AutomationItem" ADD CONSTRAINT "AutomationItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationItemId_fkey" FOREIGN KEY ("automationItemId") REFERENCES "AutomationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
