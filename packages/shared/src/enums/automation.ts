// AutomationItem status enum + the runtime array derived from it
// (used by Zod schemas and any UI that needs to iterate the values).

export const AutomationItemStatus = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  PAUSED: 'paused',
} as const;
export type AutomationItemStatus =
  (typeof AutomationItemStatus)[keyof typeof AutomationItemStatus];

/** Runtime array of allowed status values; useful for validation. */
export const AUTOMATION_STATUSES = Object.values(AutomationItemStatus);
