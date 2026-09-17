import { Injectable } from '@nestjs/common';
import type {
  AutomationDirection,
  AutomationPhase,
  AutomationPhase as AutomationPhaseT,
  CompositeCondition,
  ConditionNode,
  ConditionSource,
  EvalContext,
  LeafCondition,
  NormalizedSignal,
} from '@workspace/shared';
import { indicatorKey } from '@workspace/shared';

/**
 * Rule engine — walks a ConditionNode tree and decides whether it holds
 * against an EvalContext. Single, generic evaluate() that handles every
 * shape: a bare leaf, an AND/OR composite, or a deeply nested mix.
 *
 * The same engine drives live automation and backtest. Backtest just
 * replays historical candles into providers → EvalContext, then calls
 * evaluate(). Live does the same with fresh ticks.
 *
 * See NCN-27 acceptance criteria:
 *  - One ConditionNode type with leaf + composite variants
 *  - Single generic evaluate() walks any tree
 *  - ≥5 leaf types implemented (rsi_above, rsi_below, wave_direction,
 *    wave_contained_in, wave_phase_not)
 *  - Same evaluator reused by live + backtest
 */

const SIGNAL_PHASES: ReadonlySet<AutomationPhaseT> = new Set<AutomationPhase>([
  'forming',
  'developing',
  'exhausting',
] as const);

const SIGNAL_DIRECTIONS: ReadonlySet<AutomationDirection> = new Set<AutomationDirection>([
  'up',
  'down',
] as const);

@Injectable()
export class ConditionEvaluator {
  /**
   * Walk the tree and throw on any malformed shape (unknown operator,
   * missing child, bad leaf variant). Used at the API layer to surface
   * 400 Bad Request instead of silently failing at evaluation time.
   *
   * Strictly speaking the evaluator fails closed on bad input — but the
   * API wants to reject bad input early so an editor / automation
   * composer gets immediate feedback rather than a tree that never fires.
   */
  assertShape(node: ConditionNode): void {
    if (node === null || typeof node !== 'object') {
      throw new Error('condition must be an object');
    }
    if (isComposite(node)) {
      if (node.operator !== 'and' && node.operator !== 'or') {
        throw new Error(`unknown composite operator: ${String((node as { operator?: unknown }).operator)}`);
      }
      if (!Array.isArray(node.children)) {
        throw new Error('composite.children must be an array');
      }
      for (const child of node.children) {
        this.assertShape(child);
      }
      return;
    }
    // Leaf — type-checked discriminator.
    this.assertLeafShape(node);
  }

  /**
   * Validate the leaf's variant fields. Throws with a useful message on
   * the first bad shape. Pure-shape check — does NOT touch EvalContext.
   */
  private assertLeafShape(leaf: LeafCondition | { type?: string; [k: string]: unknown }): void {
    const type = (leaf as { type?: unknown }).type;
    if (typeof type !== 'string') {
      throw new Error('leaf missing string `type` discriminator');
    }
    switch (type) {
      case 'rsi_above':
      case 'rsi_below': {
        const l = leaf as { threshold?: unknown; source?: unknown };
        if (typeof l.threshold !== 'number' || !Number.isFinite(l.threshold)) {
          throw new Error(`${type}: threshold must be a finite number`);
        }
        this.assertSource(l.source);
        return;
      }
      case 'wave_direction': {
        const l = leaf as { direction?: unknown; source?: unknown };
        if (l.direction !== 'up' && l.direction !== 'down') {
          throw new Error(`wave_direction: direction must be 'up' or 'down'`);
        }
        this.assertSource(l.source);
        return;
      }
      case 'wave_contained_in': {
        const l = leaf as { timeRange?: unknown; source?: unknown };
        if (
          !isPlainObject(l.timeRange) ||
          typeof (l.timeRange as { start?: unknown }).start !== 'number' ||
          typeof (l.timeRange as { end?: unknown }).end !== 'number'
        ) {
          throw new Error(`wave_contained_in: timeRange must be { start: number, end: number }`);
        }
        if (!isValidTimeRange(l.timeRange as { start: number; end: number })) {
          throw new Error(`wave_contained_in: timeRange end must be > start`);
        }
        this.assertSource(l.source);
        return;
      }
      case 'wave_phase_not': {
        const l = leaf as { phase?: unknown; source?: unknown };
        if (l.phase !== 'forming' && l.phase !== 'developing' && l.phase !== 'exhausting') {
          throw new Error(`wave_phase_not: phase must be one of forming|developing|exhausting`);
        }
        this.assertSource(l.source);
        return;
      }
      case 'legacy_pass':
        // Migration marker from NCN-12 — no field validation needed.
        return;
      default:
        throw new Error(`unknown leaf type: ${String(type)}`);
    }
  }

  private assertSource(source: unknown): void {
    if (!isPlainObject(source)) {
      throw new Error('source must be an object');
    }
    const providerKind = (source as { providerKind?: unknown }).providerKind;
    if (typeof providerKind !== 'string' || providerKind.length === 0) {
      throw new Error('source.providerKind must be a non-empty string');
    }
    // timeframe and symbol are optional; if present they must be strings.
    const timeframe = (source as { timeframe?: unknown }).timeframe;
    if (timeframe !== undefined && typeof timeframe !== 'string') {
      throw new Error('source.timeframe must be a string when present');
    }
    const symbol = (source as { symbol?: unknown }).symbol;
    if (symbol !== undefined && typeof symbol !== 'string') {
      throw new Error('source.symbol must be a string when present');
    }
  }

