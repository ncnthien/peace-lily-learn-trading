import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Candle, Timeframe } from '@workspace/shared';

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

const DAY_MS = 86_400_000;

// Binance only natively supports 1d / 3d / 1w above daily — other multi-day
// timeframes are aggregated from daily candles in fixed epoch-aligned buckets.
const BINANCE_INTERVALS: Record<Timeframe, { interval: string; factor: number }> = {
  '1m': { interval: '1m', factor: 1 },
  '5m': { interval: '5m', factor: 1 },
  '15m': { interval: '15m', factor: 1 },
  '1h': { interval: '1h', factor: 1 },
  '4h': { interval: '4h', factor: 1 },
  '1d': { interval: '1d', factor: 1 },
  '2d': { interval: '1d', factor: 2 },
  '3d': { interval: '3d', factor: 1 },
  '4d': { interval: '1d', factor: 4 },
  '5d': { interval: '1d', factor: 5 },
  '6d': { interval: '1d', factor: 6 },
  '1w': { interval: '1w', factor: 1 },
};

@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('BINANCE_BASE_URL', 'https://api.binance.com');
  }

  async getKlines(
    symbol: string,
    interval: Timeframe,
    limit: number,
    startTime?: number,
    endTime?: number,
  ): Promise<Candle[]> {
    const { interval: baseInterval, factor } = BINANCE_INTERVALS[interval];
    const baseLimit = Math.min(limit * factor + (factor > 1 ? factor : 0), 1000);
    const params = new URLSearchParams({
      symbol,
      interval: baseInterval,
      limit: String(baseLimit),
    });
    if (startTime !== undefined) params.set('startTime', String(startTime));
    if (endTime !== undefined) params.set('endTime', String(endTime));
    const res = await fetch(`${this.baseUrl}/api/v3/klines?${params}`);
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Binance klines failed: ${res.status} ${body}`);
      throw new Error(`Binance API error ${res.status}`);
    }
    const raw = (await res.json()) as RawKline[];
    const candles = this.toCandles(raw);
    if (factor === 1) return candles;
    let aggregated = this.aggregate(candles, factor);
    if (endTime !== undefined && candles.length > 0 && candles[0].openTime % (DAY_MS * factor) !== 0) {
      aggregated = aggregated.slice(1);
    }
    return aggregated.slice(-limit);
  }

  async getPrice(symbol: string): Promise<number> {
    const params = new URLSearchParams({ symbol });
    const res = await fetch(`${this.baseUrl}/api/v3/ticker/price?${params}`);
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Binance ticker failed: ${res.status} ${body}`);
      throw new Error(`Binance API error ${res.status}`);
    }
    const data = (await res.json()) as { price: string };
    return Number(data.price);
  }

  private toCandles(raw: RawKline[]): Candle[] {
    return raw.map((k) => ({
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Number(k[6]),
    }));
  }

  private aggregate(candles: Candle[], factor: number): Candle[] {
    const bucketMs = DAY_MS * factor;
    const buckets = new Map<number, Candle>();
    for (const c of candles) {
      const bucketOpen = Math.floor(c.openTime / bucketMs) * bucketMs;
      const existing = buckets.get(bucketOpen);
      if (existing === undefined) {
        buckets.set(bucketOpen, { ...c, openTime: bucketOpen });
      } else {
        existing.high = Math.max(existing.high, c.high);
        existing.low = Math.min(existing.low, c.low);
        existing.close = c.close;
        existing.volume += c.volume;
        existing.closeTime = c.closeTime;
      }
    }
    return [...buckets.values()].sort((a, b) => a.openTime - b.openTime);
  }
}
