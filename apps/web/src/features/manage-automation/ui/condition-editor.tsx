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
 * Single-leaf condition editor (NCN-18).
 *
 * The Zod schema (LeafConditionSchema + ConditionNodeSchema) supports a
 * recursive AND/OR tree of leaves, but v1 of the builder exposes one
 * leaf at a time. The automation engine handles `operator` composites
 * already, and users can compose multiple single-leaf rules to express
 * the same logic. A full tree composer is a future iteration.
 */

export type LeafType =
  | 'legacy_pass'
  | 'rsi_above'
  | 'rsi_below'
  | 'wave_direction'
  | 'wave_contained_in'
  | 'wave_phase_not';

export type WavePhase = 'forming' | 'developing' | 'exhausting';
export type WaveDirection = 'up' | 'down';

export interface LeafDraft {
  type: LeafType;
  threshold: string;
  phase: WavePhase;
  direction: WaveDirection;
  timeStart: string;
  timeEnd: string;
}

interface ConditionEditorProps {
  value: LeafDraft;
  onChange: (next: LeafDraft) => void;
  /** Locked to the providerKind of the input (no override). */
  providerKind: string;
  defaultSymbol?: string;
  defaultTimeframe?: string;
}

const PHASE_OPTIONS: WavePhase[] = ['forming', 'developing', 'exhausting'];
const DIRECTION_OPTIONS: WaveDirection[] = ['up', 'down'];

