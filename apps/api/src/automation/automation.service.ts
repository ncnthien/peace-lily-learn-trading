import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AutomationInput,
  AutomationItem,
  AutomationItemStatus,
  ConditionNode,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';
import { ProviderRegistry } from './providers/provider.registry.js';

// Re-export the schema-derived types so the existing controller import
// path (`CreateAutomationInput`, `UpdateAutomationInput` from this
// module) keeps working without churn.
export type { CreateAutomationInput, UpdateAutomationInput };

interface AutomationRow {
  id: string;
  accountId: string;
  name: string;
  input: unknown;
  condition: unknown;
  action: unknown;
  output: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly conditionEvaluator: ConditionEvaluator,
  ) {}

  /** List automation items, optionally filtered by account. */
  async list(filter: { accountId?: string } = {}): Promise<AutomationItem[]> {
    const rows = await this.prisma.automationItem.findMany({
      where: filter.accountId !== undefined ? { accountId: filter.accountId } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async getById(id: string): Promise<AutomationItem> {
    const row = await this.prisma.automationItem.findUnique({ where: { id } });
    if (row === null) throw new NotFoundException(`AutomationItem ${id} not found`);
    return this.toDto(row);
  }

  /**
   * Create an automation item. The body has already been validated by
   * ZodValidationPipe at the controller boundary — the schema rejects
   * malformed `input`, `condition`, `action`, and `output` shapes
   * before the handler runs. We still call `validateInput` here to
   * provider-specific normalisation (cron parse, symbol validation,
   * etc.) which is provider-implementation-specific.
   */
  async create(input: CreateAutomationInput): Promise<AutomationItem> {
    const validatedInput = this.validateInput(input.input);
    const created = await this.prisma.automationItem.create({
      data: {
        accountId: input.accountId,
        name: input.name,
        input: validatedInput,
        condition: input.condition as unknown as object,
        action: input.action as object,
        output: (input.output ?? { kind: 'none' }) as object,
        status: input.status ?? 'enabled',
      },
    });
    return this.toDto(created);
  }

  async update(id: string, patch: UpdateAutomationInput): Promise<AutomationItem> {
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.input !== undefined) data.input = this.validateInput(patch.input);
    if (patch.condition !== undefined) data.condition = patch.condition;
    if (patch.action !== undefined) data.action = patch.action;
    if (patch.output !== undefined) data.output = patch.output;
    if (patch.status !== undefined) data.status = patch.status;
    try {
      const updated = await this.prisma.automationItem.update({ where: { id }, data });
      return this.toDto(updated);
    } catch {
      throw new NotFoundException(`AutomationItem ${id} not found`);
    }
  }

  async remove(id: string): Promise<{ id: string }> {
    try {
      await this.prisma.automationItem.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`AutomationItem ${id} not found`);
    }
    return { id };
  }

  private validateInput(input: AutomationInput): AutomationInput {
    const provider = this.providers.get(input.kind);
    if (provider === undefined) {
      throw new BadRequestException(
        `Unknown input provider kind: "${input.kind}". Registered: ${this.providers.kinds().join(', ') || '(none)'}`,
      );
    }
    // Provider returns only its own params (e.g. { cron } for time). We
    // re-attach the discriminator kind so the persisted AutomationInput
    // remains a valid discriminated union. The cast is safe: validateConfig
    // either returns its declared TConfig shape or throws BadRequestException.
    const params = provider.validateConfig(input) as Record<string, unknown>;
    return { kind: input.kind, ...params } as AutomationInput;
  }

  private toDto(row: AutomationRow): AutomationItem {
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      input: row.input as AutomationItem['input'],
      condition: row.condition as ConditionNode,
      action: row.action as AutomationItem['action'],
      output: row.output as AutomationItem['output'],
      status: row.status as AutomationItemStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
