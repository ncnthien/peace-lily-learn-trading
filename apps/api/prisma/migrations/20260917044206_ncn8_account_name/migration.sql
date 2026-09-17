-- AlterTable: add required display name to Account (NCN-8 CRUD)
ALTER TABLE "Account" ADD COLUMN "name" TEXT;

-- Backfill existing rows with a placeholder so the NOT NULL promotion below succeeds.
UPDATE "Account" SET "name" = 'Account ' || "id" WHERE "name" IS NULL;

ALTER TABLE "Account" ALTER COLUMN "name" SET NOT NULL;