export function ConditionEditor({
  value,
  onChange,
  providerKind,
  defaultSymbol,
  defaultTimeframe,
}: ConditionEditorProps) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="cond-type">Condition type</Label>
          <Select
            value={value.type}
            onValueChange={(v: string | null) =>
              onChange({
                ...value,
                type: (v as LeafType) ?? 'legacy_pass',
              })
            }
          >
            <SelectTrigger id="cond-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="legacy_pass">Always fires (legacy_pass)</SelectItem>
              <SelectItem value="rsi_above">RSI above threshold</SelectItem>
              <SelectItem value="rsi_below">RSI below threshold</SelectItem>
              <SelectItem value="wave_direction">Wave direction matches</SelectItem>
              <SelectItem value="wave_contained_in">
                Wave contained in time range
              </SelectItem>
              <SelectItem value="wave_phase_not">Wave phase is not…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.type === 'rsi_above' || value.type === 'rsi_below' ? (
          <div>
            <Label htmlFor="cond-threshold">RSI threshold</Label>
            <Input
              id="cond-threshold"
              type="number"
              step="any"
              value={value.threshold}
              onChange={(e) => onChange({ ...value, threshold: e.target.value })}
              placeholder="70"
            />
          </div>
        ) : null}
        {value.type === 'wave_direction' ? (
          <div>
            <Label htmlFor="cond-direction">Direction</Label>
            <Select
              value={value.direction}
              onValueChange={(v: string | null) =>
                onChange({
                  ...value,
                  direction: (v as WaveDirection) ?? 'up',
                })
              }
            >
              <SelectTrigger id="cond-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIRECTION_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {value.type === 'wave_contained_in' ? (
          <>
            <div>
              <Label htmlFor="cond-time-start">Start (epoch ms)</Label>
              <Input
                id="cond-time-start"
                type="number"
                step="1"
                value={value.timeStart}
                onChange={(e) => onChange({ ...value, timeStart: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="cond-time-end">End (epoch ms)</Label>
              <Input
                id="cond-time-end"
                type="number"
                step="1"
                value={value.timeEnd}
                onChange={(e) => onChange({ ...value, timeEnd: e.target.value })}
                placeholder="0"
              />
            </div>
          </>
        ) : null}
        {value.type === 'wave_phase_not' ? (
          <div>
            <Label htmlFor="cond-phase">Phase (not)</Label>
            <Select
              value={value.phase}
              onValueChange={(v: string | null) =>
                onChange({
                  ...value,
                  phase: (v as WavePhase) ?? 'developing',
                })
              }
            >
              <SelectTrigger id="cond-phase" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHASE_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr,1fr,1fr]">
        <div>
          <Label htmlFor="cond-source-kind">Source: providerKind</Label>
          <Input
            id="cond-source-kind"
            type="text"
            value={providerKind}
            disabled
            className="opacity-70"
            aria-readonly
          />
        </div>
        <div>
          <Label>Source symbol</Label>
          <Input
            type="text"
            value={defaultSymbol ?? ''}
            disabled
            className="opacity-70"
            aria-readonly
            placeholder="(matches input)"
          />
        </div>
        <div>
          <Label>Source timeframe</Label>
          <Input
            type="text"
            value={defaultTimeframe ?? ''}
            disabled
            className="opacity-70"
            aria-readonly
            placeholder="(matches input)"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Build the Zod-shaped condition node from the draft. Throws if a
 * required field is missing — the caller should have validated first.
 *
 * The source's symbol + timeframe are derived from the parent input
 * draft (no user override). The source's providerKind is locked to
 * the input kind's provider kind.
 */
export function leafDraftToZod(
  value: LeafDraft,
  source: { providerKind: string; symbol?: string; timeframe?: string },
): { type: LeafType } & Record<string, unknown> {
  const baseSource: { providerKind: string; timeframe?: string; symbol?: string } = {
    providerKind: source.providerKind,
  };
  if (source.symbol !== undefined && source.symbol.length > 0) {
    baseSource.symbol = source.symbol;
  }
  if (source.timeframe !== undefined && source.timeframe.length > 0) {
    baseSource.timeframe = source.timeframe;
  }

  switch (value.type) {
    case 'legacy_pass':
      return { type: 'legacy_pass', source: baseSource };
    case 'rsi_above': {
      const threshold = Number(value.threshold);
      if (!Number.isFinite(threshold)) throw new Error('RSI threshold must be a finite number');
      return { type: 'rsi_above', threshold, source: baseSource };
    }
    case 'rsi_below': {
      const threshold = Number(value.threshold);
      if (!Number.isFinite(threshold)) throw new Error('RSI threshold must be a finite number');
      return { type: 'rsi_below', threshold, source: baseSource };
    }
    case 'wave_direction':
      return { type: 'wave_direction', direction: value.direction, source: baseSource };
    case 'wave_contained_in': {
      const start = Number(value.timeStart);
      const end = Number(value.timeEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error('wave_contained_in: start and end must be finite numbers');
      }
      return {
        type: 'wave_contained_in',
        timeRange: { start, end },
        source: baseSource,
      };
    }
    case 'wave_phase_not':
      return { type: 'wave_phase_not', phase: value.phase, source: baseSource };
    default: {
      // Exhaustiveness: LeafType is a closed union.
      const exhaustive: never = value.type;
      throw new Error(`unknown leaf type: ${String(exhaustive)}`);
    }
  }
}

export function leafDraftFromUnknown(
  input: unknown,
  // Source params (providerKind/symbol/timeframe) are now derived from the
  // parent input draft at render time, not stored on the leaf draft. The
  // signature used to take them; kept zero-arg-compatible for legacy
  // callers but the params are dropped.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ..._legacyArgs: unknown[]
): LeafDraft {
  const fallback: LeafDraft = {
    type: 'legacy_pass',
    threshold: '',
    phase: 'developing',
    direction: 'up',
    timeStart: '',
    timeEnd: '',
  };
  if (typeof input !== 'object' || input === null) return fallback;
  const node = input as { type?: unknown; [k: string]: unknown };
  const type = (['legacy_pass', 'rsi_above', 'rsi_below', 'wave_direction', 'wave_contained_in', 'wave_phase_not'] as const)
    .find((t) => t === node.type);
  if (type === undefined) return fallback;
  const out: LeafDraft = { ...fallback, type };
  if (type === 'rsi_above' || type === 'rsi_below') {
    out.threshold = String((node as { threshold?: unknown }).threshold ?? '');
  }
  if (type === 'wave_direction') {
    const d = (node as { direction?: unknown }).direction;
    out.direction = d === 'down' ? 'down' : 'up';
  }
  if (type === 'wave_phase_not') {
    const p = (node as { phase?: unknown }).phase;
    out.phase =
      p === 'forming' || p === 'developing' || p === 'exhausting' ? p : 'developing';
  }
  if (type === 'wave_contained_in') {
    const range = (node as { timeRange?: { start?: unknown; end?: unknown } }).timeRange;
    out.timeStart = String(range?.start ?? '');
    out.timeEnd = String(range?.end ?? '');
  }
  return out;
}
