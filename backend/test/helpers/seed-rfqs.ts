import type { EntityManager } from '@mikro-orm/postgresql';
import { QuoteRequest } from '../../src/modules/quote_requests/entities/quote-request.entity.js';
import { QuoteRequestItem } from '../../src/modules/quote_requests/entities/quote-request-item.entity.js';
import {
  TEST_CUSTOMER_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from './test-actors.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from './seed-catalog.js';

/**
 * Fixed-UUID RFQ / item fixtures referenced by the quote_requests contract
 * tests. Each helper is idempotent against the currently-truncated DB — tests
 * call the one they need from beforeAll after setupBackendServer.
 */

export const RFQ_ADMIN_QUOTE_ID = '00000000-0000-4000-8000-000000002001';
export const RFQ_ACCEPT_EXPIRED_ID = '00000000-0000-4000-8000-000000002002';
export const RFQ_ITEM_CONCURRENT_EDIT_ID = '00000000-0000-4000-8000-000000002101';

/**
 * T050 fixture — RFQ in `new` status with two items. Admin tries to quote with
 * only one item in the body → should get 422 QUOTE_INCOMPLETE.
 */
export async function seedRfqForAdminQuote(em: EntityManager): Promise<QuoteRequest> {
  const rfq = em.create(QuoteRequest, {
    id: RFQ_ADMIN_QUOTE_ID,
    organizationId: TEST_ORGANIZATION_ID,
    customerAccountId: TEST_CUSTOMER_ID,
    status: 'new',
    submittedAt: new Date(),
  });
  // Flush the RFQ first so the FK constraint on quote_request_items is satisfied.
  // Items have no MikroORM relation mapping to RFQ (just a plain uuid column), so
  // the unit-of-work won't order the inserts automatically.
  await em.persistAndFlush(rfq);
  const itemA = em.create(QuoteRequestItem, {
    id: RFQ_ITEM_CONCURRENT_EDIT_ID,
    quoteRequestId: rfq.id,
    productId: SEED_PRODUCT_101_ID,
    productName: 'Example simple product',
    quantity: 3,
  });
  const itemB = em.create(QuoteRequestItem, {
    quoteRequestId: rfq.id,
    productId: SEED_PRODUCT_102_ID,
    productName: 'Example blue product',
    quantity: 5,
  });
  await em.persistAndFlush([itemA, itemB]);
  return rfq;
}

/**
 * T051 fixture — RFQ in `quoted` status with `expiresAt` already in the past.
 * Customer accept → should get 410 RFQ_EXPIRED.
 */
export async function seedRfqForAcceptExpired(em: EntityManager): Promise<QuoteRequest> {
  const rfq = em.create(QuoteRequest, {
    id: RFQ_ACCEPT_EXPIRED_ID,
    organizationId: TEST_ORGANIZATION_ID,
    customerAccountId: TEST_CUSTOMER_ID,
    status: 'quoted',
    submittedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000),
    quotedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1_000),
    expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1_000),
    quoteTerms: {
      leadTimeDays: 5,
      validityDays: 7,
      deliveryTerms: null,
      remarks: null,
    },
  });
  await em.persistAndFlush(rfq);
  const item = em.create(QuoteRequestItem, {
    quoteRequestId: rfq.id,
    productId: SEED_PRODUCT_101_ID,
    productName: 'Example simple product',
    quantity: 2,
    quotedUnitPrice: '19.99',
  });
  await em.persistAndFlush(item);
  return rfq;
}

/**
 * T052 fixture — draft RFQ for TEST_CUSTOMER with a single item whose id is
 * RFQ_ITEM_CONCURRENT_EDIT_ID. Two concurrent PATCHes race: exactly one wins.
 */
export async function seedRfqForConcurrentEdit(em: EntityManager): Promise<QuoteRequest> {
  const rfq = em.create(QuoteRequest, {
    organizationId: TEST_ORGANIZATION_ID,
    customerAccountId: TEST_CUSTOMER_ID,
    status: 'draft',
    version: 1,
  });
  await em.persistAndFlush(rfq);
  const item = em.create(QuoteRequestItem, {
    id: RFQ_ITEM_CONCURRENT_EDIT_ID,
    quoteRequestId: rfq.id,
    productId: SEED_PRODUCT_101_ID,
    productName: 'Example simple product',
    quantity: 3,
  });
  await em.persistAndFlush(item);
  return rfq;
}
