import { NotFoundException } from '@nestjs/common';
import { AccountStatus, AccountType } from '@workspace/shared';
import { AccountsService } from './accounts.service.js';
import type { DemoBalanceTracker } from './demo-balance.tracker.js';

interface MockAccountRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeRow(overrides: Partial<MockAccountRow> = {}): MockAccountRow {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: overrides.id ?? 'acc-1',
    name: overrides.name ?? 'Test Account',
    type: overrides.type ?? AccountType.DEMO,
    balance: overrides.balance ?? 0,
    status: overrides.status ?? AccountStatus.ACTIVE,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makePrismaMock(rows: MockAccountRow[]) {
  const store = new Map(rows.map((r) => [r.id, r]));
  return {
    account: {
      findMany: vi.fn(async (args?: { where?: { type?: string } }) => {
        const all = [...store.values()];
        const filtered =
          args?.where?.type !== undefined
            ? all.filter((r) => r.type === args.where!.type)
            : all;
        return filtered.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return store.get(args.where.id) ?? null;
      }),
      create: vi.fn(async (args: { data: Omit<MockAccountRow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: Date; updatedAt?: Date } }) => {
        const id = args.data.id ?? `acc-${store.size + 1}`;
        const row: MockAccountRow = {
          id,
          name: args.data.name,
          type: args.data.type,
          balance: args.data.balance ?? 0,
          status: args.data.status ?? AccountStatus.ACTIVE,
          createdAt: args.data.createdAt ?? new Date(),
          updatedAt: args.data.updatedAt ?? new Date(),
        };
        store.set(id, row);
        return row;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<MockAccountRow> }) => {
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

function makeTrackerMock() {
  return {
    track: vi.fn(),
    untrack: vi.fn(),
  };
}

describe('AccountsService', () => {
  let mock: ReturnType<typeof makePrismaMock>;
  let tracker: ReturnType<typeof makeTrackerMock>;
  let service: AccountsService;

  beforeEach(() => {
    mock = makePrismaMock([makeRow({ id: 'acc-1' })]);
    tracker = makeTrackerMock();
    service = new AccountsService(
      mock as unknown as ConstructorParameters<typeof AccountsService>[0],
      tracker as unknown as DemoBalanceTracker,
    );
  });

  describe('list', () => {
    it('returns all accounts when no filter is given', async () => {
      mock = makePrismaMock([
        makeRow({ id: 'a', name: 'A', type: AccountType.DEMO, createdAt: new Date('2026-01-01') }),
        makeRow({ id: 'b', name: 'B', type: AccountType.REAL, createdAt: new Date('2026-01-02') }),
      ]);
      service = new AccountsService(
        mock as unknown as ConstructorParameters<typeof AccountsService>[0],
        tracker as unknown as DemoBalanceTracker,
      );
      const result = await service.list();
      expect(result.map((a) => a.id)).toEqual(['a', 'b']);
    });

    it('filters by type when provided', async () => {
      mock = makePrismaMock([
        makeRow({ id: 'a', type: AccountType.DEMO }),
        makeRow({ id: 'b', type: AccountType.REAL }),
      ]);
      service = new AccountsService(
        mock as unknown as ConstructorParameters<typeof AccountsService>[0],
        tracker as unknown as DemoBalanceTracker,
      );
      const result = await service.list({ type: AccountType.REAL });
      expect(result.map((a) => a.id)).toEqual(['b']);
      expect(mock.account.findMany).toHaveBeenCalledWith({
        where: { type: AccountType.REAL },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('getById', () => {
    it('returns the account DTO when found', async () => {
      const result = await service.getById('acc-1');
      expect(result.name).toBe('Test Account');
      expect(result.type).toBe(AccountType.DEMO);
      expect(result.status).toBe(AccountStatus.ACTIVE);
      expect(typeof result.createdAt).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
    });

    it('throws NotFound when the account does not exist', async () => {
      await expect(service.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a demo account and starts tracking it', async () => {
      const result = await service.create({
        name: 'My Account',
        type: AccountType.DEMO,
      });
      expect(result.name).toBe('My Account');
      expect(result.balance).toBe(0);
      expect(result.status).toBe(AccountStatus.ACTIVE);
      expect(tracker.track).toHaveBeenCalledWith(result.id);
    });

    it('does not start tracking a real account', async () => {
      const result = await service.create({
        name: 'Real Fund',
        type: AccountType.REAL,
        balance: 10_000,
      });
      expect(result.balance).toBe(10_000);
      expect(tracker.track).not.toHaveBeenCalled();
    });

    it('honors an explicit initial balance', async () => {
      const result = await service.create({
        name: 'My Account',
        type: AccountType.DEMO,
        balance: 5_000,
      });
      expect(result.balance).toBe(5_000);
      expect(tracker.track).toHaveBeenCalledWith(result.id);
    });
  });

  describe('update', () => {
    it('updates the name only when other fields are not provided', async () => {
      const result = await service.update('acc-1', { name: 'Renamed' });
      expect(result.name).toBe('Renamed');
      expect(mock.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { name: 'Renamed' },
      });
    });

    it('updates the status only when name is not provided', async () => {
      const result = await service.update('acc-1', {
        status: AccountStatus.DISABLED,
      });
      expect(result.status).toBe(AccountStatus.DISABLED);
      expect(mock.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { status: AccountStatus.DISABLED },
      });
    });

    it('throws NotFound when the account does not exist', async () => {
      await expect(
        service.update('missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('removes a demo account and stops tracking it', async () => {
      const result = await service.remove('acc-1');
      expect(result).toEqual({ id: 'acc-1' });
      expect(mock.account.delete).toHaveBeenCalledWith({ where: { id: 'acc-1' } });
      expect(tracker.untrack).toHaveBeenCalledWith('acc-1');
    });

    it('removes a real account without touching the tracker', async () => {
      mock = makePrismaMock([makeRow({ id: 'r1', type: AccountType.REAL })]);
      service = new AccountsService(
        mock as unknown as ConstructorParameters<typeof AccountsService>[0],
        tracker as unknown as DemoBalanceTracker,
      );
      const result = await service.remove('r1');
      expect(result).toEqual({ id: 'r1' });
      expect(tracker.untrack).not.toHaveBeenCalled();
    });

    it('throws NotFound when the account does not exist', async () => {
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
