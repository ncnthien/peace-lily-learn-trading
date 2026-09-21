import { computeOpenPositions } from './unrealized.js';
import type { FifoTrade } from './fifo.js';

/**
 * Open-position walk tests (NCN-21).
 *
 * Mirrors the test-fixture shape used in fifo.spec.ts — same
 * timestamp-millisecond identities so the two specs stay easy to
 * diff against each other.
 */
describe('computeOpenPositions (NCN-21)', () => {
  const base = Date.UTC(2026, 0, 1);

  function t(
    id: string,
    side: 'buy' | 'sell',
    symbol: string,
    qty: number,
    price: number,
    timestampMs: number,
    fee?: number,
  ): FifoTrade {
    return {
      id,
      symbol,
      side,
      price,
      qty,
      fee,
      timestamp: new Date(timestampMs).toISOString(),
    };
  }

  it('returns an empty array when the account has no trades', () => {
    expect(computeOpenPositions('acc-1', [])).toEqual([]);
  });

  it('emits the open qty + cost basis from a single buy', () => {
    const out = computeOpenPositions('acc-1', [t('b1', 'buy', 'BTCUSDT', 2, 100, base)]);
    expect(out).toEqual([
      {
        accountId: 'acc-1',
        symbol: 'BTCUSDT',
        side: 'buy',
        qty: 2,
        avgEntryPrice: 100,
        markPrice: null,
        unrealizedPnl: null,
        pricedAt: null,
        openedAt: new Date(base).toISOString(),
      },
    ]);
  });

  it('volume-weights multiple buy lots into a single blended cost basis', () => {
    // 1 @ 100 + 1 @ 200 → qty 2, average cost 150.
    const out = computeOpenPositions('acc-1', [
      t('b1', 'buy', 'BTCUSDT', 1, 100, base),
      t('b2', 'buy', 'BTCUSDT', 1, 200, base + 1),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(2);
    expect(out[0]!.avgEntryPrice).toBe(150);
  });

  it('tracks the oldest contributing lot timestamp even after partial sells', () => {
    // Open 2 lots, partially sell from the oldest one. `openedAt` must
    // still be the oldest lot (b1) until b1 is fully consumed.
    const out = computeOpenPositions('acc-1', [
      t('b1', 'buy', 'BTCUSDT', 2, 100, base),
      t('b2', 'buy', 'BTCUSDT', 1, 200, base + 10),
      t('s1', 'sell', 'BTCUSDT', 1, 250, base + 20),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(2);
    // (1*100 + 1*200) / 2 = 150
    expect(out[0]!.avgEntryPrice).toBe(150);
    expect(out[0]!.openedAt).toBe(new Date(base).toISOString());
  });

  it('rolls openedAt forward when the oldest lot is fully consumed', () => {
    // b1 fully closed by s1 → openedAt now reflects b2.
    const out = computeOpenPositions('acc-1', [
      t('b1', 'buy', 'BTCUSDT', 1, 100, base),
      t('b2', 'buy', 'BTCUSDT', 2, 200, base + 10),
      t('s1', 'sell', 'BTCUSDT', 1, 250, base + 20),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(2);
    expect(out[0]!.avgEntryPrice).toBe(200);
    expect(out[0]!.openedAt).toBe(new Date(base + 10).toISOString());
  });

  it('drops a symbol from the snapshot when the position closes out', () => {
    const out = computeOpenPositions('acc-1', [
      t('b1', 'buy', 'BTCUSDT', 1, 100, base),
      t('s1', 'sell', 'BTCUSDT', 1, 150, base + 1),
    ]);
    expect(out).toEqual([]);
  });

  it('emits one entry per symbol, sorted alphabetically for stable responses', () => {
    const out = computeOpenPositions('acc-1', [
      t('b1', 'buy', 'ETHUSDT', 1, 100, base),
      t('b2', 'buy', 'BTCUSDT', 1, 50_000, base + 1),
      t('b3', 'buy', 'SOLUSDT', 1, 20, base + 2),
    ]);
    expect(out.map((p) => p.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('includes allocated buy-side fees in avgEntryPrice', () => {
    // Buy 2 @ 100 with a 10-quote fee → effective cost per unit = 100 + 10/2 = 105.
    const out = computeOpenPositions('acc-1', [t('b1', 'buy', 'BTCUSDT', 2, 100, base, 10)]);
    expect(out[0]!.avgEntryPrice).toBe(105);
    expect(out[0]!.qty).toBe(2);
  });

  it('treats a null fee as 0 (legacy rows)', () => {
    const out = computeOpenPositions('acc-1', [t('b1', 'buy', 'BTCUSDT', 1, 100, base, null)]);
    expect(out[0]!.avgEntryPrice).toBe(100);
  });

  it('emits one entry per held symbol when one position is closed and another is open', () => {
    const out = computeOpenPositions('acc-1', [
      t('b1', 'buy', 'BTCUSDT', 1, 100, base),
      t('b2', 'buy', 'ETHUSDT', 1, 1000, base + 1),
      t('s1', 'sell', 'BTCUSDT', 1, 110, base + 2),
    ]);
    expect(out.map((p) => p.symbol)).toEqual(['ETHUSDT']);
    expect(out[0]!.qty).toBe(1);
    expect(out[0]!.avgEntryPrice).toBe(1000);
  });

  it('surfaces a warning + ignores a sell that has no open position', () => {
    const warnings: string[] = [];
    const out = computeOpenPositions(
      'acc-1',
      [t('s1', 'sell', 'BTCUSDT', 1, 100, base)],
      { logger: { warn: (msg) => warnings.push(msg) } },
    );
    expect(out).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/no open position/);
  });
});
