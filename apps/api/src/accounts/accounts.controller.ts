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
import type { AccountStatus, AccountType } from '@workspace/shared';
import {
  AccountStatus as AccountStatusValues,
  AccountType as AccountTypeValues,
} from '@workspace/shared';
import { AccountsService, CreateAccountInput, UpdateAccountInput } from './accounts.service.js';

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
  constructor(private readonly accounts: AccountsService) {}

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
}
