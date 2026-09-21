'use client';

import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';

/**
 * Buy / sell action form (NCN-18).
 *
 * The Zod schema (AutomationActionSchema) only knows two shapes: `buy`
 * and `sell`, both with `symbol` + `qty`. The UI exposes one of each
 * pair so the user can swap sides without losing the rest of the form.
 */

export type ActionKind = 'buy' | 'sell';
export interface ActionDraft {
  kind: ActionKind;
  symbol: string;
  qty: string;
}

interface ActionFieldsProps {
  value: ActionDraft;
  onChange: (next: ActionDraft) => void;
}

export function ActionFields({ value, onChange }: ActionFieldsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[140px,1fr,140px]">
      <div>
        <Label htmlFor="action-kind">Side</Label>
        <Select
          value={value.kind}
          onValueChange={(v: string | null) =>
            onChange({ ...value, kind: v === 'sell' ? 'sell' : 'buy' })
          }
        >
          <SelectTrigger id="action-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="buy">Buy</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="action-symbol">Symbol</Label>
        <Input
          id="action-symbol"
          type="text"
          value={value.symbol}
          onChange={(e) =>
            onChange({ ...value, symbol: e.target.value.toUpperCase() })
          }
          placeholder="BTCUSDT"
        />
      </div>
      <div>
        <Label htmlFor="action-qty">Quantity</Label>
        <Input
          id="action-qty"
          type="number"
          step="any"
          min="0"
          value={value.qty}
          onChange={(e) => onChange({ ...value, qty: e.target.value })}
          placeholder="0.001"
        />
      </div>
    </div>
  );
}

/** String → number coercion with empty-string guard. */
export function actionDraftToZod(value: ActionDraft): {
  kind: ActionKind;
  symbol: string;
  qty: number;
} | null {
  const symbol = value.symbol.trim();
  if (symbol.length === 0) return null;
  const qty = Number(value.qty);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return { kind: value.kind, symbol, qty };
}

/** Pre-fill helper for Edit mode. */
export function actionDraftFromUnknown(input: unknown): ActionDraft {
  if (typeof input !== 'object' || input === null) {
    return { kind: 'buy', symbol: 'BTCUSDT', qty: '0.001' };
  }
  const i = input as { kind?: unknown; symbol?: unknown; qty?: unknown };
  const kind: ActionKind = i.kind === 'sell' ? 'sell' : 'buy';
  const symbol = typeof i.symbol === 'string' ? i.symbol : 'BTCUSDT';
  const qty =
    typeof i.qty === 'number' && Number.isFinite(i.qty) ? String(i.qty) : '0.001';
  return { kind, symbol, qty };
}
