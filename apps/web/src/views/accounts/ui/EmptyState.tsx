/**
 * Empty-state placeholder for the Accounts list. Renders nothing if
 * `filter` is empty; otherwise shows a one-line nudge to use the
 * "Create" CTAs above.
 */
import type { FilterType } from './FilterTabs';

export function EmptyState({ filter }: { filter: FilterType }) {
  const label = filter === 'all' ? 'accounts' : `${filter} accounts`;
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
      <p className="text-sm">No {label} yet.</p>
      <p className="text-xs">Use one of the buttons above to create one.</p>
    </div>
  );
}
