'use client';

import { useState } from 'react';
import type { AutomationItem, ConditionNode } from '@/entities/automation';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';

export interface AutomationRowProps {
  item: AutomationItem;
  onEdit: (item: AutomationItem) => void;
  onToggleStatus: (item: AutomationItem) => Promise<unknown>;
  onDelete: (item: AutomationItem) => Promise<unknown>;
  isUpdating: boolean;
  isDeleting: boolean;
}

// --- format helpers (page-local, only used by this row) -------------------

function isComposite(
  node: ConditionNode,
): node is { operator: 'and' | 'or'; children: ConditionNode[] } {
  return 'operator' in node && 'children' in node;
}

function statusVariant(
  status: 'enabled' | 'disabled' | 'paused',
): 'default' | 'secondary' | 'outline' {
  if (status === 'enabled') return 'default';
  if (status === 'paused') return 'outline';
  return 'secondary';
}

function statusClass(status: 'enabled' | 'disabled' | 'paused'): string {
  if (status === 'enabled') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  }
  return '';
}

function inputSummary(input: { kind: string; [k: string]: unknown }): string {
  if (input.kind === 'time') return `cron: ${String(input.cron ?? '?')}`;
  if (input.kind === 'rsiEmaWave') {
    return `${String(input.symbol ?? '?')} @ ${String(input.interval ?? '?')}`;
  }
  if (input.kind === 'supportResistance') {
    return `${String(input.symbol ?? '?')} @ ${String(input.interval ?? '?')} (minTouches ${String(input.minTouches ?? '?')})`;
  }
  return JSON.stringify(input);
}

function conditionSummary(node: ConditionNode): string {
  if (isComposite(node)) {
    return `${node.operator.toUpperCase()} of ${node.children.length} condition${node.children.length === 1 ? '' : 's'}`;
  }
  const leaf = node as { type?: string; [k: string]: unknown };
  switch (leaf.type) {
    case 'rsi_above':
      return `RSI > ${String(leaf.threshold)}`;
    case 'rsi_below':
      return `RSI < ${String(leaf.threshold)}`;
    case 'wave_direction':
      return `wave ${String(leaf.direction)}`;
    case 'wave_contained_in': {
      const r = leaf.timeRange as { start?: number; end?: number };
      return `wave in [${String(r.start ?? '?')}–${String(r.end ?? '?')}]`;
    }
    case 'wave_phase_not':
      return `wave ≠ ${String(leaf.phase)}`;
    case 'legacy_pass':
      return 'legacy (needs re-author)';
    default:
      return `unknown (${String(leaf.type ?? '?')})`;
  }
}

/**
 * Single automation rule row. Owns its own delete-confirmation dialog
 * state; the Edit / Enable toggle / Delete buttons delegate to the
 * callbacks provided by the page.
 */
export function AutomationRow({
  item,
  onEdit,
  onToggleStatus,
  onDelete,
  isUpdating,
  isDeleting,
}: AutomationRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isEnabled = item.status === 'enabled';

  return (
    <li className="grid items-start gap-3 py-4 md:grid-cols-[1fr,auto,auto,auto,auto]">
      <div className="min-w-0">
        <div className="truncate font-medium">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {inputSummary(item.input)}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          when{' '}
          <span className="font-mono text-foreground/80">
            {conditionSummary(item.condition)}
          </span>
        </div>
      </div>
      <Badge
        variant={statusVariant(item.status)}
        className={statusClass(item.status)}
      >
        {item.status}
      </Badge>
      <code className="text-xs text-muted-foreground">{item.input.kind}</code>
      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(item)}
          disabled={isUpdating || isDeleting}
        >
          Edit
        </Button>
        <Button
          variant={isEnabled ? 'outline' : 'secondary'}
          size="sm"
          onClick={() => void onToggleStatus(item)}
          disabled={isUpdating || isDeleting}
          aria-label={isEnabled ? 'Disable rule' : 'Enable rule'}
        >
          {isEnabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={isUpdating || isDeleting}
        >
          Delete
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule &ldquo;{item.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The rule will stop firing on the next
              runner tick.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete(item)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
