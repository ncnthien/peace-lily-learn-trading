-- CreateTable
CREATE TABLE "Candle" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "openTime" BIGINT NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvaluation" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "indicators" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Candle_symbol_interval_openTime_idx" ON "Candle"("symbol", "interval", "openTime" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Candle_symbol_interval_openTime_key" ON "Candle"("symbol", "interval", "openTime");

-- CreateIndex
CREATE INDEX "SignalEvaluation_symbol_interval_createdAt_idx" ON "SignalEvaluation"("symbol", "interval", "createdAt" DESC);
