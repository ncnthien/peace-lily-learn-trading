import { z } from 'zod';
import {
  AccountStatus,
  AccountType,
} from '../enums/account.js';
import { Timeframe } from '../enums/timeframe.js';
import { TradeSide } from '../enums/trade.js';

// ============================================================
// Timeframes / enums — derived from the existing constants so the
// schema and the type never drift. We cast through `unknown` to keep
// Zod's inference narrow (literal types) instead of widening to `string`.
// ============================================================

export const TimeframeSchema = z.enum(
  Object.values(Timeframe) as unknown as readonly [Timeframe, ...Timeframe[]],
);

export const AccountTypeSchema = z.enum(
  Object.values(AccountType) as unknown as readonly [AccountType, ...AccountType[]],
);

export const AccountStatusSchema = z.enum(
  Object.values(AccountStatus) as unknown as readonly [AccountStatus, ...AccountStatus[]],
);

export const TradeSideSchema = z.enum(
  Object.values(TradeSide) as unknown as readonly [TradeSide, ...TradeSide[]],
);

// ============================================================
// Account domain (NCN-5 + NCN-8)
// ============================================================

export const AccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  type: AccountTypeSchema,
  balance: z.number().finite(),
  status: AccountStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateAccountDraftSchema = z.object({
  name: z.string().min(1).max(120),
  type: AccountTypeSchema,
  balance: z.number().finite().nonnegative().optional(),
});

export const UpdateAccountPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: AccountStatusSchema.optional(),
  })
  .strict();

export type Account = z.infer<typeof AccountSchema>;
export type CreateAccountDraft = z.infer<typeof CreateAccountDraftSchema>;
export type UpdateAccountPatch = z.infer<typeof UpdateAccountPatchSchema>;
