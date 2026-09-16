import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service.js';

@Module({
  providers: [BinanceService],
  exports: [BinanceService],
})
export class BinanceModule {}
