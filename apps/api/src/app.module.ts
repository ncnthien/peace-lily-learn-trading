import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountsModule } from './accounts/accounts.module.js';
import { AppController } from './app.controller.js';
import { AutomationModule } from './automation/automation.module.js';
import { BinanceModule } from './binance/binance.module.js';
import { IndicatorsModule } from './indicators/indicators.module.js';
import { MarketDataModule } from './market-data/market-data.module.js';
import { OrderExecutionModule } from './order-execution/order-execution.module.js';
import { PriceSyncModule } from './price-sync/price-sync.module.js';
import { PricesModule } from './prices/prices.module.js';
import { PnlModule } from './pnl/pnl.module.js';
import { PositionsModule } from './positions/positions.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SRLinesModule } from './sr-lines/sr-lines.module.js';
import { SignalsModule } from './signals/signals.module.js';
import { TradesModule } from './trades/trades.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    BinanceModule,
    IndicatorsModule,
    SignalsModule,
    PricesModule,
    PriceSyncModule,
    PositionsModule,
    SettingsModule,
    MarketDataModule,
    AccountsModule,
    OrderExecutionModule,
    AutomationModule,
    TradesModule,
    PnlModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