  /**
   * Evaluate the condition tree against the context. Returns `true` when
   * the rule holds (action should fire), `false` otherwise.
   *
   * Truthy shortcuts:
   *  - Empty AND (no children) → `false` (no condition ever held)
   *  - Empty OR  (no children) → `false` (no candidates ever)
   *
   * Unknown leaf types default to `false` (strict) — they fail closed so
   * a typo in a tree never accidentally fires an action. The legacy
   * `legacy_pass` marker used by the NCN-12 → NCN-27 migration is
   * recognised here so existing rows still trigger until a human
   * re-authors them.
   */
  evaluate(node: ConditionNode, ctx: EvalContext): boolean {
    if (isComposite(node)) {
      return this.evaluateComposite(node, ctx);
    }
    return this.evaluateLeaf(node, ctx);
  }

  private evaluateComposite(node: CompositeCondition, ctx: EvalContext): boolean {
    if (node.children.length === 0) return false;
    if (node.operator === 'and') {
      // Short-circuit on first failure.
      for (const child of node.children) {
        if (!this.evaluate(child, ctx)) return false;
      }
      return true;
    }
    // 'or'
    for (const child of node.children) {
      if (this.evaluate(child, ctx)) return true;
    }
    return false;
  }

  private evaluateLeaf(leaf: LeafCondition, ctx: EvalContext): boolean {
    // Migration marker from NCN-12: kept firing until re-authored.
    // Discriminated by `type === 'legacy_pass'` — strictly typed leaves
    // above never collide on this string.
    const anyLeaf = leaf as unknown as { type?: string };
    if (anyLeaf.type === 'legacy_pass') return true;

    switch (leaf.type) {
      case 'rsi_above':
        return this.evalRsiAbove(leaf, ctx);
      case 'rsi_below':
        return this.evalRsiBelow(leaf, ctx);
      case 'wave_direction':
        return this.evalWaveDirection(leaf, ctx);
      case 'wave_contained_in':
        return this.evalWaveContainedIn(leaf, ctx);
      case 'wave_phase_not':
        return this.evalWavePhaseNot(leaf, ctx);
      default: {
        // Exhaustiveness guard — adding a new LeafCondition variant without
        // a case here will fail to compile under `never`.
        const _exhaustive: never = leaf;
        void _exhaustive;
        return false;
      }
    }
  }

  // ----- leaf implementations -----

  private evalRsiAbove(
    leaf: Extract<LeafCondition, { type: 'rsi_above' }>,
    ctx: EvalContext,
  ): boolean {
    const value = this.rsiFor(leaf.source, ctx);
    return value !== null && value > leaf.threshold;
  }

  private evalRsiBelow(
    leaf: Extract<LeafCondition, { type: 'rsi_below' }>,
    ctx: EvalContext,
  ): boolean {
    const value = this.rsiFor(leaf.source, ctx);
    return value !== null && value < leaf.threshold;
  }

  private evalWaveDirection(
    leaf: Extract<LeafCondition, { type: 'wave_direction' }>,
    ctx: EvalContext,
  ): boolean {
    if (!SIGNAL_DIRECTIONS.has(leaf.direction)) return false;
    const match = this.findSignal(leaf.source, ctx.signals);
    return match !== undefined && match.direction === leaf.direction;
  }

  private evalWaveContainedIn(
    leaf: Extract<LeafCondition, { type: 'wave_contained_in' }>,
    ctx: EvalContext,
  ): boolean {
    if (!isValidTimeRange(leaf.timeRange)) return false;
    const match = this.findSignal(leaf.source, ctx.signals);
    if (match === undefined) return false;
    // signal.timeRange ⊆ leaf.timeRange  (inclusive start, exclusive end)
    return (
      match.timeRange.start >= leaf.timeRange.start &&
      match.timeRange.end <= leaf.timeRange.end
    );
  }

  private evalWavePhaseNot(
    leaf: Extract<LeafCondition, { type: 'wave_phase_not' }>,
    ctx: EvalContext,
  ): boolean {
    if (!SIGNAL_PHASES.has(leaf.phase)) return false;
    const match = this.findSignal(leaf.source, ctx.signals);
    if (match === undefined) return false;
    return match.phase !== leaf.phase;
  }

  // ----- lookups -----

  /** Resolve the RSI value for a ConditionSource from the EvalContext. */
  private rsiFor(source: ConditionSource, ctx: EvalContext): number | null {
    const indicators = ctx.indicators;
    if (indicators === undefined) return null;
    const value = indicators[indicatorKey(source)];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /**
   * Find the first signal matching the source coordinates. Matching is
   * exact on providerKind, optional timeframe, optional symbol — any
   * unspecified segment in the source is a wildcard.
   */
  private findSignal(
    source: ConditionSource,
    signals: NormalizedSignal[],
  ): NormalizedSignal | undefined {
    return signals.find(
      (s) =>
        s.source.providerKind === source.providerKind &&
        (source.timeframe === undefined || s.source.timeframe === source.timeframe) &&
        (source.symbol === undefined || s.source.symbol === source.symbol),
    );
  }
}

function isComposite(node: ConditionNode): node is CompositeCondition {
  return 'operator' in node && 'children' in node;
}

function isValidTimeRange(range: { start: number; end: number }): boolean {
  return (
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.end > range.start
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
