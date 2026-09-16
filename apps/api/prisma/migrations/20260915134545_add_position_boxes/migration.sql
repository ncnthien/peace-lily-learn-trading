-- CreateTable
CREATE TABLE "PositionBox" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entryOpenTime" BIGINT NOT NULL,
    "bars" INTEGER NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "stopPrice" DOUBLE PRECISION NOT NULL,
    "tpPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionBox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PositionBox_symbol_interval_idx" ON "PositionBox"("symbol", "interval");
