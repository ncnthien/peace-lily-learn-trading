import { Injectable } from '@nestjs/common';
import type {
  ConfluencePredicate,
  ConfluenceRule,
  NormalizedSignal,
} from '@workspace/shared';

/**
 * Confluence layer — takes a list of normalized signals and a rule, and
 * returns true when the rule holds over the signals.
 *
 * A ConfluenceRule is just AND/OR over predicates. The predicates are
 * matched against the available signals (any predicate is satisfied if at
 * least one signal matches it). Same-degree predicates evaluate as a peer
 * comparison; different-degree predicates evaluate as a containment check.
 * The composer does not need to know which mode is intended — it just
 * counts satisfied predicates.
 *
 * Future work (weighted scoring, multi-asset correlation, etc.) is out of
 * scope per NCN-12.
 */
@Injectable()
export class ConfluenceEvaluator {
  evaluate(rule: ConfluenceRule, signals: NormalizedSignal[]): boolean {
    if (rule.predicates.length === 0) return false;
    const matched = rule.predicates.map((p) => this.matches(p, signals));
    return rule.operator === 'and'
      ? matched.every(Boolean)
      : matched.some(Boolean);
  }

  private matches(
    predicate: ConfluencePredicate,
    signals: NormalizedSignal[],
  ): boolean {
    return signals.some(
      (s) =>
        s.source.providerKind === predicate.providerKind &&
        (predicate.degree === undefined || s.degree === predicate.degree) &&
        (predicate.direction === undefined || s.direction === predicate.direction),
    );
  }
}
