import { IndicatorsService } from './indicators.service.js';

describe('IndicatorsService', () => {
  const service = new IndicatorsService();

  it('rsi returns 100 on all gains', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(service.rsi(closes).value).toBe(100);
  });

  it('rsi returns 0 on all losses', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(service.rsi(closes).value).toBe(0);
  });

  it('rsi returns null when not enough data', () => {
    expect(service.rsi([1, 2, 3]).value).toBeNull();
  });

  it('wma computes weighted average of the last period closes', () => {
    const closes = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(service.wma(closes, 5).value).toBeCloseTo(130 / 15, 10);
  });

  it('wma returns null when not enough data', () => {
    expect(service.wma([1, 2, 3], 5).value).toBeNull();
  });

  it('supportResistance detects a cluster at repeated peaks as resistance', () => {
    const candles = [];
    for (let i = 0; i < 80; i++) {
      let price: number;
      if (i < 20) price = 100 + i;
      else if (i < 30) price = 120 - (i - 20);
      else if (i < 50) price = 110 + (i - 30);
      else if (i < 60) price = 130 - (i - 50);
      else price = 120 + (i - 60);
      candles.push({
        openTime: i * 86_400_000,
        open: price,
        high: price + 0.5,
        low: price - 0.5,
        close: price,
        volume: 1,
        closeTime: i * 86_400_000 + 86_399_999,
      });
    }
    const { levels } = service.supportResistance(candles, {
      leftBars: 5,
      rightBars: 5,
      thresholdPct: 0.5,
      maxLevels: 6,
    });
    expect(levels.length).toBeGreaterThan(0);
    const lastClose = candles.at(-1)!.close;
    for (const level of levels) {
      expect(level.touches).toBeGreaterThanOrEqual(1);
      if (level.price <= lastClose) expect(level.kind).toBe('support');
      else expect(level.kind).toBe('resistance');
    }
    const peakZone = levels.find((l) => l.price > 128 && l.price < 132);
    expect(peakZone).toBeDefined();
  });

  it('supportResistance returns empty levels when not enough data', () => {
    expect(
      service.supportResistance(
        Array.from({ length: 10 }, (_, i) => ({
          openTime: i,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
          closeTime: i,
        })),
      ).levels,
    ).toEqual([]);
  });
});
