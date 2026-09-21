/**
 * Market-domain types that don't already live in @workspace/shared —
 * mostly the records we draw onto the chart.
 */

export interface PositionBoxRecord {
  id: string;
  symbol: string;
  interval: string;
  side: 'long' | 'short';
  entryOpenTime: number;
  bars: number;
  entryPrice: number;
  stopPrice: number;
  tpPrice: number;
}

export interface SRLineRecord {
  id: string;
  symbol: string;
  interval: string;
  kind: 'support' | 'resistance';
  price: number;
}
