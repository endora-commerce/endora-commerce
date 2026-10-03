import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CreditLimit, PaymentMethod } from '../../helpers/package-entities.js';
import { OrderTransitionVetoError } from '../../../../packages/modules/orders/dist/backend/events/order-status-events.js';

/**
 * `specs/142-order-transition-atomicity/` — the seven states a failed or refused
 * follow-up used to leave behind (spec, *What a failure leaves behind today*),
 * each asserted as the behaviour the feature promises instead (SC-001):
 *
 *  - no status without a record of what the status owes,
 *  - the caller told the truth — a committed transition is answered as applied,
 *  - the release completed with **no second request** once the cause is gone.
 *
 * Every order is placed through the storefront route rather than assembled with
 * `em.create`: the stock allocation and the credit reservation are what these
 * cases are about, and only placement creates them.
 *
 * Failures are injected at the two owners' published registrations, as the
 * composition resolves them — never by editing a module. A switched-off module
 * is the real seam (`withModuleOff`, operator axis).
 *
 * Row 5 (*the process dies after the commit*) cannot be executed in-process, so
 * it is represented by its observable equivalent: every step after the commit
 * fails, and recovery is driven by the sweep alone, which is what a restarted
 * process runs.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

/** Far enough ahead that every back-off has elapsed. */
const afterEveryBackOff = (): Date => new Date(Date.now() + 2 * 60 * 60 * 1000);

interface EffectRow {
  effect: string;
  reason: string;
  blocked_on: string | null;
  attempts: number;
  completed: boolean;
}

