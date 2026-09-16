import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SRLinesService } from './sr-lines.service.js';

@Controller('sr-lines')
export class SRLinesController {
  constructor(private readonly srLines: SRLinesService) {}

  @Get()
  list(
    @Query('symbol') symbol = 'BTCUSDT',
    @Query('interval') interval = '1h',
  ) {
    return this.srLines.list(symbol.toUpperCase(), interval);
  }

  @Post()
  create(
    @Body() body: { symbol?: string; interval?: string; kind?: string; price?: unknown },
  ) {
    const kind =
      body.kind === 'support' ? 'support' : body.kind === 'resistance' ? 'resistance' : null;
    if (kind === null) {
      throw new BadRequestException('kind must be "support" or "resistance"');
    }
    const price = Number(body.price);
    if (!Number.isFinite(price)) {
      throw new BadRequestException('price must be a finite number');
    }
    return this.srLines.create({
      symbol: (body.symbol ?? 'BTCUSDT').toUpperCase(),
      interval: body.interval ?? '1h',
      kind,
      price,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { price?: unknown }) {
    const price = Number(body.price);
    if (!Number.isFinite(price)) {
      throw new BadRequestException('price must be a finite number');
    }
    return this.srLines.update(id, price);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.srLines.remove(id);
  }
}
