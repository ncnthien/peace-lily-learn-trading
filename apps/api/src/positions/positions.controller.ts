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
import {
  CreatePositionBoxInput,
  PositionsService,
  UpdatePositionBoxInput,
} from './positions.service.js';

function requireNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`${field} must be a finite number`);
  }
  return n;
}

@Controller('position-boxes')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  list(
    @Query('symbol') symbol = 'BTCUSDT',
    @Query('interval') interval = '1h',
  ) {
    return this.positions.list(symbol.toUpperCase(), interval);
  }

  @Post()
  create(
    @Body()
    body: {
      symbol?: string;
      interval?: string;
      side?: string;
      entryOpenTime?: unknown;
      bars?: unknown;
      entryPrice?: unknown;
      stopPrice?: unknown;
      tpPrice?: unknown;
    },
  ) {
    const side = body.side === 'short' ? 'short' : body.side === 'long' ? 'long' : null;
    if (side === null) {
      throw new BadRequestException('side must be "long" or "short"');
    }
    const input: CreatePositionBoxInput = {
      symbol: (body.symbol ?? 'BTCUSDT').toUpperCase(),
      interval: body.interval ?? '1h',
      side,
      entryOpenTime: requireNumber(body.entryOpenTime, 'entryOpenTime'),
      bars: Math.min(Math.max(requireNumber(body.bars, 'bars'), 1), 5000),
      entryPrice: requireNumber(body.entryPrice, 'entryPrice'),
      stopPrice: requireNumber(body.stopPrice, 'stopPrice'),
      tpPrice: requireNumber(body.tpPrice, 'tpPrice'),
    };
    return this.positions.create(input);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { entryPrice?: unknown; stopPrice?: unknown; tpPrice?: unknown; bars?: unknown },
  ) {
    const patch: UpdatePositionBoxInput = {};
    if (body.entryPrice !== undefined) patch.entryPrice = requireNumber(body.entryPrice, 'entryPrice');
    if (body.stopPrice !== undefined) patch.stopPrice = requireNumber(body.stopPrice, 'stopPrice');
    if (body.tpPrice !== undefined) patch.tpPrice = requireNumber(body.tpPrice, 'tpPrice');
    if (body.bars !== undefined) patch.bars = Math.min(Math.max(requireNumber(body.bars, 'bars'), 1), 5000);
    return this.positions.update(id, patch);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.positions.remove(id);
  }
}
