import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

/**
 * Issue #284 — the buyer's order list reads the transition history **once**.
 *
 * The cancellability capability is computed per order and the buyer's order
 * *list* renders a control per order, so "read the latest transition entry for
 * this order" inside that computation is an N+1 across the page. This
 * repository spent a day on exactly that class in the catalogue listing
 * (issue #263, MR !822), whose lesson is in the shape of this guard: the
 * batching helper takes an id list either way, so batching it proves nothing
 * about the page unless the page is what calls it — hence a route, and
 * statements rather than milliseconds.
 *
 * **And the claim is constancy, not a ceiling.** A ceiling that no page size
 * can trip is the defect issue #140 landed on. So the same route is measured at
 * two page sizes whose held-order counts differ by an order of magnitude, and
 * the assertion is that the two counts are *equal* — a loop would make the
 * second one ten times the first, and no threshold has to be guessed.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
/** The RFQ customer, so the page this file counts is not another file's. */
const BUYER = { cookies: { b2b_session: 'stub-customer-session-rfq' } };

/** Held orders on the small page and on the large one. A loop shows as 3 → 30. */
const SMALL_PAGE_HELD = 3;
const LARGE_PAGE_HELD = 30;

describe('the buyer order list resolves cancellability in a constant number of reads (#284)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h
      .em()
      .execute(`update "stock_levels" set "on_hand" = 10000 where "product_id" = ?`, [
        SEED_PRODUCT_101_ID,
      ]);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function bankTransferMethod(): Promise<PaymentMethod> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `cb_${randomUUID().slice(0, 8)}`,
      name: { default: 'Cancellability batching' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    await em.persistAndFlush(method);
    return method;
  }

  /** One order through the storefront route, left where placement leaves it. */
  async function place(method: PaymentMethod): Promise<string> {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      ...BUYER,
    });
    expect(add.statusCode).toBe(200);
    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: method.id,
      },
      ...BUYER,
    });
    expect(placed.statusCode).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  /**
   * Places an order and has the settlement ingress decline it, which is what
   * leaves it at the failure status **with** a transition entry — the only
   * shape whose cancellability the history read decides.
   */
  async function placeAndDecline(method: PaymentMethod): Promise<void> {
    const orderId = await place(method);
    const payment = await h.em().findOneOrFail(Payment, { orderId });
    const declined = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...ADMIN,
      payload: { paymentId: payment.id, outcome: 'failure', failureReason: 'card declined' },
    });
    expect(declined.statusCode).toBe(200);
  }

  /** The buyer's list, with every statement it issued while it ran. */
  async function listWithStatements(): Promise<{
    ordersOnPage: number;
    heldOnPage: number;
    auditReads: number;
  }> {
    const request = () =>
      h.app.inject({ method: 'GET', url: '/api/v1/orders', ...BUYER });
    // Warm every lazily-built singleton so the count is the page's own work.
    await request();

    const connection = h.em().getConnection() as unknown as {
      execute: (...args: unknown[]) => Promise<unknown>;
    };
    const original = connection.execute.bind(connection);
    const statements: string[] = [];
    connection.execute = (...args: unknown[]) => {
      const query = args[0];
      statements.push(
        typeof query === 'string'
          ? query
          : String((query as { toString(): string } | undefined)?.toString?.() ?? ''),
      );
      return original(...args);
    };

    let response;
    try {
      response = await request();
    } finally {
      connection.execute = original;
    }

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: Array<{ status: string; customerCancellable?: boolean }>;
    };
    return {
      ordersOnPage: body.data.length,
      heldOnPage: body.data.filter((o) => o.status === 'on_hold').length,
      auditReads: statements.filter((sql) => sql.includes('"audit_log_entries"')).length,
    };
  }

  /**
   * The ordinary page, and it runs first because it is only honest while this
   * buyer has nothing held: a page whose orders are all at the graph's initial
   * status costs **no** history read at all. That status settles the lifecycle
   * term outright, so asking who wrote it would be work whose answer changes
   * nothing.
   */
  it('reads no history at all for a page whose orders are all freshly placed', async () => {
    const method = await bankTransferMethod();
    for (let i = 0; i < SMALL_PAGE_HELD; i += 1) await place(method);

    const page = await listWithStatements();

    expect(page.ordersOnPage).toBeGreaterThanOrEqual(SMALL_PAGE_HELD);
    expect(page.heldOnPage).toBe(0);
    expect(page.auditReads).toBe(0);
  });

  it('reads the transition history once for the page, however many orders are held', async () => {
    const method = await bankTransferMethod();
    for (let i = 0; i < SMALL_PAGE_HELD; i += 1) await placeAndDecline(method);

    const small = await listWithStatements();
    // The guard is worthless if the page it counted had nothing to decide.
    expect(small.heldOnPage).toBeGreaterThanOrEqual(SMALL_PAGE_HELD);
    expect(small.auditReads).toBe(1);

    for (let i = SMALL_PAGE_HELD; i < LARGE_PAGE_HELD; i += 1) await placeAndDecline(method);

    const large = await listWithStatements();
    expect(large.heldOnPage).toBeGreaterThanOrEqual(LARGE_PAGE_HELD);
    // The claim, stated as an equality between two measured pages rather than
    // as a threshold: ten times the held orders, the same number of reads.
    expect(large.auditReads).toBe(small.auditReads);
    // Every one of them still got the answer, so the constancy is not the
    // constancy of a page that decided nothing.
    expect(large.heldOnPage).toBeGreaterThan(small.heldOnPage * 2);
  }, 5 * 60_000);
});
