import { describe, expectTypeOf, it } from 'vitest';
import type { OrderCustomerContext, OrderPlacementPort, PlaceOrderRequest, PlacedOrderRecord } from './orders.js';

/**
 * `OrderPlacementPort.placeOrder` as published. Issue #1308 added the optional
 * `languageTag` — the request's scope language the working basket is judged in —
 * beside the message `language`; the field is additive, so a caller written
 * before it compiles unchanged.
 */
describe('OrderPlacementPort.placeOrder', () => {
  it('takes the customer, the request and the optional placement options', () => {
    expectTypeOf<OrderPlacementPort['placeOrder']>().parameters.toEqualTypeOf<
      [
        OrderCustomerContext,
        PlaceOrderRequest,
        options?: {
          language?: string;
          /** Issue #1308 — the request's scope language the basket is judged in. */
          languageTag?: string;
          workingBasketId?: string;
        },
      ]
    >();
    expectTypeOf<OrderPlacementPort['placeOrder']>().returns.toEqualTypeOf<Promise<PlacedOrderRecord>>();
  });
});
