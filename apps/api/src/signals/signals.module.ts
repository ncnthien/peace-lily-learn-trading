import { Module } from '@nestjs/common';
import { BinanceModule } from '../binance/binance.module.js';
import { IndicatorsModule } from '../indicators/indicators.module.js';
import { SignalsController } from './signals.controller.js';
import { SignalsService } from './signals.service.js';

@Module({
  imports: [BinanceModule, IndicatorsModule],
  controllers: [SignalsController],
  providers: [SignalsService],
  exports: [SignalsService],
})
export class SignalsModule {}
