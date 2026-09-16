import { Module } from '@nestjs/common';
import { BinanceModule } from '../binance/binance.module.js';
import { IndicatorsController } from './indicators.controller.js';
import { IndicatorsService } from './indicators.service.js';

@Module({
  imports: [BinanceModule],
  controllers: [IndicatorsController],
  providers: [IndicatorsService],
  exports: [IndicatorsService],
})
export class IndicatorsModule {}
