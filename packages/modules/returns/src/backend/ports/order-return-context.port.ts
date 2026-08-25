/**
 * OrderReturnContextPort — feature 046 (R4).
 *
 * The documented interface through which the returns module reads the order
 * facts it needs (paid-per-line amounts, the fulfilment-completing timestamp,
 * channel/customer/org) without importing the orders module's internals
 * (Constitution Principle I). The implementation lives in the orders module
 * (`orders/services/order-return-context.ts`) and is injected at composition.
 *
 * All three declarations moved to `@endora-commerce/contracts` in feature 075's Phase P,
 * keeping their direction: `returns` still states the shape and `orders` still
 * satisfies it. Re-exported here for the length of Phase P, which cuts no
 * consumer.
 */
export type {
  OrderReturnContextLine,
  OrderReturnContext,
  OrderReturnContextPort,
} from '@endora-commerce/contracts';
