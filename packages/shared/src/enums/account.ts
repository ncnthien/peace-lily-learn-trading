// Account shape enums — kept together because both relate to the
// Account domain and are referenced by the same Zod schemas in
// schemas/domain.ts.

export const AccountType = {
  REAL: 'real',
  DEMO: 'demo',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const AccountStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];
