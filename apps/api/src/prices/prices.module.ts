import { Module } from '@nestjs/common';
import { BinanceModule } from '../binance/binance.module.js';
import { PricesController } from './prices.controller.js';

@Module({
  imports: [BinanceModule],
  controllers: [PricesController],
})
export class PricesModule {}
