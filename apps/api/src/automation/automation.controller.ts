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
import type {
  AutomationInput,
  AutomationItemStatus,
} from '@workspace/shared';
import {
  AUTOMATION_STATUSES,
} from '@workspace/shared';
import {
  AutomationService,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './automation.service.js';

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

function requireStatus(value: unknown): AutomationItemStatus {
  if (
    typeof value !== 'string' ||
    !(AUTOMATION_STATUSES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException(
      `status must be one of: ${AUTOMATION_STATUSES.join(', ')}`,
    );
  }
  return value as AutomationItemStatus;
}

function optionalStatus(value: unknown): AutomationItemStatus | undefined {
  if (value === undefined) return undefined;
  return requireStatus(value);
}

@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  list(@Query('accountId') accountId?: string) {
    return this.automation.list(
      accountId !== undefined ? { accountId } : {},
    );
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.automation.getById(id);
  }

  @Post()
  create(
    @Body()
    body: {
      accountId?: unknown;
      name?: unknown;
      input?: unknown;
      conditions?: unknown[];
      action?: unknown;
      output?: unknown;
      status?: unknown;
    },
  ) {
    if (body.input === undefined) {
      throw new BadRequestException('input is required');
    }
    if (body.action === undefined) {
      throw new BadRequestException('action is required');
    }
    const input: CreateAutomationInput = {
      accountId: requireString(body.accountId, 'accountId'),
      name: requireString(body.name, 'name'),
      input: body.input as AutomationInput,
      action: body.action,
      conditions: body.conditions,
      output: body.output,
      status: optionalStatus(body.status),
    };
    return this.automation.create(input);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: unknown;
      input?: unknown;
      conditions?: unknown[];
      action?: unknown;
      output?: unknown;
      status?: unknown;
    },
  ) {
    const patch: UpdateAutomationInput = {};
    if (body.name !== undefined) patch.name = requireString(body.name, 'name');
    if (body.input !== undefined) patch.input = body.input as AutomationInput;
    if (body.conditions !== undefined) patch.conditions = body.conditions;
    if (body.action !== undefined) patch.action = body.action;
    if (body.output !== undefined) patch.output = body.output;
    if (body.status !== undefined) patch.status = requireStatus(body.status);
    return this.automation.update(id, patch);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.automation.remove(id);
  }
}
