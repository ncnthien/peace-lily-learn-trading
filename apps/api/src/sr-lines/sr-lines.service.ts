import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateSRLineInput {
  symbol: string;
  interval: string;
  kind: 'support' | 'resistance';
  price: number;
}

@Injectable()
export class SRLinesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(symbol: string, interval: string) {
    const rows = await this.prisma.sRLine.findMany({
      where: { symbol, interval },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async create(input: CreateSRLineInput) {
    const created = await this.prisma.sRLine.create({
      data: {
        symbol: input.symbol,
        interval: input.interval,
        kind: input.kind,
        price: input.price,
      },
    });
    return this.toDto(created);
  }

  async update(id: string, price: number) {
    try {
      const updated = await this.prisma.sRLine.update({ where: { id }, data: { price } });
      return this.toDto(updated);
    } catch {
      throw new NotFoundException(`SR line ${id} not found`);
    }
  }

  async remove(id: string): Promise<{ id: string }> {
    try {
      await this.prisma.sRLine.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`SR line ${id} not found`);
    }
    return { id };
  }

  private toDto(row: {
    id: string;
    symbol: string;
    interval: string;
    kind: string;
    price: number;
  }) {
    return {
      id: row.id,
      symbol: row.symbol,
      interval: row.interval,
      kind: row.kind as 'support' | 'resistance',
      price: row.price,
    };
  }
}
