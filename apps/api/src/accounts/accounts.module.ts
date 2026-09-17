import { Module } from '@nestjs/common';
import { OrderExecutionModule } from '../order-execution/order-execution.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { DemoBalanceTracker } from './demo-balance.tracker.js';

@Module({
  imports: [OrderExecutionModule],
  controllers: [AccountsController],
  providers: [AccountsService, DemoBalanceTracker],
  exports: [AccountsService],
})
export class AccountsModule {}
