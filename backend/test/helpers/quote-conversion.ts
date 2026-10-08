import { SEED_PRODUCT_101_ID } from './seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from './seed-commerce.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * The quote-to-order road, walked through the routes a buyer and an operator
 * use (`specs/143-crm-sales-opportunities/`, FR-100 … FR-104).
 *
 * Nothing here writes a row by hand. The tests that use it measure whether an
 * Order placed from an accepted Quote Request names that request, and every
 * fixture that set `orders.source_quote_request_id` directly — which is how
 * the gap stayed invisible — proved only what happens *after* something has
 * written it.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

/**
 * A Quote Request of the test Organization, priced by the operator and
 * accepted by the buyer: `Approved`, one line of the seeded product at
 * `agreedUnitPrice`.
 */
export async function acceptedQuoteRequest(
  h: BackendServerHandle,
  line: { quantity?: number; agreedUnitPrice?: number } = {},
  customer: Record<string, string> = CUSTOMER,
): Promise<{ id: string; quantity: number; agreedUnitPrice: number }> {
  const quantity = line.quantity ?? 7;
  const agreedUnitPrice = line.agreedUnitPrice ?? 11.25;
  const created = await h.app.inject({
    method: 'POST',
    url: '/api/v1/quote-requests',
    cookies: customer,
    payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity, desiredUnitPrice: 12 }] },
  });
  if (created.statusCode !== 201) throw new Error(`acceptedQuoteRequest (create): ${created.statusCode} ${created.body}`);
  const rfq = (created.json() as { data: { id: string; version: number } }).data;

  const priced = await h.app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/quote-requests/${rfq.id}`,
    cookies: ADMIN,
    headers: { 'if-match': `"${rfq.version}"` },
    payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity, agreedUnitPrice }] },
  });
  if (priced.statusCode !== 200) throw new Error(`acceptedQuoteRequest (price): ${priced.statusCode} ${priced.body}`);

  const detail = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${rfq.id}`, cookies: customer });
  const current = (detail.json() as { data: { currentRevisionNumber: number } }).data;
  const accepted = await h.app.inject({
    method: 'POST',
    url: `/api/v1/quote-requests/${rfq.id}/accept-revision`,
    cookies: customer,
    payload: { expectedRevisionNumber: current.currentRevisionNumber },
  });
  if (accepted.statusCode !== 200) throw new Error(`acceptedQuoteRequest (accept): ${accepted.statusCode} ${accepted.body}`);
  return { id: rfq.id, quantity, agreedUnitPrice };
}

/** `POST /quote-requests/:id/convert-to-order` — the buyer's "order this quote". */
export async function convertQuoteRequestToCart(h: BackendServerHandle, quoteRequestId: string): Promise<string> {
  const converted = await h.app.inject({
    method: 'POST',
    url: `/api/v1/quote-requests/${quoteRequestId}/convert-to-order`,
    cookies: CUSTOMER,
    payload: {},
  });
  if (converted.statusCode !== 200) throw new Error(`convertQuoteRequestToCart: ${converted.statusCode} ${converted.body}`);
  return (converted.json() as { data: { cartId: string } }).data.cartId;
}

/** `POST /api/v1/orders` from whatever the buyer's basket holds. */
export async function checkOutBasket(h: BackendServerHandle): Promise<{ id: string; total: string }> {
  const placed = await h.app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    cookies: CUSTOMER,
    payload: {
      deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
      billingAddressId: SEED_ADDRESS_BILLING_ID,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
    },
  });
  if (placed.statusCode !== 201) throw new Error(`checkOutBasket: ${placed.statusCode} ${placed.body}`);
  return (placed.json() as { data: { id: string; total: string } }).data;
}

/**
 * Run `act` and wait until every subscriber of the `order.created.v1` it
 * causes has returned. The bus awaits its handlers one after another, so a
 * handler registered here runs once the composed application's own have.
 */
export async function whenOrderCreatedSettled<T>(h: BackendServerHandle, act: () => Promise<T>): Promise<T> {
  let off: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    off = h.eventBus.on('order.created.v1' as never, () => resolve());
  });
  try {
    const result = await act();
    await settled;
    return result;
  } finally {
    off();
  }
}
