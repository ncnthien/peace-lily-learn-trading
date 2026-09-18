-- NCN-20: add optional `fee` column to Trade so realized PnL can
-- account for trading fees. Nullable so existing rows (and broker
-- integrations that don't break out fees) keep computing PnL as if
-- fees were zero.

ALTER TABLE "Trade" ADD COLUMN "fee" DOUBLE PRECISION;
