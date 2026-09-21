/**
 * Tiny error-normalization helper used by `<AutomationRow>` and
 * `<AutomationPage>`. Co-located with the slice because the existing
 * callers (Zod / axios error objects) get unwrapped into a string the
 * same way; not worth promoting to `shared/`.
 */

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
