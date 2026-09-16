import { Module } from '@nestjs/common';
import { SRLinesController } from './sr-lines.controller.js';
import { SRLinesService } from './sr-lines.service.js';

@Module({
  controllers: [SRLinesController],
  providers: [SRLinesService],
})
export class SRLinesModule {}
