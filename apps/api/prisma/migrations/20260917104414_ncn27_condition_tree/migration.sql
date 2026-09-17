-- NCN-27: Replace flat `conditions` array with a single `condition` tree.
-- The old `AutomationCondition[]` shape (NCN-12) and the ConfluenceRule
-- predicate composition are gone — a `ConditionNode` is now a recursive
-- `LeafCondition | CompositeCondition` walked by the rule engine.
--
-- Strategy: add the new column with a non-null default of `true` (matches
-- everything) so existing rows stay valid; backfill from the legacy
-- `conditions` array if it has any entries, then drop the old column.

-- Step 1: add the new column as nullable so we can backfill safely.
ALTER TABLE "AutomationItem" ADD COLUMN "condition" JSON;

-- Step 2: backfill from the legacy `conditions` array.
--
-- Legacy rows were an `AutomationCondition[]` (AND-ed list). The closest
-- equivalent in the new tree is a CompositeCondition with operator='and'
-- over the same predicates. Old conditions referenced field+operator+value
-- triples; the new leaf types are coarser, so for existing rows we wrap
-- the array in an `and` composite under a `legacy_pass` marker so the
-- rule engine's safe-by-default evaluation (`true` for unknown leaves)
-- keeps the row triggering until a human migrates it.
UPDATE "AutomationItem"
SET "condition" = jsonb_build_object(
  'operator', 'and',
  'children', jsonb_build_array(
    jsonb_build_object(
      'type', 'legacy_pass',
      'note', 'Migrated from NCN-12 conditions array; please re-author.',
      'legacy', "conditions"
    )
  )
)::json
WHERE "condition" IS NULL;

-- Step 3: tighten the new column to NOT NULL now that every row has a value.
ALTER TABLE "AutomationItem" ALTER COLUMN "condition" SET NOT NULL;

-- Step 4: drop the legacy array column.
ALTER TABLE "AutomationItem" DROP COLUMN "conditions";
