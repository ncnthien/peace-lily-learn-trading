// Order lifecycle status.

export const OrderStatus = {
  PENDING: 'pending',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
