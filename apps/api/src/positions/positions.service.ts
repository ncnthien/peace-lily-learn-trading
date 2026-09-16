import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreatePositionBoxInput {
  symbol: string;
  interval: string;
  side: 'long' | 'short';
  entryOpenTime: number;
  bars: number;
  entryPrice: number;
  stopPrice: number;
  tpPrice: number;
}

export interface UpdatePositionBoxInput {
  entryPrice?: number;
  stopPrice?: number;
  tpPrice?: number;
  bars?: number;
}

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(symbol: string, interval: string) {
    const rows = await this.prisma.positionBox.findMany({
      where: { symbol, interval },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async create(input: CreatePositionBoxInput) {
    const created = await this.prisma.positionBox.create({
      data: {
        symbol: input.symbol,
        interval: input.interval,
        side: input.side,
        entryOpenTime: BigInt(input.entryOpenTime),
        bars: input.bars,
        entryPrice: input.entryPrice,
        stopPrice: input.stopPrice,
        tpPrice: input.tpPrice,
      },
    });
    return this.toDto(created);
  }

  async update(id: string, patch: UpdatePositionBoxInput) {
    const data: Record<string, number> = {};
    if (patch.entryPrice !== undefined) data.entryPrice = patch.entryPrice;
    if (patch.stopPrice !== undefined) data.stopPrice = patch.stopPrice;
    if (patch.tpPrice !== undefined) data.tpPrice = patch.tpPrice;
    if (patch.bars !== undefined) data.bars = patch.bars;
    try {
      const updated = await this.prisma.positionBox.update({ where: { id }, data });
      return this.toDto(updated);
    } catch {
      throw new NotFoundException(`Position box ${id} not found`);
    }
  }

  async remove(id: string): Promise<{ id: string }> {
    try {
      await this.prisma.positionBox.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Position box ${id} not found`);
    }
    return { id };
  }

  private toDto(row: {
    id: string;
    symbol: string;
    interval: string;
    side: string;
    entryOpenTime: bigint;
    bars: number;
    entryPrice: number;
    stopPrice: number;
    tpPrice: number;
  }) {
    return {
      id: row.id,
      symbol: row.symbol,
      interval: row.interval,
      side: row.side as 'long' | 'short',
      entryOpenTime: Number(row.entryOpenTime),
      bars: row.bars,
      entryPrice: row.entryPrice,
      stopPrice: row.stopPrice,
      tpPrice: row.tpPrice,
    };
  }
}
