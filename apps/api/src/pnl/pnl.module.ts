import { Module } from '@nestjs/common';
import { PnlController } from './pnl.controller.js';
import { PnlService } from './pnl.service.js';

@Module({
  controllers: [PnlController],
  providers: [PnlService],
  exports: [PnlService],
})
export class PnlModule {}