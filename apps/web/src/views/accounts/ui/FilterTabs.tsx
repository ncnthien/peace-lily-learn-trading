'use client';

/**
 * Account-list filter tabs (All / Demo / Real). Internal to the
 * `accounts` view — not exported via the slice's public API.
 */

export type FilterType = 'all' | 'real' | 'demo';

const TABS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'demo', label: 'Demo' },
  { key: 'real', label: 'Real' },
];

export function FilterTabs({
  value,
  onChange,
}: {
  value: FilterType;
  onChange: (v: FilterType) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
            value === t.key
              ? 'bg-background text-foreground ring-1 ring-foreground/10'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
