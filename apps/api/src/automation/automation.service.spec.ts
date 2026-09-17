import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AutomationItemStatus } from '@workspace/shared';
import { AutomationService } from './automation.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { TimeProvider } from './providers/time.provider.js';

interface MockAutomationRow {
  id: string;
  accountId: string;
  name: string;
  input: unknown;
  conditions: unknown;
  action: unknown;
  output: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeRow(overrides: Partial<MockAutomationRow> = {}): MockAutomationRow {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: overrides.id ?? 'auto-1',
    accountId: overrides.accountId ?? 'acc-1',
    name: overrides.name ?? 'Test Item',
    input: overrides.input ?? { kind: 'time', cron: '* * * * *' },
    conditions: overrides.conditions ?? [],
    action: overrides.action ?? { kind: 'buy', symbol: 'BTCUSDT', qty: 0.1 },
    output: overrides.output ?? { kind: 'none' },
    status: overrides.status ?? AutomationItemStatus.ENABLED,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makePrismaMock(rows: MockAutomationRow[]) {
  const store = new Map(rows.map((r) => [r.id, r]));
  return {
    automationItem: {
      findMany: vi.fn(async (args?: { where?: { accountId?: string } }) => {
        const all = [...store.values()];
        const filtered =
          args?.where?.accountId !== undefined
            ? all.filter((r) => r.accountId === args.where!.accountId)
            : all;
        return filtered.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return store.get(args.where.id) ?? null;
      }),
      create: vi.fn(async (args: { data: Omit<MockAutomationRow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } }) => {
        const id = args.data.id ?? `auto-${store.size + 1}`;
        const row: MockAutomationRow = {
          id,
          accountId: args.data.accountId,
          name: args.data.name,
          input: args.data.input,
          conditions: args.data.conditions,
          action: args.data.action,
          output: args.data.output,
          status: args.data.status ?? AutomationItemStatus.ENABLED,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(id, row);
        return row;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<MockAutomationRow> }) => {
        const existing = store.get(args.where.id);
        if (existing === undefined) {
          const err = new Error('Record not found') as Error & { code: string };
          err.code = 'P2025';
          throw err;
        }
        const updated = { ...existing, ...args.data, updatedAt: new Date() };
        store.set(args.where.id, updated);
        return updated;
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const existing = store.get(args.where.id);
        if (existing === undefined) {
          const err = new Error('Record not found') as Error & { code: string };
          err.code = 'P2025';
          throw err;
        }
        store.delete(args.where.id);
        return existing;
      }),
    },
  };
}

describe('AutomationService', () => {
  let registry: ProviderRegistry;
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: AutomationService;

  beforeEach(() => {
    registry = new ProviderRegistry();
    new TimeProvider(registry); // self-registers as 'time'
    prisma = makePrismaMock([makeRow()]);
    service = new AutomationService(
      prisma as unknown as ConstructorParameters<typeof AutomationService>[0],
      registry,
    );
  });

  describe('list', () => {
    it('returns all items when no filter is given', async () => {
      prisma = makePrismaMock([
        makeRow({ id: 'a', accountId: 'acc-1' }),
        makeRow({ id: 'b', accountId: 'acc-2' }),
      ]);
      service = new AutomationService(
        prisma as unknown as ConstructorParameters<typeof AutomationService>[0],
        registry,
      );
      const result = await service.list();
      expect(result.map((r) => r.id).sort()).toEqual(['a', 'b']);
    });

    it('filters by accountId', async () => {
      const result = await service.list({ accountId: 'acc-1' });
      expect(result.map((r) => r.id)).toEqual(['auto-1']);
      expect(prisma.automationItem.findMany).toHaveBeenCalledWith({
        where: { accountId: 'acc-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('getById', () => {
    it('returns the item when found', async () => {
      const result = await service.getById('auto-1');
      expect(result.id).toBe('auto-1');
      expect(result.accountId).toBe('acc-1');
    });

    it('throws NotFound when missing', async () => {
      await expect(service.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates an item and validates the input via the provider', async () => {
      const result = await service.create({
        accountId: 'acc-1',
        name: 'My Rule',
        input: { kind: 'time', cron: '*/5 * * * *' },
        action: { kind: 'buy', symbol: 'BTCUSDT', qty: 0.1 },
      });
      expect(result.name).toBe('My Rule');
      expect(result.accountId).toBe('acc-1');
      expect(result.input).toEqual({ kind: 'time', cron: '*/5 * * * *' });
    });

    it('rejects an unknown input kind', async () => {
      await expect(
        service.create({
          accountId: 'acc-1',
          name: 'X',
          input: { kind: 'unknown' },
          action: { kind: 'buy', symbol: 'BTCUSDT', qty: 0.1 },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an invalid provider config', async () => {
      await expect(
        service.create({
          accountId: 'acc-1',
          name: 'X',
          input: { kind: 'time', cron: 'not-a-cron' },
          action: { kind: 'buy', symbol: 'BTCUSDT', qty: 0.1 },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('re-validates the input when the kind changes', async () => {
      const result = await service.update('auto-1', {
        input: { kind: 'time', cron: '0 0 * * *' },
      });
      expect(result.input).toEqual({ kind: 'time', cron: '0 0 * * *' });
    });

    it('throws NotFound when the item does not exist', async () => {
      await expect(
        service.update('missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('returns the deleted id', async () => {
      const result = await service.remove('auto-1');
      expect(result).toEqual({ id: 'auto-1' });
    });

    it('throws NotFound when the item does not exist', async () => {
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
