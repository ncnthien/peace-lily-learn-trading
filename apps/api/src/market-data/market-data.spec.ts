import { Timeframe } from '@workspace/shared';
import { BinanceMarketDataSource } from './binance-market-data.source.js';
import { MockMarketDataSource } from './mock-market-data.source.js';

const TF = Timeframe.ONE_HOUR;

function fakeCandle(openTime: number, close: number) {
  return {
    openTime,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
    closeTime: openTime + 3_599_999,
  };
}

describe('MockMarketDataSource', () => {
  it('returns an empty array when no fixture is set', async () => {
    const src = new MockMarketDataSource();
    const result = await src.getCandles({ symbol: 'BTCUSDT', interval: TF, limit: 10 });
    expect(result).toEqual([]);
  });

  it('returns seeded candles and honors startTime/endTime filters', async () => {
    const src = new MockMarketDataSource();
    const candles = [
      fakeCandle(1_000, 100),
      fakeCandle(2_000, 101),
      fakeCandle(3_000, 102),
      fakeCandle(4_000, 103),
    ];
    src.setCandles('BTCUSDT', candles);

    const all = await src.getCandles({ symbol: 'BTCUSDT', interval: TF, limit: 10 });
    expect(all).toHaveLength(4);

    const windowed = await src.getCandles({
      symbol: 'BTCUSDT',
      interval: TF,
      limit: 10,
      startTime: 2_000,
      endTime: 4_000,
    });
    expect(windowed.map((c) => c.openTime)).toEqual([2_000, 3_000]);
  });

  it('delivers ticks to subscribers and stops on unsubscribe', () => {
    const src = new MockMarketDataSource();
    const received: number[] = [];
    const unsub = src.subscribe({ symbol: 'BTCUSDT' }, (tick) =>
      received.push(tick.price),
    );
    expect(src.subscriberCount('BTCUSDT')).toBe(1);

    src.emitTick({ symbol: 'BTCUSDT', price: 100, timestamp: 1 });
    src.emitTick({ symbol: 'BTCUSDT', price: 101, timestamp: 2 });
    expect(received).toEqual([100, 101]);

    unsub();
    expect(src.subscriberCount('BTCUSDT')).toBe(0);
    src.emitTick({ symbol: 'BTCUSDT', price: 102, timestamp: 3 });
    expect(received).toEqual([100, 101]);
  });

  it('unsubscribe is idempotent', () => {
    const src = new MockMarketDataSource();
    const unsub = src.subscribe({ symbol: 'BTCUSDT' }, () => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('emits a tick with the latest close when emitCandles is called', () => {
    const src = new MockMarketDataSource();
    const ticks: number[] = [];
    src.subscribe({ symbol: 'BTCUSDT' }, (tick) => ticks.push(tick.price));
    src.emitCandles('BTCUSDT', [fakeCandle(1_000, 100), fakeCandle(2_000, 105)]);
    expect(ticks).toEqual([105]);
  });

  it('shutdown detaches all subscribers', () => {
    const src = new MockMarketDataSource();
    const received: number[] = [];
    src.subscribe({ symbol: 'BTCUSDT' }, (tick) => received.push(tick.price));
    src.subscribe({ symbol: 'ETHUSDT' }, () => {});
    src.shutdown();
    expect(src.subscriberCount('BTCUSDT')).toBe(0);
    src.emitTick({ symbol: 'BTCUSDT', price: 1, timestamp: 1 });
    expect(received).toEqual([]);
  });
});

describe('BinanceMarketDataSource', () => {
  const sources: BinanceMarketDataSource[] = [];

  function makeSource() {
    const getKlines = vi.fn().mockResolvedValue([fakeCandle(2_000, 200)]);
    const getPrice = vi.fn().mockResolvedValue(200);
    const binance = { getKlines, getPrice } as unknown as ConstructorParameters<
      typeof BinanceMarketDataSource
    >[0];
    const source = new BinanceMarketDataSource(binance);
    sources.push(source);
    return { source, getKlines, getPrice };
  }

  afterEach(() => {
    for (const s of sources) s.shutdown();
    sources.length = 0;
  });

  it('normalizes the symbol passed to Binance (trim + uppercase)', async () => {
    const { source, getKlines } = makeSource();
    await source.getCandles({
      symbol: '  btcusdt  ',
      interval: TF,
      limit: 1,
    });
    expect(getKlines).toHaveBeenCalledWith('BTCUSDT', TF, 1, undefined, undefined);
  });

  it('delegates getCandles to BinanceService with the same args', async () => {
    const { source, getKlines } = makeSource();
    const candles = await source.getCandles({
      symbol: 'BTCUSDT',
      interval: TF,
      limit: 50,
      startTime: 1,
      endTime: 2,
    });
    expect(getKlines).toHaveBeenCalledWith('BTCUSDT', TF, 50, 1, 2);
    expect(candles).toHaveLength(1);
    expect(candles[0]!.close).toBe(200);
  });

  it('fans out a tick to every subscriber of the same symbol', async () => {
    const { source, getPrice } = makeSource();
    const a: number[] = [];
    const b: number[] = [];
    source.subscribe({ symbol: 'BTCUSDT' }, (tick) => a.push(tick.price));
    source.subscribe({ symbol: 'BTCUSDT' }, (tick) => b.push(tick.price));

    // The first subscribe kicks off an immediate poll — wait for it.
    await vi.waitFor(() => {
      expect(getPrice).toHaveBeenCalled();
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });
    expect(a[0]).toBe(200);
    expect(b[0]).toBe(200);
  });

  it('stops emitting after unsubscribe', async () => {
    const { source } = makeSource();
    const received: number[] = [];
    const unsub = source.subscribe({ symbol: 'BTCUSDT' }, (tick) =>
      received.push(tick.price),
    );

    await vi.waitFor(() => expect(received).toHaveLength(1));
    unsub();
    // Drain pending microtasks and confirm no further ticks land.
    await new Promise((r) => setTimeout(r, 10));
    const countAfterUnsub = received.length;
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(countAfterUnsub);
  });

  it('shutdown is idempotent and stops further polls', async () => {
    const { source, getPrice } = makeSource();
    source.subscribe({ symbol: 'BTCUSDT' }, () => {});
    await vi.waitFor(() => expect(getPrice).toHaveBeenCalledTimes(1));
    source.shutdown();
    expect(() => source.shutdown()).not.toThrow();
    // Wait longer than the poll interval to confirm no further polls happen.
    await new Promise((r) => setTimeout(r, 1_100));
    expect(getPrice).toHaveBeenCalledTimes(1);
  });

  it('in-flight pollOnce does not dispatch after shutdown', async () => {
    let resolvePrice!: (price: number) => void;
    const getPrice = vi.fn().mockImplementation(
      () => new Promise<number>((r) => { resolvePrice = r; }),
    );
    const binance = {
      getKlines: vi.fn().mockResolvedValue([]),
      getPrice,
    } as unknown as ConstructorParameters<typeof BinanceMarketDataSource>[0];
    const source = new BinanceMarketDataSource(binance);
    sources.push(source);

    const received: number[] = [];
    source.subscribe({ symbol: 'BTCUSDT' }, (tick) => received.push(tick.price));

    // The immediate poll is mid-await on the pending getPrice promise.
    source.shutdown();
    resolvePrice(123);

    // Give the awaited pollOnce a few microtasks to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual([]);
  });
});
