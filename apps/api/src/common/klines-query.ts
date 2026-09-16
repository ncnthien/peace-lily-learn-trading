import { BadRequestException } from '@nestjs/common';
import type { Timeframe } from '@workspace/shared';
import { Timeframe as TimeframeValues } from '@workspace/shared';

const TIMEFRAMES = Object.values(TimeframeValues);

export function normalizeSymbol(symbol: string | undefined): string {
  const sym = (symbol ?? 'BTCUSDT').trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(sym)) {
    throw new BadRequestException('Invalid symbol');
  }
  return sym;
}

export function normalizeInterval(interval: Timeframe | undefined): Timeframe {
  if (!interval || !TIMEFRAMES.includes(interval)) {
    throw new BadRequestException(`interval must be one of: ${TIMEFRAMES.join(', ')}`);
  }
  return interval;
}

export function normalizeLimit(limit: string | undefined, fallback = 200): number {
  const n = Number(limit ?? fallback);
  if (!Number.isFinite(n)) {
    throw new BadRequestException('Invalid limit');
  }
  return Math.min(Math.max(Math.trunc(n), 1), 1000);
}

export function normalizeTime(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException('Invalid timestamp, use epoch milliseconds');
  }
  return Math.trunc(n);
}
