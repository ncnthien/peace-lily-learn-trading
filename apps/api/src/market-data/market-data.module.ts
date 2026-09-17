import { Module } from '@nestjs/common';
import { BinanceModule } from '../binance/binance.module.js';
import { BinanceMarketDataSource } from './binance-market-data.source.js';
import { MARKET_DATA_SOURCE } from './market-data.types.js';

@Module({
  imports: [BinanceModule],
  providers: [
    BinanceMarketDataSource,
    {
      // Default binding — tests can override by rebinding MARKET_DATA_SOURCE
      // in their TestingModule.
      provide: MARKET_DATA_SOURCE,
      useExisting: BinanceMarketDataSource,
    },
  ],
  exports: [MARKET_DATA_SOURCE],
})
export class MarketDataModule {}
