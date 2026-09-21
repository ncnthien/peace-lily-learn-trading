import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { PnlController } from './pnl.controller.js';
import { PnlService } from './pnl.service.js';

@Module({
  imports: [MarketDataModule],
  controllers: [PnlController],
  providers: [PnlService],
  exports: [PnlService],
})
export class PnlModule {}