describe('an order transition and its follow-up work cannot come apart (spec 142, SC-001)', () => {
  let h: BackendServerHandle;
  let creditMethodId: string;
  let plainMethodId: string;
  const announced = new Set<string>();
  let stopListening: (() => void) | undefined;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await em.execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
      SEED_PRODUCT_101_ID,
    ]);

    const credit = em.create(PaymentMethod, {
      code: `cl_${randomUUID().slice(0, 8)}`,
      name: { default: 'Credit limit' },
      kind: 'credit_limit',
      adapter: 'credit_limit',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    const plain = em.create(PaymentMethod, {
      code: `bt_${randomUUID().slice(0, 8)}`,
      name: { default: 'Bank transfer' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    em.create(CreditLimit, {
      organizationId: TEST_ORGANIZATION_ID,
      grantedAmount: '1000000.00',
      currency: 'PLN',
    });
    await em.flush();
    creditMethodId = credit.id;
    plainMethodId = plain.id;

    stopListening = h.eventBus.on('order.status_changed.v1', (payload) => {
      announced.add((payload as unknown as { orderId: string }).orderId);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    stopListening?.();
    await teardownBackendServer(h);
  });

  // --- fixtures --------------------------------------------------------------

  async function place(kind: 'credit' | 'plain'): Promise<string> {
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
        paymentMethodId: kind === 'credit' ? creditMethodId : plainMethodId,
      },
      ...BUYER,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const orderId = (placed.json() as { data: { id: string } }).data.id;
    // The fixture is the precondition of every case: an order that holds
    // nothing would make "released" true by accident.
    expect(await heldAllocations(orderId)).toBe(1);
    if (kind === 'credit') expect(await reservation(orderId)).toBe('active');
    return orderId;
  }

  const rows = async <T>(sql: string, params: unknown[]): Promise<T[]> =>
    (await h.em().getConnection().execute(sql, params)) as T[];

  async function heldAllocations(orderId: string): Promise<number> {
    const [row] = await rows<{ count: number }>(
      `select count(*)::int as "count"
         from "stock_allocations" a
         join "order_items" oi on oi."id" = a."order_item_id"
        where oi."order_id" = ? and a."released_at" is null`,
      [orderId],
    );
    return row!.count;
  }

  async function reservation(orderId: string): Promise<string | null> {
    const [row] = await rows<{ status: string }>(
      `select "status" from "credit_limit_reservations" where "order_id" = ?`,
      [orderId],
    );
    return row?.status ?? null;
  }

  async function orderRow(orderId: string): Promise<{ status: string; payment_status: string }> {
    const [row] = await rows<{ status: string; payment_status: string }>(
      `select "status", "payment_status" from "orders" where "id" = ?`,
      [orderId],
    );
    return row!;
  }

  async function effects(orderId: string): Promise<EffectRow[]> {
    return rows<EffectRow>(
      `select "effect", "reason", "blocked_on", "attempts",
              ("completed_at" is not null) as "completed"
         from "order_transition_effects"
        where "order_id" = ?
        order by "effect", "created_at"`,
      [orderId],
    );
  }

  /** Everything a caller and an operator can observe about one cancellation. */
  async function observed(orderId: string, statusCode: number) {
    // The bus runs its subscribers one after another and this file's listener
    // is the last one registered, so the announcement reaches it only after
    // every module's own handler for it has settled. Waited for, bounded: an
    // announcement that never comes is reported as `false` rather than as a
    // timeout.
    const deadline = Date.now() + 3_000;
    while (!announced.has(orderId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      http: statusCode,
      status: (await orderRow(orderId)).status,
      heldAllocations: await heldAllocations(orderId),
      reservation: await reservation(orderId),
      announced: announced.has(orderId),
    };
  }

  const cancel = (orderId: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      ...ADMIN,
    });

  /** One pass of the background consumer, as a restarted process would run it. */
  const sweep = (): Promise<unknown> =>
    withSystemScope('spec 142 test — one sweep pass', () =>
      (
        h.container.resolve('orderTransitionEffectService') as {
          sweep(now: Date): Promise<unknown>;
        }
      ).sweep(afterEveryBackOff()),
    );

  const failing = (registration: string, method: string, times = 1) => {
    const target = h.container.resolve(registration) as Record<string, unknown>;
    const spy = vi.spyOn(target as never, method as never) as unknown as {
      mockRejectedValueOnce(error: Error): unknown;
    };
    for (let i = 0; i < times; i += 1) {
      spy.mockRejectedValueOnce(new Error(`injected failure in ${registration}.${method}`));
    }
  };

  // --- the seven rows ---------------------------------------------------------

  it('row 1 — cancelling a credit order while `credit_limits` is off cancels it, releases the stock, and releases the credit when the module returns', async () => {
    const orderId = await place('credit');

    await withModuleOff('credit_limits', 'deactivated', async () => {
      const res = await cancel(orderId);
      expect(await observed(orderId, res.statusCode)).toEqual({
        http: 200,
        status: 'cancelled',
        heldAllocations: 0,
        reservation: 'active',
        announced: true,
      });
      expect(await effects(orderId)).toEqual([
        { effect: 'credit.release', reason: 'order_cancelled', blocked_on: 'credit_limits', attempts: 0, completed: false },
        { effect: 'stock.release', reason: 'order_cancelled', blocked_on: null, attempts: 0, completed: true },
      ]);
      // A repeat is answered as "already there", and that answer is true: the
      // release is recorded and will run.
      expect((await cancel(orderId)).statusCode).toBe(200);
      // Nothing runs for an owner that is still off.
      await sweep();
      expect(await reservation(orderId)).toBe('active');
    });

    await sweep();
    expect(await reservation(orderId)).toBe('released');
    expect((await effects(orderId)).every((e) => e.completed)).toBe(true);
  });

  it('row 2 — a credit release that fails leaves the order cancelled, the stock released, the caller answered 200, and is retried', async () => {
    const orderId = await place('credit');
    failing('creditLimitService', 'releaseByOrder');

    const res = await cancel(orderId);
    expect(await observed(orderId, res.statusCode)).toEqual({
      http: 200,
      status: 'cancelled',
      heldAllocations: 0,
      reservation: 'active',
      announced: true,
    });
    expect(await effects(orderId)).toEqual([
      { effect: 'credit.release', reason: 'order_cancelled', blocked_on: null, attempts: 1, completed: false },
      { effect: 'stock.release', reason: 'order_cancelled', blocked_on: null, attempts: 0, completed: true },
    ]);

    await sweep();
    expect(await reservation(orderId)).toBe('released');
  });

  it('row 3 — cancelling while `inventory` is off writes no stock row, records the release, and releases when the module returns', async () => {
    const orderId = await place('plain');

    await withModuleOff('inventory', 'deactivated', async () => {
      const res = await cancel(orderId);
      expect(await observed(orderId, res.statusCode)).toEqual({
        http: 200,
        status: 'cancelled',
        heldAllocations: 1,
        reservation: null,
        announced: true,
      });
      expect(await effects(orderId)).toEqual([
        { effect: 'stock.release', reason: 'order_cancelled', blocked_on: 'inventory', attempts: 0, completed: false },
      ]);
      await sweep();
      expect(await heldAllocations(orderId)).toBe(1);
    });

    await sweep();
    expect(await heldAllocations(orderId)).toBe(0);
    expect((await effects(orderId)).every((e) => e.completed)).toBe(true);
  });

  it('row 4 — a stock release that fails leaves the order cancelled, the credit released, the caller answered 200, and is retried', async () => {
    const orderId = await place('credit');
    failing('inventoryReservationApplyPort', 'releaseForOrderItems');

    const res = await cancel(orderId);
    expect(await observed(orderId, res.statusCode)).toEqual({
      http: 200,
      status: 'cancelled',
      heldAllocations: 1,
      reservation: 'released',
      announced: true,
    });
    expect(await effects(orderId)).toEqual([
      { effect: 'credit.release', reason: 'order_cancelled', blocked_on: null, attempts: 0, completed: true },
      { effect: 'stock.release', reason: 'order_cancelled', blocked_on: null, attempts: 1, completed: false },
    ]);

    await sweep();
    expect(await heldAllocations(orderId)).toBe(0);
  });

  it('row 5 — when nothing after the commit ran, both releases happen without a new request', async () => {
    const orderId = await place('credit');
    failing('creditLimitService', 'releaseByOrder');
    failing('inventoryReservationApplyPort', 'releaseForOrderItems');

    await cancel(orderId);
    // The state a process that died after the commit leaves: the status, and
    // beside it the record of everything the status owes.
    expect((await orderRow(orderId)).status).toBe('cancelled');
    expect(await heldAllocations(orderId)).toBe(1);
    expect(await reservation(orderId)).toBe('active');
    expect((await effects(orderId)).map((e) => [e.effect, e.completed])).toEqual([
      ['credit.release', false],
      ['stock.release', false],
    ]);

    await sweep();
    expect(await heldAllocations(orderId)).toBe(0);
    expect(await reservation(orderId)).toBe('released');
  });

  it('row 6 — the bulk route reports an order whose status moved as changed, never as skipped', async () => {
    const failed = await place('credit');
    const whileOff = await place('credit');
    failing('creditLimitService', 'releaseByOrder');

    const bulk = (orderIds: string[]) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders/bulk/status',
        payload: { orderIds, toStatusCode: 'cancelled' },
        ...ADMIN,
      });

    const first = await bulk([failed]);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: unknown }).data).toEqual({ changed: [failed], skipped: [] });
    expect((await orderRow(failed)).status).toBe('cancelled');

    await withModuleOff('credit_limits', 'deactivated', async () => {
      const second = await bulk([whileOff]);
      expect(second.statusCode).toBe(200);
      expect((second.json() as { data: unknown }).data).toEqual({ changed: [whileOff], skipped: [] });
    });
    expect((await orderRow(whileOff)).status).toBe('cancelled');

    await sweep();
    expect(await reservation(failed)).toBe('released');
    expect(await reservation(whileOff)).toBe('released');
  });

  it('row 7 — marking a credit order paid while `credit_limits` is off marks it paid and releases the credit when the module returns', async () => {
    const orderId = await place('credit');

    await withModuleOff('credit_limits', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/payment-status`,
        payload: { to: 'paid' },
        ...ADMIN,
      });
      expect({
        http: res.statusCode,
        paymentStatus: (await orderRow(orderId)).payment_status,
        reservation: await reservation(orderId),
      }).toEqual({ http: 200, paymentStatus: 'paid', reservation: 'active' });
      expect(await effects(orderId)).toEqual([
        { effect: 'credit.release', reason: 'invoice_paid', blocked_on: 'credit_limits', attempts: 0, completed: false },
      ]);
    });

    await sweep();
    expect(await reservation(orderId)).toBe('released');
    expect((await effects(orderId)).every((e) => e.completed)).toBe(true);
  });

  // --- the payment-status twin (T12) and the buyer (T11) ---------------------------

  it('a credit release that fails on mark-paid leaves the order paid, the caller answered 200, one outstanding row, and is released by the next sweep', async () => {
    const orderId = await place('credit');
    failing('creditLimitService', 'releaseByOrder');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payment-status`,
      payload: { to: 'paid' },
      ...ADMIN,
    });

    expect({
      http: res.statusCode,
      paymentStatus: (await orderRow(orderId)).payment_status,
      reservation: await reservation(orderId),
    }).toEqual({ http: 200, paymentStatus: 'paid', reservation: 'active' });
    expect(await effects(orderId)).toEqual([
      { effect: 'credit.release', reason: 'invoice_paid', blocked_on: null, attempts: 1, completed: false },
    ]);

    await sweep();
    expect(await reservation(orderId)).toBe('released');
  });

  it('marking an order that drew no credit paid records no follow-up at all', async () => {
    const orderId = await place('plain');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payment-status`,
      payload: { to: 'paid' },
      ...ADMIN,
    });

    expect(res.statusCode).toBe(200);
    expect(await effects(orderId)).toEqual([]);
  });

  const buyerCancel = (orderId: string) =>
    h.app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, ...BUYER });

  it('a buyer cancelling their own order is answered 200 while `credit_limits` and `inventory` are off, and the stock follows when `inventory` returns', async () => {
    const orderId = await place('plain');

    await withModuleOff('credit_limits', 'deactivated', () =>
      withModuleOff('inventory', 'deactivated', async () => {
        const res = await buyerCancel(orderId);
        expect(res.statusCode, res.body).toBe(200);
        expect((await orderRow(orderId)).status).toBe('cancelled');
        expect(await heldAllocations(orderId)).toBe(1);
      }),
    );

    await sweep();
    expect(await heldAllocations(orderId)).toBe(0);
  });

  it('a buyer cannot cancel an order placed on credit at all, whatever `credit_limits` is — the route refuses before the seam', async () => {
    const orderId = await place('credit');

    const whileOn = await buyerCancel(orderId);
    const whileOff = await withModuleOff('credit_limits', 'deactivated', () => buyerCancel(orderId));

    // The same refusal in both states, and it is the buyer predicate's: an
    // order on credit is `deferred`, which is not "the buyer still owes".
    expect(whileOff.statusCode).toBe(whileOn.statusCode);
    expect(whileOn.statusCode).toBeGreaterThanOrEqual(400);
    expect(whileOn.statusCode).toBeLessThan(500);
    expect((await orderRow(orderId)).status).toBe('new');
    expect(await effects(orderId)).toEqual([]);
  });

  // --- the write itself (T09) ---------------------------------------------------

  const transitionAudits = async (orderId: string): Promise<number> =>
    (await h.auditLogService.query({ action: 'order.status_transition', objectId: orderId }))
      .length;

  it('two concurrent cancellations of one order write one status, one audit entry and one set of follow-ups (FR-004)', async () => {
    const orderId = await place('credit');

    const [first, second] = await Promise.all([cancel(orderId), cancel(orderId)]);

    // Both callers are told the truth: the order is cancelled.
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect((await orderRow(orderId)).status).toBe('cancelled');
    expect(await transitionAudits(orderId)).toBe(1);
    expect((await effects(orderId)).map((e) => [e.effect, e.completed])).toEqual([
      ['credit.release', true],
      ['stock.release', true],
    ]);
    expect(await heldAllocations(orderId)).toBe(0);
    expect(await reservation(orderId)).toBe('released');
  });

  it('a vetoed transition writes nothing — no status, no audit entry, no follow-up (FR-003)', async () => {
    const orderId = await place('credit');
    const engine = (
      h.container.resolve('orderTransitionServiceAccessor') as () => {
        onOrderTransitionGuard(
          match: { to?: string },
          guard: (e: { orderId: string }) => void,
        ): () => void;
      } | null
    )()!;
    const lift = engine.onOrderTransitionGuard({ to: 'cancelled' }, (e) => {
      if (e.orderId === orderId) throw new OrderTransitionVetoError('held by a guard', 'new', 'cancelled');
    });

    try {
      const res = await cancel(orderId);
      expect(res.statusCode).toBe(409);
    } finally {
      lift();
    }

    expect((await orderRow(orderId)).status).toBe('new');
    expect(await transitionAudits(orderId)).toBe(0);
    expect(await effects(orderId)).toEqual([]);
    expect(await heldAllocations(orderId)).toBe(1);
    expect(await reservation(orderId)).toBe('active');
    expect(announced.has(orderId)).toBe(false);
  });

  it('a cancellation with nothing failing releases both, completes both rows and announces — as before', async () => {
    const orderId = await place('credit');

    const res = await cancel(orderId);

    expect(await observed(orderId, res.statusCode)).toEqual({
      http: 200,
      status: 'cancelled',
      heldAllocations: 0,
      reservation: 'released',
      announced: true,
    });
    expect((await effects(orderId)).every((e) => e.completed && e.attempts === 0)).toBe(true);
  });
});
