import { z } from 'zod';
import { OrderStatus } from '../enums/order.js';
import { TradeSideSchema } from './domain.js';

// ============================================================
// Order / Execution (NCN-7)
// ============================================================

export const OrderStatusSchema = z.enum(
  Object.values(OrderStatus) as unknown as readonly [OrderStatus, ...OrderStatus[]],
);

export const OrderSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  symbol: z.string().min(1),
  side: TradeSideSchema,
  qty: z.number().finite().positive(),
  status: OrderStatusSchema,
  filledPrice: z.number().finite().nonnegative().optional(),
  filledAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  /**
   * Set when this order was placed on behalf of an AutomationItem.
   * Used by TradeHistoryService to attribute fills in the Trade ledger.
   */
  automationItemId: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PlaceOrderInputSchema = z.object({
  accountId: z.string().min(1),
  symbol: z.string().min(1),
  side: TradeSideSchema,
  qty: z.number().finite().positive(),
  /**
   * When set, the resulting Order carries this id through to the Trade
   * ledger so the fill can be attributed back to the automation rule
   * that triggered it. Manual orders (post-NCN-16 manual endpoint)
   * will leave this undefined.
   */
  automationItemId: z.string().min(1).optional(),
}).strict();

export const OrderEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('placed'), order: OrderSchema }),
  z.object({ kind: z.literal('filled'), order: OrderSchema }),
  z.object({ kind: z.literal('cancelled'), order: OrderSchema }),
  z.object({ kind: z.literal('rejected'), order: OrderSchema }),
]);

export type Order = z.infer<typeof OrderSchema>;
export type PlaceOrderInput = z.infer<typeof PlaceOrderInputSchema>;
export type OrderEvent = z.infer<typeof OrderEventSchema>;
