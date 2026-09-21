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
 * Per-input-kind param form (NCN-18).
 *
 * The Zod schema declares three input kinds:
 *   - time: cron
 *   - supportResistance: symbol + interval + minTouches
 *   - rsiEmaWave: symbol + interval
 *
 * The kind itself is selected via the parent dialog's picker; this
 * component only renders the fields that depend on the chosen kind.
 *
 * Uses the shadcn-style Select (Base UI primitives) so the dropdowns
 * match the rest of the app's look.
 */

export type InputKind = 'time' | 'supportResistance' | 'rsiEmaWave';

export interface InputDraft {
  kind: InputKind;
  cron: string;
  symbol: string;
  interval: string;
  minTouches: string;
}

interface InputKindFieldsProps {
  value: InputDraft;
  onChange: (next: InputDraft) => void;
}

const INTERVAL_PRESETS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at 00:00', cron: '0 0 * * *' },
];

export function InputKindFields({ value, onChange }: InputKindFieldsProps) {
  switch (value.kind) {
    case 'time':
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="input-cron-preset">Quick fill</Label>
            <Select
              value=""
              onValueChange={(v: string | null) => {
                if (v === null || v === '') return;
                onChange({ ...value, cron: v });
              }}
            >
              <SelectTrigger id="input-cron-preset" className="w-full">
                <SelectValue placeholder="(pick a preset)" />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((p) => (
                  <SelectItem key={p.cron} value={p.cron}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="input-cron">Cron expression</Label>
            <Input
              id="input-cron"
              type="text"
              value={value.cron}
              onChange={(e) => onChange({ ...value, cron: e.target.value })}
              placeholder="* * * * *"
            />
          </div>
        </div>
      );
    case 'supportResistance':
      return (
        <div className="grid gap-3 md:grid-cols-[1fr,140px,140px]">
          <div>
            <Label htmlFor="input-sr-symbol">Symbol</Label>
            <Input
              id="input-sr-symbol"
              type="text"
              value={value.symbol}
              onChange={(e) =>
                onChange({ ...value, symbol: e.target.value.toUpperCase() })
              }
              placeholder="BTCUSDT"
            />
          </div>
          <div>
            <Label htmlFor="input-sr-interval">Interval</Label>
            <Input
              id="input-sr-interval"
              type="text"
              list="interval-presets"
              value={value.interval}
              onChange={(e) => onChange({ ...value, interval: e.target.value })}
              placeholder="1h"
            />
            <datalist id="interval-presets">
              {INTERVAL_PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="input-sr-min-touches">Min touches</Label>
            <Input
              id="input-sr-min-touches"
              type="number"
              min="1"
              step="1"
              value={value.minTouches}
              onChange={(e) => onChange({ ...value, minTouches: e.target.value })}
              placeholder="2"
            />
          </div>
        </div>
      );
    case 'rsiEmaWave':
      return (
        <div className="grid gap-3 md:grid-cols-[1fr,140px]">
          <div>
            <Label htmlFor="input-wave-symbol">Symbol</Label>
            <Input
              id="input-wave-symbol"
              type="text"
              value={value.symbol}
              onChange={(e) =>
                onChange({ ...value, symbol: e.target.value.toUpperCase() })
              }
              placeholder="BTCUSDT"
            />
          </div>
          <div>
            <Label htmlFor="input-wave-interval">Interval</Label>
            <Input
              id="input-wave-interval"
              type="text"
              list="interval-presets"
              value={value.interval}
              onChange={(e) => onChange({ ...value, interval: e.target.value })}
              placeholder="1h"
            />
          </div>
        </div>
      );
    default: {
      const exhaustive: never = value.kind;
      throw new Error(`unknown input kind: ${String(exhaustive)}`);
    }
  }
}

export function inputDraftFromUnknown(input: unknown): InputDraft {
  const fallback: InputDraft = {
    kind: 'time',
    cron: '0 * * * *',
    symbol: 'BTCUSDT',
    interval: '1h',
    minTouches: '2',
  };
  if (typeof input !== 'object' || input === null) return fallback;
  const i = input as { kind?: unknown; [k: string]: unknown };
  if (i.kind === 'time') {
    return {
      ...fallback,
      kind: 'time',
      cron: typeof i.cron === 'string' ? i.cron : fallback.cron,
    };
  }
  if (i.kind === 'supportResistance') {
    return {
      ...fallback,
      kind: 'supportResistance',
      symbol: typeof i.symbol === 'string' ? i.symbol : 'BTCUSDT',
      interval: typeof i.interval === 'string' ? i.interval : '1h',
      minTouches:
        typeof i.minTouches === 'number' ? String(i.minTouches) : '2',
    };
  }
  if (i.kind === 'rsiEmaWave') {
    return {
      ...fallback,
      kind: 'rsiEmaWave',
      symbol: typeof i.symbol === 'string' ? i.symbol : 'BTCUSDT',
      interval: typeof i.interval === 'string' ? i.interval : '1h',
    };
  }
  return fallback;
}

export function inputDraftToZod(
  value: InputDraft,
): { kind: InputKind } & Record<string, unknown> | null {
  switch (value.kind) {
    case 'time': {
      const cron = value.cron.trim();
      if (cron.length === 0) return null;
      return { kind: 'time', cron };
    }
    case 'supportResistance': {
      const symbol = value.symbol.trim();
      const interval = value.interval.trim();
      const minTouches = Number(value.minTouches);
      if (symbol.length === 0 || interval.length === 0) return null;
      if (!Number.isInteger(minTouches) || minTouches <= 0) return null;
      return { kind: 'supportResistance', symbol, interval, minTouches };
    }
    case 'rsiEmaWave': {
      const symbol = value.symbol.trim();
      const interval = value.interval.trim();
      if (symbol.length === 0 || interval.length === 0) return null;
      return { kind: 'rsiEmaWave', symbol, interval };
    }
    default: {
      const exhaustive: never = value.kind;
      throw new Error(`unknown input kind: ${String(exhaustive)}`);
    }
  }
}

/** Maps the dialog's `kind` discriminator to the providerKind the
 *  condition source needs to match. They share the same vocabulary
 *  today but the distinction is useful to keep client and server
 *  decoupled. */
export function providerKindFor(inputKind: InputKind): string {
  if (inputKind === 'supportResistance') return 'supportResistance';
  if (inputKind === 'rsiEmaWave') return 'rsiEmaWave';
  return 'time';
}
