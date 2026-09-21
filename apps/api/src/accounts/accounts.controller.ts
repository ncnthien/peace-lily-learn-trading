import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  AccountDashboard,
  AccountStatus,
  AccountType,
  PnlBucket,
} from '@workspace/shared';
import {
  AccountStatus as AccountStatusValues,
  AccountType as AccountTypeValues,
} from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { PnlService } from '../pnl/pnl.service.js';
import { AccountsService, CreateAccountInput, UpdateAccountInput } from './accounts.service.js';

const ALLOWED_BUCKETS: readonly PnlBucket[] = ['day', 'week', 'month'];

function parseBucket(raw: string | undefined): PnlBucket {
  if (raw === undefined) return 'day';
  if ((ALLOWED_BUCKETS as readonly string[]).includes(raw)) {
    return raw as PnlBucket;
  }
  throw new BadRequestException(
    `bucket must be one of: ${ALLOWED_BUCKETS.join(', ')}`,
  );
}

const ACCOUNT_TYPES = Object.values(AccountTypeValues);
const ACCOUNT_STATUSES = Object.values(AccountStatusValues);

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException(`${field} must not be empty`);
  }
  return trimmed;
}

function requireAccountType(value: unknown): AccountType {
  if (typeof value !== 'string' || !ACCOUNT_TYPES.includes(value as AccountType)) {
    throw new BadRequestException(`type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  }
  return value as AccountType;
}

function requireAccountStatus(value: unknown): AccountStatus {
  if (typeof value !== 'string' || !ACCOUNT_STATUSES.includes(value as AccountStatus)) {
    throw new BadRequestException(`status must be one of: ${ACCOUNT_STATUSES.join(', ')}`);
  }
  return value as AccountStatus;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function optionalAccountStatus(value: unknown): AccountStatus | undefined {
  if (value === undefined) return undefined;
  return requireAccountStatus(value);
}

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly prisma: PrismaService,
    private readonly pnl: PnlService,
  ) {}

  @Get()
  list(@Query('type') type?: string) {
    const filter = type !== undefined ? { type: requireAccountType(type) } : undefined;
    return this.accounts.list(filter);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.accounts.getById(id);
  }

  @Post()
  create(
    @Body() body: { name?: unknown; type?: unknown; balance?: unknown },
  ) {
    const input: CreateAccountInput = {
      name: requireString(body.name, 'name'),
      type: requireAccountType(body.type),
    };
    if (body.balance !== undefined) {
      const n = Number(body.balance);
      if (!Number.isFinite(n)) {
        throw new BadRequestException('balance must be a finite number');
      }
      input.balance = n;
    }
    return this.accounts.create(input);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: unknown; status?: unknown },
  ) {
    const patch: UpdateAccountInput = {};
    const name = optionalString(body.name, 'name');
    if (name !== undefined) patch.name = name;
    const status = optionalAccountStatus(body.status);
    if (status !== undefined) patch.status = status;
    return this.accounts.update(id, patch);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }

  /**
   * GET /accounts/:id/dashboard?bucket=day|week|month (NCN-22).
   *
   * One endpoint so the dashboard renders with a single round-trip.
   * Returns the account's balance + equity (= balance + totalUnrealizedPnl),
   * both PnL totals, the requested bucketed realized-PnL time series,
   * and the bucket echoed back. 404 when the account doesn't exist.
   * Trades / open positions are computed on-demand from the ledger by
   * PnlService — no separate persistence, same convention as NCN-20/21.
   */
  @Get(':id/dashboard')
  async getDashboard(
    @Param('id') id: string,
    @Query('bucket') bucketRaw?: string,
  ): Promise<AccountDashboard> {
    const bucket = parseBucket(bucketRaw);
    const accountRow = await this.prisma.account.findUnique({ where: { id } });
    if (accountRow === null) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    const [realized, unrealized, pnlSeries] = await Promise.all([
      this.pnl.getSummary(id),
      this.pnl.getUnrealizedSummary(id),
      this.pnl.getPnlSeries(id, bucket),
    ]);
    return {
      account: {
        id: accountRow.id,
        name: accountRow.name,
        type: accountRow.type as AccountType,
        balance: accountRow.balance,
        status: accountRow.status,
        createdAt: accountRow.createdAt.toISOString(),
        updatedAt: accountRow.updatedAt.toISOString(),
      },
      equity: accountRow.balance + unrealized.totalUnrealizedPnl,
      totals: {
        realized: realized.totalRealizedPnl,
        unrealized: unrealized.totalUnrealizedPnl,
      },
      bucket,
      pnlSeries,
    };
  }
}
