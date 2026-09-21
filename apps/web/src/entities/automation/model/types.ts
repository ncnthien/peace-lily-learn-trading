/**
 * Automation item domain types — kept in sync with the
 * `Automation*Schema` family in @workspace/shared.
 */

export interface AutomationInput {
  kind: string;
  [key: string]: unknown;
}

export type ConditionSource = {
  providerKind: string;
  timeframe?: string;
  symbol?: string;
};

export type LeafCondition =
  | { type: 'rsi_above'; threshold: number; source: ConditionSource }
  | { type: 'rsi_below'; threshold: number; source: ConditionSource }
  | { type: 'wave_direction'; direction: 'up' | 'down'; source: ConditionSource }
  | {
      type: 'wave_contained_in';
      timeRange: { start: number; end: number };
      source: ConditionSource;
    }
  | {
      type: 'wave_phase_not';
      phase: 'forming' | 'developing' | 'exhausting';
      source: ConditionSource;
    }
  | { type: string; [key: string]: unknown };

export type ConditionNode =
  | LeafCondition
  | { operator: 'and' | 'or'; children: ConditionNode[] };

export interface AutomationItem {
  id: string;
  accountId: string;
  name: string;
  input: AutomationInput;
  condition: ConditionNode;
  action: unknown;
  output: unknown;
  status: 'enabled' | 'disabled' | 'paused';
  createdAt: string;
  updatedAt: string;
}
