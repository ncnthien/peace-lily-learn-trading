import { Injectable, NotFoundException } from '@nestjs/common';
import type { Account, AccountStatus, AccountType } from '@workspace/shared';
import { AccountStatus as AccountStatusValues } from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { DemoBalanceTracker } from './demo-balance.tracker.js';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceTracker: DemoBalanceTracker,
  ) {}

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
    if (created.type === 'demo') {
      // Subscribe to fill events so the balance updates as orders execute.
      this.balanceTracker.track(created.id);
    }
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
    // Look up the row first so we know whether to unsubscribe (only demo
    // accounts are tracked).
    const existing = await this.prisma.account.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    await this.prisma.account.delete({ where: { id } });
    if (existing.type === 'demo') {
      this.balanceTracker.untrack(id);
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
