import { Module } from '@nestjs/common';
import { OrderExecutionModule } from '../order-execution/order-execution.module.js';
import { TradesController } from './trades.controller.js';
import { TradesService } from './trades.service.js';

@Module({
  imports: [OrderExecutionModule],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
