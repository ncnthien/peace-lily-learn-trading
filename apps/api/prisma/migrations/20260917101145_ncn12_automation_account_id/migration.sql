-- AlterTable: add required accountId to AutomationItem (NCN-12).
-- Backfill any existing rows by pointing them at the first Account; manual fix
-- is required if no Account exists, but in a fresh dev DB this is a no-op.
ALTER TABLE "AutomationItem" ADD COLUMN "accountId" TEXT;

DO $$
DECLARE
  fallback_account_id TEXT;
BEGIN
  SELECT id INTO fallback_account_id FROM "Account" ORDER BY "createdAt" ASC LIMIT 1;
  IF fallback_account_id IS NOT NULL THEN
    UPDATE "AutomationItem"
      SET "accountId" = fallback_account_id
      WHERE "accountId" IS NULL;
  END IF;
END $$;

ALTER TABLE "AutomationItem" ALTER COLUMN "accountId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "AutomationItem" ADD CONSTRAINT "AutomationItem_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE;
