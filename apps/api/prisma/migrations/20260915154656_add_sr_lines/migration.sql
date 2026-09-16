-- CreateTable
CREATE TABLE "SRLine" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SRLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SRLine_symbol_interval_idx" ON "SRLine"("symbol", "interval");
