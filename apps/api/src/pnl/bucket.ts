/**
 * Realized-PnL bucketing (NCN-22).
 *
 * Pure function: takes the realized-PnL matches produced by
 * {@link ./fifo.ts} (already sorted ascending by `sellTimestamp`)
 * and buckets their `realizedPnl` sums by `day | week | month`.
 *
 * Buckets are computed in UTC so two accounts in different timezones
 * see the same series for a shared `accountId`. The UI converts
 * bucket keys to local time when rendering.
 *
 * Returned buckets are **only those that contain at least one match**
 * — sparse by construction. A long-stale account simply returns [].
 * The UI fills gaps with empty bars instead of zero-padding every
 * historical week.
 */

import type { PnlBucket, PnlBucketPoint } from '@workspace/shared';

export interface PnlMatchForBucket {
  sellTimestamp: string; // ISO 8601
  realizedPnl: number;
}

/** Floor a UTC date to the start of the day, in YYYY-MM-DD. */
function dayKeyUtc(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

/**
 * Floor a UTC date to the Monday of its ISO week.
 *
 * `getUTCDay()` returns 0 (Sun)..6 (Sat); ISO weeks start Monday, so a
 * 0 needs to roll back to the *previous* Monday, while a 1..6 just
 * subtracts (day - 1). Negative results from a Sunday at the start of
 * the month wrap correctly via `Date` itself.
 */
function weekStartUtc(date: Date): Date {
  const ms = date.getTime();
  const day = date.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return new Date(ms - back * 86_400_000);
}

/**
 * Bucket `matches` into the requested period. Buckets are sorted
 * ascending by `bucketStart` and only contain entries with at least
 * one match (sparse).
 */
export function bucketRealizedPnl(
  matches: readonly PnlMatchForBucket[],
  bucket: PnlBucket,
): PnlBucketPoint[] {
  // Use a Map keyed by bucket-start so we don't need to pre-know the
  // time range. Insertion order is match-encounter order, which is
  // already ascending for FIFO matches; we sort once at the end.
  const acc = new Map<string, number>();

  for (const m of matches) {
    const ts = Date.parse(m.sellTimestamp);
    if (Number.isNaN(ts)) {
      // Skipped silently — FIFO emits well-formed ISO strings, but a
      // defensive parse keeps this function safe to call from anywhere.
      continue;
    }
    const date = new Date(ts);
    let key: string;
    if (bucket === 'day') {
      key = dayKeyUtc(date);
    } else if (bucket === 'week') {
      key = dayKeyUtc(weekStartUtc(date));
    } else {
      // month: YYYY-MM-01.
      const iso = date.toISOString();
      key = `${iso.slice(0, 7)}-01`;
    }
    acc.set(key, (acc.get(key) ?? 0) + m.realizedPnl);
  }

  const out: PnlBucketPoint[] = [];
  for (const [bucketStart, pnl] of acc) {
    out.push({ bucketStart, pnl });
  }
  out.sort((a, b) => (a.bucketStart < b.bucketStart ? -1 : a.bucketStart > b.bucketStart ? 1 : 0));
  return out;
}
