import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AdminUser, Order } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * Issue #1574 — `POST /api/v1/admin/orders/:id/payment-status` enforces the
 * money axis's transition graph (`PAYMENT_STATUS_TRANSITIONS` in the contracts).
 *
 * It used to assign `to` from any current state, so a refunded order could be
 * marked paid again, an unpaid one refunded, and a repeated `paid` on a
 * credit-limit order recorded a second credit release. Now an edge of the graph
 * answers 200 and writes one audit entry; the status the order already has
 * answers 200 and writes nothing; anything else answers 409
 * `ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED` and writes nothing either.
 *
 * The sentences are written out rather than read from the bundle: a test that
 * loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132).
 */

type PaymentStatus = 'awaiting_payment' | 'paid' | 'failed' | 'deferred' | 'refunded';
type Language = 'en' | 'pl';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const REFUNDED: Record<Language, string> = {
  en: 'The payment has been refunded, so its status can no longer be changed.',
  pl: 'Płatność została zwrócona, więc jej statusu nie można już zmienić.',
};
const NOT_PAID: Record<Language, string> = {
  en: 'Only a paid order can be marked as refunded.',
  pl: 'Tylko opłacone zamówienie można oznaczyć jako zwrócone.',
};

describe('admin payment-status transitions are enforced by the server (issue #1574)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  const admin = { b2b_session: 'stub-admin-session' };
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      if (created.length > 0) {
        const ids = `{${created.join(',')}}`;
        const connection = h.em().getConnection();
        await connection.execute(`delete from "order_transition_effects" where "order_id" = any(?::uuid[])`, [ids]);
        await connection.execute(`delete from "orders" where "id" = any(?::uuid[])`, [ids]);
      }
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const user = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    user.preferredLanguage = value;
    await em.flush();
  }

  async function sql<T>(statement: string, params: unknown[] = []): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  async function seedOrder(paymentStatus: PaymentStatus, kind: 'bank_transfer' | 'credit_limit' = 'bank_transfer'): Promise<string> {
    const em = h.em().fork();
    const address = {
      recipientName: 'Issue 1574',
      street: 'ul. Płatności 1',
      city: 'Warszawa',
      postalCode: '00-100',
      country: 'PL',
    };
    const order = em.create(Order, {
      id: randomUUID(),
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: '00000000-0000-4000-8000-0000000000c1',
      status: 'processing',
      paymentStatus,
      deliveryAddress: address,
      billingAddress: address,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      // The follow-up rule reads the snapshot's `kind` alone.
      paymentMethodSnapshot:
        kind === 'credit_limit'
          ? { code: 'credit_limit', name: 'CL', kind: 'credit_limit' }
          : { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '0.00',
      total: '123.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persist(order).flush();
    created.push(order.id);
    return order.id;
  }

  const change = (orderId: string, to: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payment-status`,
      payload: { to },
      cookies: admin,
    });

  async function paymentStatusOf(orderId: string): Promise<string> {
    const [row] = await sql<{ payment_status: string }>(`select "payment_status" from "orders" where "id" = ?`, [orderId]);
    return row!.payment_status;
  }

  async function auditEntries(orderId: string) {
    return h.auditLogService.query({ action: 'order.payment_status_transition', objectId: orderId });
  }

  async function effectRows(orderId: string): Promise<number> {
    const [row] = await sql<{ n: number }>(
      `select count(*)::int as "n" from "order_transition_effects" where "order_id" = ?`,
      [orderId],
    );
    return Number(row?.n ?? 0);
  }

  function refusal(response: { statusCode: number; body: string }): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(409);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe('ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED');
    return error;
  }

  // --- I1 — the four operator edges --------------------------------------------

  it.each([
    ['awaiting_payment', 'paid'],
    ['failed', 'paid'],
    ['deferred', 'paid'],
    ['paid', 'refunded'],
  ] as const)('I1 — %s -> %s answers 200, moves the column and writes one code-only audit entry', async (from, to) => {
    const orderId = await seedOrder(from);

    const res = await change(orderId, to);

    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { paymentStatus: string } }).data.paymentStatus).toBe(to);
    expect(await paymentStatusOf(orderId)).toBe(to);
    const entries = await auditEntries(orderId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.stateBefore).toEqual({ paymentStatus: from });
    expect(entries[0]?.stateAfter).toEqual({ paymentStatus: to });
  });

  // --- I2 / I3 — refusals write nothing ----------------------------------------

  it('I2 — refunded -> paid answers 409 payment_refunded and writes nothing', async () => {
    const orderId = await seedOrder('refunded', 'credit_limit');

    const error = refusal(await change(orderId, 'paid'));

    expect(error.details).toEqual({ code: 'payment_refunded', from: 'refunded', to: 'paid' });
    expect(await paymentStatusOf(orderId)).toBe('refunded');
    expect(await auditEntries(orderId)).toHaveLength(0);
    expect(await effectRows(orderId)).toBe(0);
  });

  it.each(['awaiting_payment', 'failed', 'deferred'] as const)(
    'I3 — %s -> refunded answers 409 payment_not_paid and writes nothing',
    async (from) => {
      const orderId = await seedOrder(from);

      const error = refusal(await change(orderId, 'refunded'));

      expect(error.details).toEqual({ code: 'payment_not_paid', from, to: 'refunded' });
      expect(await paymentStatusOf(orderId)).toBe(from);
      expect(await auditEntries(orderId)).toHaveLength(0);
    },
  );

  // --- I4 — the sentence is the operator's language ---------------------------

  describe.each(['en', 'pl'] as const)('I4 — for an operator working in %s', (language) => {
    beforeAll(async () => {
      await setAdminLanguage(language);
    });
    afterAll(async () => {
      await setAdminLanguage(languageBefore);
    });

    it('explains a refusal out of refunded', async () => {
      const res = await change(await seedOrder('refunded'), 'paid');
      const error = refusal(res);
      expect(error.message).toBe(REFUNDED[language]);
      expect(res.headers['content-language']).toBe(language);
    });

    it('explains a refund of an unpaid order', async () => {
      const res = await change(await seedOrder('awaiting_payment'), 'refunded');
      const error = refusal(res);
      expect(error.message).toBe(NOT_PAID[language]);
      expect(res.headers['content-language']).toBe(language);
    });
  });

  // --- I5 — the same status is a no-op -----------------------------------------

  it('I5 — paid -> paid on a credit-limit order answers 200 with no audit entry and no second credit release', async () => {
    const orderId = await seedOrder('deferred', 'credit_limit');
    expect((await change(orderId, 'paid')).statusCode).toBe(200);
    expect(await effectRows(orderId)).toBe(1);
    expect(await auditEntries(orderId)).toHaveLength(1);

    const again = await change(orderId, 'paid');

    expect(again.statusCode, again.body).toBe(200);
    expect((again.json() as { data: { paymentStatus: string } }).data.paymentStatus).toBe('paid');
    expect(await effectRows(orderId)).toBe(1);
    expect(await auditEntries(orderId)).toHaveLength(1);
  });

  // --- I7 — the schema still refuses what an operator can never set -----------

  // The design named 422; the route's body schema has always answered a value
  // outside `paid | refunded` with 400 `VALIDATION_FAILED`, and that is unchanged.
  it('I7 — to: failed is still refused by the body schema, before the graph', async () => {
    const orderId = await seedOrder('awaiting_payment');
    const res = await change(orderId, 'failed');
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(await paymentStatusOf(orderId)).toBe('awaiting_payment');
  });

  // --- I8 — off-state: the graph is orders', not payments' ---------------------

  it('I8 — with payments deactivated, awaiting_payment -> paid answers 200 and refunded -> paid 409', async () => {
    const unpaid = await seedOrder('awaiting_payment');
    const refunded = await seedOrder('refunded');

    await withModuleOff('payments', 'deactivated', async () => {
      expect((await change(unpaid, 'paid')).statusCode).toBe(200);
      refusal(await change(refunded, 'paid'));
    });

    expect(await paymentStatusOf(unpaid)).toBe('paid');
    expect(await paymentStatusOf(refunded)).toBe('refunded');
  });

  // --- I9 — the decision is taken on the locked row ---------------------------

  it('I9 — an order refunded between the pre-read and the lock is refused', async () => {
    const orderId = await seedOrder('awaiting_payment');

    const holder = h.em().fork();
    await holder.begin();
    let pending: ReturnType<typeof change> | undefined;
    try {
      await holder.execute(`select "id" from "orders" where "id" = ? for update`, [orderId]);
      pending = change(orderId, 'paid');
      const deadline = Date.now() + 10_000;
      for (;;) {
        const [row] = await sql<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock' and query ilike '%orders%'`,
        );
        if (Number(row?.n ?? 0) >= 1) break;
        if (Date.now() > deadline) throw new Error('the request never waited on the order row');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await holder.execute(`update "orders" set "payment_status" = 'refunded' where "id" = ?`, [orderId]);
      await holder.commit();
    } catch (error) {
      await holder.rollback().catch(() => undefined);
      throw error;
    }

    const error = refusal(await pending!);
    expect(error.details).toEqual({ code: 'payment_refunded', from: 'refunded', to: 'paid' });
    expect(await paymentStatusOf(orderId)).toBe('refunded');
    expect(await auditEntries(orderId)).toHaveLength(0);
  });
});
