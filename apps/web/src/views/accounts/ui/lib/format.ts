/**
 * Format helpers used inside the `accounts` view.
 *
 * Kept in a single `lib/` segment because they are tiny, page-local,
 * and shared by multiple sibling components (CreateForm / AccountRow).
 */

export function formatBalance(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
