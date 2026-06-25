/**
 * OrderReturnContextPort — feature 046 (R4).
 *
 * The documented interface through which the returns module reads the order
 * facts it needs (paid-per-line amounts, the fulfilment-completing timestamp,
 * channel/customer/org) without importing the orders module's internals
 * (Constitution Principle I). The implementation lives in the orders module
 * (`orders/services/order-return-context.ts`) and is injected at composition.
 */

export interface OrderReturnContextLine {
  orderItemId: string;
  productId: string;
  name: string;
  purchasedQty: number;
  /** Amount paid per unit, including its proportional tax. */
  paidUnitAmount: number;
  /** Amount paid for the whole purchased line, including tax. */
  paidLineAmount: number;
}

export interface OrderReturnContext {
  salesChannelId: string;
  customerAccountId: string;
  organizationId: string | null;
  currency: string;
  /** When the order entered its fulfilment-completing status; null if it has not. */
  completingStatusEnteredAt: Date | null;
  lines: OrderReturnContextLine[];
}

export interface OrderReturnContextPort {
  getReturnContext(orderId: string): Promise<OrderReturnContext | null>;
}
