import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  EFFECT_BACKOFF_CAP_MS,
  OrderTransitionEffectService,
  effectBackoffMs,
} from '../../../../packages/modules/orders/dist/backend/services/order-transition-effect-service.js';
import type {
  OrderTransitionEffectHandlers,
  OrderTransitionEffectOutcome,
} from '../../../../packages/modules/orders/dist/backend/services/order-transition-effect-handlers.js';
import { Order } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * `OrderTransitionEffectService` (`specs/142-order-transition-atomicity/`, D6)
 * against a real database, with scripted handlers.
 *
 * The handlers are this file's own on purpose: what is under test is the
 * queue — claiming, recording an outcome, backing off, skipping what is not
 * due or whose owner is absent — and none of that depends on what a release
 * does. The real handlers are driven end to end by
 * `transition-failure-states.test.ts`.
 */

const done = (result: Record<string, unknown> = {}): OrderTransitionEffectOutcome => ({
  outcome: 'done',
  result,
});

interface Row {
  effect: string;
  attempts: number;
  blocked_on: string | null;
  last_error: string | null;
  completed: boolean;
  next_attempt_at: Date;
  result: Record<string, unknown> | null;
}

describe('OrderTransitionEffectService (spec 142, T08)', () => {
  let h: BackendServerHandle;
  let emFactory: () => EntityManager;
  const stock = vi.fn<OrderTransitionEffectHandlers['stock.release']>();
  const credit = vi.fn<OrderTransitionEffectHandlers['credit.release']>();
  const warn = vi.fn();
  let absent = new Set<string>();

  const service = (): OrderTransitionEffectService =>
    new OrderTransitionEffectService({
      emFactory,
      handlers: { 'stock.release': stock, 'credit.release': credit },
      isPresent: (moduleId) => !absent.has(moduleId),
      log: { info: () => undefined, warn, error: () => undefined },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    emFactory = h.container.resolve('emFactory') as () => EntityManager;
  });

  beforeEach(async () => {
    stock.mockReset().mockResolvedValue(done({ released: 1 }));
    credit.mockReset().mockResolvedValue(done({ ok: true }));
    warn.mockReset();
    absent = new Set();
    // Each case starts from an empty queue, so a sweep sees only its own rows.
    await h.em().getConnection().execute(`delete from "order_transition_effects"`);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // --- fixtures --------------------------------------------------------------

  async function seedOrder(): Promise<string> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: '00000000-0000-4000-8000-0000000000c1',
      status: 'cancelled',
      paymentStatus: 'deferred',
      deliveryAddress: {
        recipientName: 'Stub', street: 'ul. Odbioru 1', city: 'Warszawa',
        postalCode: '00-100', country: 'PL',
      },
      billingAddress: {
        recipientName: 'Stub', street: 'ul. Rozliczeń 2', city: 'Warszawa',
        postalCode: '00-101', country: 'PL',
      },
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      paymentMethodSnapshot: { code: 'credit_limit', name: 'CL', kind: 'credit_limit' },
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '0.00',
      total: '123.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order.id;
  }

  /** An order owing both releases, recorded the way a cancellation records them. */
  async function owingBoth(): Promise<string> {
    const orderId = await seedOrder();
    await emFactory().transactional((tx) =>
      service().record(
        tx,
        { id: orderId, organizationId: TEST_ORGANIZATION_ID },
        [
          { effect: 'stock.release', reason: 'order_cancelled' },
          { effect: 'credit.release', reason: 'order_cancelled' },
        ],
        'transition',
      ),
    );
    return orderId;
  }

  async function rowsOf(orderId: string): Promise<Record<string, Row>> {
    const rows = (await h.em().getConnection().execute(
      `select "effect", "attempts", "blocked_on", "last_error", "next_attempt_at", "result",
              ("completed_at" is not null) as "completed"
         from "order_transition_effects" where "order_id" = ?`,
      [orderId],
    )) as Row[];
    return Object.fromEntries(rows.map((row) => [row.effect, row]));
  }

  const sweep = (now: Date = new Date()) =>
    withSystemScope('spec 142 test — sweep', () => service().sweep(now));

  // --- record -----------------------------------------------------------------

  it('records an effect once while it is outstanding, whoever asks second', async () => {
    const orderId = await owingBoth();

    const writtenAgain = await emFactory().transactional((tx) =>
      service().record(
        tx,
        { id: orderId, organizationId: TEST_ORGANIZATION_ID },
        [{ effect: 'credit.release', reason: 'invoice_paid' }],
        'repair',
      ),
    );

    expect(writtenAgain).toBe(0);
    expect(Object.keys(await rowsOf(orderId)).sort()).toEqual(['credit.release', 'stock.release']);
  });

  it('writes nothing when the recording transaction rolls back', async () => {
    const orderId = await seedOrder();

    await expect(
      emFactory().transactional(async (tx) => {
        await service().record(
          tx,
          { id: orderId, organizationId: TEST_ORGANIZATION_ID },
          [{ effect: 'stock.release', reason: 'order_cancelled' }],
          'transition',
        );
        throw new Error('the status write failed');
      }),
    ).rejects.toThrow('the status write failed');

    expect(await rowsOf(orderId)).toEqual({});
  });

  // --- drainForOrder ------------------------------------------------------------

  it('completes every row of the order and keeps what the owner answered', async () => {
    const orderId = await owingBoth();

    expect(await service().drainForOrder(orderId)).toEqual({
      done: 2, blocked: 0, failed: 0, skipped: 0,
    });

    const rows = await rowsOf(orderId);
    expect(rows['stock.release']).toMatchObject({ completed: true, result: { released: 1 } });
    expect(rows['credit.release']).toMatchObject({ completed: true, result: { ok: true } });
    expect(stock).toHaveBeenCalledWith({ orderId, reason: 'order_cancelled' });
  });

  it('a failing handler leaves its row outstanding with one attempt and a later retry, and does not stop the other row (FR-009)', async () => {
    const orderId = await owingBoth();
    credit.mockRejectedValueOnce(new Error('lock timeout'));
    const before = Date.now();

    expect(await service().drainForOrder(orderId)).toEqual({
      done: 1, blocked: 0, failed: 1, skipped: 0,
    });

    const rows = await rowsOf(orderId);
    expect(rows['credit.release']).toMatchObject({
      completed: false, attempts: 1, last_error: 'lock timeout', blocked_on: null,
    });
    expect(new Date(rows['credit.release']!.next_attempt_at).getTime()).toBeGreaterThanOrEqual(
      before + 59_000,
    );
    expect(rows['stock.release']).toMatchObject({ completed: true });
  });

  it('a blocked handler leaves the attempt count alone and records what it waits for', async () => {
    const orderId = await owingBoth();
    stock.mockResolvedValueOnce({ outcome: 'blocked', moduleId: 'inventory' });

    expect(await service().drainForOrder(orderId)).toEqual({
      done: 1, blocked: 1, failed: 0, skipped: 0,
    });

    expect((await rowsOf(orderId))['stock.release']).toMatchObject({
      completed: false, attempts: 0, blocked_on: 'inventory', last_error: null,
    });
  });

  it('two concurrent drains of one order run each handler once (FR-010)', async () => {
    const orderId = await owingBoth();
    const slowly = async (): Promise<OrderTransitionEffectOutcome> => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return done();
    };
    stock.mockImplementation(slowly);
    credit.mockImplementation(slowly);

    await Promise.all([service().drainForOrder(orderId), service().drainForOrder(orderId)]);

    expect(stock).toHaveBeenCalledTimes(1);
    expect(credit).toHaveBeenCalledTimes(1);
    const rows = await rowsOf(orderId);
    expect(rows['stock.release']!.completed && rows['credit.release']!.completed).toBe(true);
  });

  it('re-throws a module switched off under the handler and leaves the row untouched', async () => {
    const orderId = await owingBoth();
    credit.mockRejectedValueOnce(new ModuleDisabledError('credit_limits'));

    await expect(service().drainForOrder(orderId)).rejects.toBeInstanceOf(ModuleDisabledError);

    expect((await rowsOf(orderId))['credit.release']).toMatchObject({
      completed: false, attempts: 0, last_error: null,
    });
  });

  // --- sweep -------------------------------------------------------------------

  it('sweep runs what is due and skips what is not yet', async () => {
    const orderId = await owingBoth();
    credit.mockRejectedValueOnce(new Error('first failure'));
    await service().drainForOrder(orderId);
    credit.mockClear();

    // One second later the retry is not due: the back-off is a minute.
    expect(await sweep(new Date(Date.now() + 1_000))).toEqual({
      done: 0, blocked: 0, failed: 0, skipped: 0,
    });
    expect(credit).not.toHaveBeenCalled();

    expect(await sweep(new Date(Date.now() + 61_000))).toMatchObject({ done: 1 });
    expect((await rowsOf(orderId))['credit.release']).toMatchObject({ completed: true });
  });

  it('with an owner absent, sweep does no per-row work for its effect and marks the rows as waiting', async () => {
    const orderId = await owingBoth();
    absent = new Set(['inventory']);

    expect(await sweep()).toEqual({ done: 1, blocked: 0, failed: 0, skipped: 0 });

    expect(stock).not.toHaveBeenCalled();
    const rows = await rowsOf(orderId);
    expect(rows['stock.release']).toMatchObject({
      completed: false, attempts: 0, blocked_on: 'inventory',
    });
    expect(rows['credit.release']).toMatchObject({ completed: true });

    // The owner returns: the next pass runs the row (FR-008).
    absent = new Set();
    expect(await sweep()).toMatchObject({ done: 1 });
    expect((await rowsOf(orderId))['stock.release']).toMatchObject({
      completed: true, blocked_on: null,
    });
  });

  it('with every owner absent, sweep attempts nothing at all', async () => {
    await owingBoth();
    absent = new Set(['inventory', 'credit_limits']);

    expect(await sweep()).toEqual({ done: 0, blocked: 0, failed: 0, skipped: 0 });
    expect(stock).not.toHaveBeenCalled();
    expect(credit).not.toHaveBeenCalled();
  });

  // --- back-off and the warning ------------------------------------------------

  it('backs off one minute, doubling, and never more than an hour', () => {
    expect(effectBackoffMs(0)).toBe(60_000);
    expect(effectBackoffMs(1)).toBe(120_000);
    expect(effectBackoffMs(5)).toBe(32 * 60_000);
    expect(effectBackoffMs(6)).toBe(EFFECT_BACKOFF_CAP_MS);
    expect(effectBackoffMs(400)).toBe(EFFECT_BACKOFF_CAP_MS);
    expect(EFFECT_BACKOFF_CAP_MS).toBe(60 * 60_000);
  });

  it('keeps retrying past the fifth failure, warning on the fifth and on every one after it (FR-020)', async () => {
    const orderId = await owingBoth();
    credit.mockRejectedValue(new Error('still failing'));

    let now = Date.now();
    for (let failure = 1; failure <= 6; failure += 1) {
      now += EFFECT_BACKOFF_CAP_MS + 1_000;
      await sweep(new Date(now));
      expect(warn).toHaveBeenCalledTimes(Math.max(0, failure - 4));
    }

    const row = (await rowsOf(orderId))['credit.release']!;
    expect(row).toMatchObject({ completed: false, attempts: 6 });
    // Capped: the seventh attempt is due at most an hour after the sixth.
    expect(new Date(row.next_attempt_at).getTime()).toBeLessThanOrEqual(
      now + EFFECT_BACKOFF_CAP_MS,
    );
    expect(warn).toHaveBeenLastCalledWith(
      { orderId, effect: 'credit.release', attempts: 6, lastError: 'still failing' },
      expect.any(String),
    );

    // No terminal state: once the cause is gone, the next due pass completes it.
    credit.mockReset().mockResolvedValue(done({ ok: true }));
    await sweep(new Date(now + EFFECT_BACKOFF_CAP_MS + 1_000));
    expect((await rowsOf(orderId))['credit.release']).toMatchObject({ completed: true });
  });
});
