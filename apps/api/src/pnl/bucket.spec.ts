import { bucketRealizedPnl } from './bucket.js';

/**
 * Realized-PnL bucketing tests (NCN-22).
 *
 * Each fixture uses a mid-month baseline so day/week/month rollups all
 * exercise different boundary conditions. Times are UTC by construction.
 */
describe('bucketRealizedPnl (NCN-22)', () => {
  // Jan 15 2026 was a Thursday. Week starts Mon Jan 12.
  const thu = Date.UTC(2026, 0, 15, 12, 0, 0);
  const sat = Date.UTC(2026, 0, 17, 12, 0, 0);
  const mon = Date.UTC(2026, 0, 19, 12, 0, 0); // next Monday
  const feb1 = Date.UTC(2026, 1, 1, 12, 0, 0);

  function m(tsMs: number, pnl: number) {
    return { sellTimestamp: new Date(tsMs).toISOString(), realizedPnl: pnl };
  }

  it('returns an empty array when there are no matches', () => {
    expect(bucketRealizedPnl([], 'day')).toEqual([]);
  });

  it('day bucketing: sums same-day entries under YYYY-MM-DD and orders ascending', () => {
    const out = bucketRealizedPnl(
      [m(thu, 10), m(thu, -4), m(sat, 7), m(mon, 3)],
      'day',
    );
    expect(out).toEqual([
      { bucketStart: '2026-01-15', pnl: 6 },
      { bucketStart: '2026-01-17', pnl: 7 },
      { bucketStart: '2026-01-19', pnl: 3 },
    ]);
  });

  it('week bucketing: Monday-anchored ISO week; Thu + Sat land in the same week', () => {
    const out = bucketRealizedPnl(
      [m(thu, 10), m(sat, -2), m(mon, 8)],
      'week',
    );
    // Thu Jan 15 + Sat Jan 17 both fall in the week starting Mon Jan 12.
    // Mon Jan 19 starts the next week.
    expect(out).toEqual([
      { bucketStart: '2026-01-12', pnl: 8 },
      { bucketStart: '2026-01-19', pnl: 8 },
    ]);
  });

  it('month bucketing: YYYY-MM-01 anchored, same-month entries sum', () => {
    const out = bucketRealizedPnl(
      [m(thu, 5), m(sat, 3), m(mon, -1), m(feb1, 42)],
      'month',
    );
    expect(out).toEqual([
      { bucketStart: '2026-01-01', pnl: 7 },
      { bucketStart: '2026-02-01', pnl: 42 },
    ]);
  });

  it('skips matches whose sellTimestamp cannot be parsed (defensive)', () => {
    const out = bucketRealizedPnl(
      [
        { sellTimestamp: 'not-a-date', realizedPnl: 99 },
        m(thu, 5),
      ],
      'day',
    );
    expect(out).toEqual([{ bucketStart: '2026-01-15', pnl: 5 }]);
  });

  it('handles a single match in the requested period', () => {
    expect(bucketRealizedPnl([m(feb1, 12)], 'week')).toEqual([
      // Feb 1 2026 is a Sunday. ISO week starts the previous Monday (Jan 26).
      { bucketStart: '2026-01-26', pnl: 12 },
    ]);
  });
});
