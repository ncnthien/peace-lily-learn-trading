import { Module } from '@nestjs/common';
import { BinanceModule } from '../binance/binance.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PriceSyncService } from './price-sync.service.js';

@Module({
  imports: [BinanceModule, PrismaModule],
  providers: [PriceSyncService],
})
export class PriceSyncModule {}
