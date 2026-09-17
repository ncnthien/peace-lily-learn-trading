import { Module } from '@nestjs/common';
import { MockOrderExecution } from './mock-order-execution.js';
import { ORDER_EXECUTION } from './order-execution.types.js';

@Module({
  providers: [
    MockOrderExecution,
    {
      // DEMO backend binding. When NCN-8 lands AccountsService and NCN-10
      // lands the real broker OrderExecution, swap this to a router that
      // dispatches by AccountType (accountType discriminator is already on
      // the OrderExecution interface).
      provide: ORDER_EXECUTION,
      useExisting: MockOrderExecution,
    },
  ],
  exports: [ORDER_EXECUTION, MockOrderExecution],
})
export class OrderExecutionModule {}
