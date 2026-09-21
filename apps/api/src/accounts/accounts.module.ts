import { Module } from '@nestjs/common';
import { OrderExecutionModule } from '../order-execution/order-execution.module.js';
import { PnlModule } from '../pnl/pnl.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { DemoBalanceTracker } from './demo-balance.tracker.js';

@Module({
  imports: [OrderExecutionModule, PnlModule],
  controllers: [AccountsController],
  providers: [AccountsService, DemoBalanceTracker],
  exports: [AccountsService],
})
export class AccountsModule {}
