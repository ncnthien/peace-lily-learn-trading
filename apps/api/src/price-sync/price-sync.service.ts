import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Timeframe } from '@workspace/shared';
import { BinanceService } from '../binance/binance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PriceSyncService {
  private readonly logger = new Logger(PriceSyncService.name);
  private readonly enabled: boolean;
  private readonly symbol: string;
  private readonly interval: Timeframe;

  constructor(
    private readonly binance: BinanceService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('PRICE_SYNC_ENABLED') === 'true';
    this.symbol = config.get<string>('PRICE_SYNC_SYMBOL', 'BTCUSDT');
    this.interval = config.get<Timeframe>('PRICE_SYNC_INTERVAL', '1h');
  }

  // Set PRICE_SYNC_ENABLED=true to persist candles to Postgres every minute
  @Cron('* * * * *')
  async syncCandles(): Promise<void> {
    if (!this.enabled) return;
    try {
      const candles = await this.binance.getKlines(this.symbol, this.interval, 200);
      for (const c of candles) {
        await this.prisma.candle.upsert({
          where: {
            symbol_interval_openTime: {
              symbol: this.symbol,
              interval: this.interval,
              openTime: BigInt(c.openTime),
            },
          },
          update: { high: c.high, low: c.low, close: c.close, volume: c.volume },
          create: {
            symbol: this.symbol,
            interval: this.interval,
            openTime: BigInt(c.openTime),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          },
        });
      }
      this.logger.log(`Synced ${candles.length} candles for ${this.symbol} ${this.interval}`);
    } catch (error) {
      this.logger.error(`Candle sync failed: ${String(error)}`);
    }
  }
}
