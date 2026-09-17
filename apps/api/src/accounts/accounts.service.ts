import { Injectable, NotFoundException } from '@nestjs/common';
import type { Account, AccountStatus, AccountType } from '@workspace/shared';
import { AccountStatus as AccountStatusValues } from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  /** Initial balance — defaults to 0 if omitted */
  balance?: number;
}

export interface UpdateAccountInput {
  name?: string;
  /** Allowed values: 'active' | 'disabled' */
  status?: AccountStatus;
}

interface AccountRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** List accounts, optionally filtered by type. */
  async list(filter?: { type?: AccountType }): Promise<Account[]> {
    const rows = await this.prisma.account.findMany({
      where: filter?.type !== undefined ? { type: filter.type } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async getById(id: string): Promise<Account> {
    const row = await this.prisma.account.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return this.toDto(row);
  }

  async create(input: CreateAccountInput): Promise<Account> {
    const created = await this.prisma.account.create({
      data: {
        name: input.name,
        type: input.type,
        balance: input.balance ?? 0,
        status: AccountStatusValues.ACTIVE,
      },
    });
    return this.toDto(created);
  }

  async update(id: string, patch: UpdateAccountInput): Promise<Account> {
    const data: { name?: string; status?: string } = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.status !== undefined) data.status = patch.status;
    try {
      const updated = await this.prisma.account.update({ where: { id }, data });
      return this.toDto(updated);
    } catch {
      throw new NotFoundException(`Account ${id} not found`);
    }
  }

  async remove(id: string): Promise<{ id: string }> {
    try {
      await this.prisma.account.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return { id };
  }

  private toDto(row: AccountRow): Account {
    return {
      id: row.id,
      name: row.name,
      type: row.type as AccountType,
      balance: row.balance,
      status: row.status as AccountStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
