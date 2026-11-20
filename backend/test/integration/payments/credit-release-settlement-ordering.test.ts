import { randomUUID } from 'crypto';
import { LockMode } from '@mikro-orm/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrderTransitionPort, PaymentMethodReadPort } from '@endora-commerce/contracts';
import type {
  OrderPaymentSettlementEffectsPort,
  OrderPaymentStatusApplyPort,
} from '../../../../packages/modules/orders/src/ports/index.js';
import { ReceivePaymentHandler, type PaymentEventBus } from '../../../../packages/modules/payments/src/backend/services/receive-payment-handler.js';
import type { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CreditLimit, CreditLimitReservation, Order, Payment, PaymentMethod } from '../../helpers/package-entities.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

describe('#1576 credit release across settlement and admin payment-status writes', () => {
  let h: BackendServerHandle;
  let creditMethodId: string;
  let creditLimitId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await em.execute('update "stock_levels" set "on_hand" = 100000 where "product_id" = ?', [
      SEED_PRODUCT_101_ID,
    ]);
    const method = em.create(PaymentMethod, {
      code: `cl_${randomUUID().slice(0, 8)}`,
      name: { default: 'Credit limit' },
      kind: 'credit_limit',
      adapter: 'credit_limit',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    const limit = em.create(CreditLimit, {
      organizationId: TEST_ORGANIZATION_ID,
      grantedAmount: '1000000.00',
      currency: 'PLN',
    });
    await em.flush();
    creditMethodId = method.id;
    creditLimitId = limit.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function place(paymentMethodId = creditMethodId): Promise<string> {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      ...BUYER,
    });
    expect(added.statusCode, added.body).toBe(200);
    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId,
      },
      ...BUYER,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  async function activeCredit(): Promise<string> {
    const rows = await h.em().execute<Array<{ total: string }>>(
      `select coalesce(sum("amount"), 0)::text as "total"
         from "credit_limit_reservations" where "credit_limit_id" = ? and "status" = 'active'`,
      [creditLimitId],
    );
    return rows[0]!.total;
  }

  /**
   * A decimal amount string as integer minor units (grosze). Postgres returns
   * `numeric` sums as text, and comparing them as JS floats makes `99.95`
   * differ from `99.94…` by an ulp — noise beside what these cases assert,
   * which is a whole reservation's worth (19.99). Integer cents keep the
   * comparison exact.
   */
  function minorUnits(amount: string): number {
    const [whole = '0', fraction = ''] = amount.split('.');
    return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  }

  async function adminPaid(orderId: string): Promise<void> {
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payment-status`,
      payload: { to: 'paid' },
      ...ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  const handler = () => new ReceivePaymentHandler(
    h.em,
    h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
    h.container.resolve<OrderTransitionPort>('orderTransitionPort'),
    h.container.resolve<OrderPaymentStatusApplyPort>('orderPaymentStatusApplyPort'),
    h.container.resolve<OrderPaymentSettlementEffectsPort>('orderPaymentSettlementEffectsPort'),
    { warn: () => undefined },
    h.eventBus as PaymentEventBus,
  );

  const effectsFor = (orderId: string) => h.em().execute<Array<{
    id: string;
    completed_at: Date | null;
    blocked_on: string | null;
    attempts: number;
    last_error: string | null;
  }>>(
    `select "id", "completed_at", "blocked_on", "attempts", "last_error"
       from "order_transition_effects" where "order_id" = ? and "effect" = 'credit.release'`,
    [orderId],
  );

  const sweep = (hoursAhead: number) => withSystemScope('#1576 settlement recovery sweep', () =>
    h.container.resolve<{ sweep(now: Date): Promise<unknown> }>('orderTransitionEffectService')
      .sweep(new Date(Date.now() + hoursAhead * 60 * 60 * 1000)),
  );

  async function bystanderFixture() {
    const orderId = await place();
    const before = await h.em().findOneOrFail(CreditLimitReservation, { orderId });
    expect(before.status).toBe('active');
    const creditBefore = await activeCredit();
    return {
      creditBefore,
      async assertUnaffected() {
        const after = await h.em().findOneOrFail(CreditLimitReservation, { orderId }, { refresh: true });
        expect(after).toMatchObject({ id: before.id, status: 'active', amount: before.amount });
        expect(await effectsFor(orderId)).toHaveLength(0);
      },
    };
  }

  async function deferredFixture(paymentMethodId = creditMethodId) {
    const bystander = await bystanderFixture();
    const orderId = await place(paymentMethodId);
    const payment = await h.em().findOneOrFail(Payment, { orderId });
    const reservation = await h.em().findOneOrFail(CreditLimitReservation, { orderId });
    expect(payment.status).toBe('deferred');
    expect(reservation.status).toBe('active');
    expect(await effectsFor(orderId)).toHaveLength(0);
    return { bystander, orderId, payment, reservation };
  }

  async function assertReleased(orderId: string, reservationId: string, creditBefore: string) {
    const rows = await h.em().find(CreditLimitReservation, { orderId }, { refresh: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: reservationId, status: 'released' });
    expect(minorUnits(await activeCredit())).toBe(minorUnits(creditBefore));
    const effects = await effectsFor(orderId);
    expect(effects).toHaveLength(1);
    expect(effects[0]!.completed_at).not.toBeNull();
  }

  it('ordinary non-credit receive records no credit.release obligation', async () => {
    const bystander = await bystanderFixture();
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `bank_${randomUUID().slice(0, 8)}`,
      name: { default: 'Bank transfer' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    await em.flush();
    const orderId = await place(method.id);
    const payment = await h.em().findOneOrFail(Payment, { orderId });
    expect((await handler().receive({ paymentId: payment.id, outcome: 'success' })).status).toBe('paid');
    expect(await effectsFor(orderId)).toHaveLength(0);
    expect(await h.em().count(CreditLimitReservation, { orderId })).toBe(0);
    expect(minorUnits(await activeCredit())).toBe(minorUnits(bystander.creditBefore));
    await bystander.assertUnaffected();
  });

  it('failed deferred settlement keeps the reservation active and records no obligation', async () => {
    const { bystander, orderId, payment, reservation } = await deferredFixture();
    const release = vi.spyOn(h.container.resolve<CreditLimitService>('creditLimitService'), 'releaseByOrder');

    await handler().receive({ paymentId: payment.id, outcome: 'failure' });

    const fresh = h.em().fork();
    expect((await fresh.findOneOrFail(CreditLimitReservation, { id: reservation.id })).status)
      .toBe('active');
    expect(await fresh.execute<Array<{ id: string }>>(
      'select "id" from "order_transition_effects" where "order_id" = ?',
      [orderId],
    )).toHaveLength(0);
    expect(release.mock.calls.filter(([input]) => input.orderId === orderId)).toHaveLength(0);
    expect((await fresh.findOneOrFail(Order, { id: orderId })).paymentStatus).toBe('deferred');
    expect((await fresh.findOneOrFail(Payment, { id: payment.id })).status).toBe('failed');
    await bystander.assertUnaffected();
  });

  it('successful settlement with no configured lifecycle target still releases credit exactly once', async () => {
    const methodEm = h.em().fork();
    const method = methodEm.create(PaymentMethod, {
      code: `cl_no_target_${randomUUID().slice(0, 8)}`,
      name: { default: 'Credit limit without lifecycle target' },
      kind: 'credit_limit',
      adapter: 'credit_limit',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    await methodEm.flush();
    const { bystander, orderId, payment, reservation } = await deferredFixture(method.id);
    const beforeStatus = (await h.em().fork().findOneOrFail(Order, { id: orderId })).status;
    method.statusOnSuccess = '';
    await methodEm.flush();
    const release = vi.spyOn(h.container.resolve<CreditLimitService>('creditLimitService'), 'releaseByOrder');

    await handler().receive({ paymentId: payment.id, outcome: 'success' });

    const fresh = h.em().fork();
    expect((await fresh.findOneOrFail(CreditLimitReservation, { id: reservation.id })).status)
      .toBe('released');
    const effects = await fresh.execute<Array<{ completed_at: Date | null }>>(
      'select "completed_at" from "order_transition_effects" where "order_id" = ?',
      [orderId],
    );
    expect(effects).toHaveLength(1);
    expect(effects[0]!.completed_at).not.toBeNull();
    expect(release.mock.calls.filter(([input]) => input.orderId === orderId)).toHaveLength(1);
    const order = await fresh.findOneOrFail(Order, { id: orderId });
    expect(order.status).toBe(beforeStatus);
    expect(order.paymentStatus).toBe('paid');
    await bystander.assertUnaffected();
  });

  it.each(['paid', 'refunded'] as const)(
    'receive against %s order records no new obligation (unchanged or refused)',
    async (paymentStatus) => {
      const { bystander, orderId, payment, reservation } = await deferredFixture();
      // Arrange the money-axis state without driving a prior transition that
      // would already have created an obligation; keep the provider attempt deferred.
      await h.em().nativeUpdate(Order, { id: orderId }, { paymentStatus });
      const creditBefore = await activeCredit();
      const result = await handler().receive({ paymentId: payment.id, outcome: 'success' });
      expect(result.status).toBe('paid');
      expect((await h.em().findOneOrFail(Order, { id: orderId }, { refresh: true })).paymentStatus)
        .toBe(paymentStatus);
      expect(await effectsFor(orderId)).toHaveLength(0);
      expect(await h.em().findOneOrFail(CreditLimitReservation, { id: reservation.id }, { refresh: true }))
        .toMatchObject({ status: 'active' });
      expect(minorUnits(await activeCredit())).toBe(minorUnits(creditBefore));
      await bystander.assertUnaffected();
    },
  );

  it('rolls back payment, order status and effect row when recording fails', async () => {
    const { bystander, orderId, payment, reservation } = await deferredFixture();
    const before = await h.em().fork().findOneOrFail(Order, { id: orderId });
    expect(before.paymentStatus).toBe('deferred');
    const apply = h.container.resolve<OrderPaymentStatusApplyPort>('orderPaymentStatusApplyPort');
    const error = new Error('#1576 injected failure after recording settlement effects');
    const events = vi.spyOn(h.eventBus as PaymentEventBus, 'emit');
    const failingHandler = new ReceivePaymentHandler(
      h.em,
      h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
      h.container.resolve<OrderTransitionPort>('orderTransitionPort'),
      {
        async applyPaymentStatus(tx, input) {
          const result = await apply.applyPaymentStatus(tx, input);
          expect(result).toMatchObject({ outcome: 'applied', owesEffects: true });
          const recorded = await tx.execute<Array<{ id: string }>>(
            'select "id" from "order_transition_effects" where "order_id" = ?',
            [orderId],
          );
          expect(recorded).toHaveLength(1);
          throw error;
        },
      },
      h.container.resolve<OrderPaymentSettlementEffectsPort>('orderPaymentSettlementEffectsPort'),
      { warn: () => undefined },
      h.eventBus as PaymentEventBus,
    );

    await expect(failingHandler.receive({ paymentId: payment.id, outcome: 'success' }))
      .rejects.toBe(error);

    const fresh = h.em().fork();
    expect((await fresh.findOneOrFail(Payment, { id: payment.id })).status).toBe('deferred');
    const after = await fresh.findOneOrFail(Order, { id: orderId });
    expect(after.paymentStatus).toBe('deferred');
    expect(after.status).toBe(before.status);
    expect(await fresh.execute<Array<{ id: string }>>(
      'select "id" from "order_transition_effects" where "order_id" = ?',
      [orderId],
    )).toHaveLength(0);
    expect((await fresh.findOneOrFail(CreditLimitReservation, { id: reservation.id })).status)
      .toBe('active');
    expect(events.mock.calls.filter(([name, event]) =>
      name === 'payment.received.v1' && (event as { orderId?: string }).orderId === orderId,
    )).toHaveLength(0);
    await bystander.assertUnaffected();
  });

  it('recoverable immediate credit release failure is retained and swept exactly once', async () => {
    const { bystander, orderId, payment, reservation } = await deferredFixture();
    const release = vi.spyOn(h.container.resolve<CreditLimitService>('creditLimitService'), 'releaseByOrder');
    release.mockRejectedValue(new Error('#1576 injected recoverable credit release failure'));
    expect((await handler().receive({ paymentId: payment.id, outcome: 'success' })).status).toBe('paid');
    const outstanding = await effectsFor(orderId);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]!.completed_at).toBeNull();
    expect(outstanding[0]!.attempts).toBeGreaterThan(0);
    expect(outstanding[0]!.blocked_on).toBeNull();
    expect(outstanding[0]!.last_error).toContain('#1576 injected recoverable credit release failure');
    expect((await h.em().findOneOrFail(CreditLimitReservation, { id: reservation.id }, { refresh: true })).status)
      .toBe('active');
    // Restore the real owner before the sweep retries the durable obligation.
    release.mockRestore();
    await sweep(2);
    await assertReleased(orderId, reservation.id, bystander.creditBefore);
    await sweep(4);
    expect((await effectsFor(orderId)).map((row) => row.id)).toEqual([outstanding[0]!.id]);
    await assertReleased(orderId, reservation.id, bystander.creditBefore);
    await bystander.assertUnaffected();
  });

  it('credit limits off retains a blocked obligation after lifecycle and payment event', async () => {
    const { bystander, orderId, payment, reservation } = await deferredFixture();
    const received: string[] = [];
    const stop = (h.eventBus as PaymentEventBus).on('payment.received.v1', (event) => {
      if (event.orderId === orderId) received.push(event.paymentId);
    });
    try {
      await withModuleOff('credit_limits', 'deactivated', async () => {
        const result = await handler().receive({ paymentId: payment.id, outcome: 'success' });
        expect(result).toMatchObject({ status: 'paid', orderStatus: 'paid' });
        expect((await h.em().findOneOrFail(Order, { id: orderId }, { refresh: true })).status).toBe('paid');
        await expect.poll(() => received).toEqual([payment.id]);
        const blocked = await effectsFor(orderId);
        expect(blocked).toHaveLength(1);
        expect(blocked[0]).toMatchObject({ blocked_on: 'credit_limits', completed_at: null, attempts: 0 });
        await sweep(2);
        expect(await effectsFor(orderId)).toHaveLength(1);
        expect((await h.em().findOneOrFail(CreditLimitReservation, { id: reservation.id }, { refresh: true })).status)
          .toBe('active');
        await bystander.assertUnaffected();
      });
      await sweep(4);
      await sweep(6);
      await assertReleased(orderId, reservation.id, bystander.creditBefore);
      await bystander.assertUnaffected();
    } finally {
      stop();
    }
  });

  it('HTTP receive settles deferred credit with one obligation and one release', async () => {
    const { bystander, orderId, payment, reservation } = await deferredFixture();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      payload: { paymentId: payment.id, outcome: 'success' },
      ...ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ data: { paymentId: payment.id, status: 'paid' } });
    expect((await h.em().findOneOrFail(Order, { id: orderId }, { refresh: true })).paymentStatus).toBe('paid');
    await assertReleased(orderId, reservation.id, bystander.creditBefore);
    await bystander.assertUnaffected();
  });

  it('a stale settlement read after admin paid does not record or release credit twice', async () => {
    const { bystander, orderId, payment, reservation } = await deferredFixture();
    const creditBefore = bystander.creditBefore;
    const release = vi.spyOn(h.container.resolve<CreditLimitService>('creditLimitService'), 'releaseByOrder');
    const effects = h.container.resolve<OrderPaymentSettlementEffectsPort>('orderPaymentSettlementEffectsPort');
    const apply = h.container.resolve<OrderPaymentStatusApplyPort>('orderPaymentStatusApplyPort');
    let writerAResult: Awaited<ReturnType<OrderPaymentStatusApplyPort['applyPaymentStatus']>> = null;
    let staleRead!: () => void;
    let resume!: () => void;
    const readComplete = new Promise<void>((resolve) => { staleRead = resolve; });
    const mayResume = new Promise<void>((resolve) => { resume = resolve; });
    const writerA = new ReceivePaymentHandler(
      h.em,
      h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
      h.container.resolve<OrderTransitionPort>('orderTransitionPort'),
      {
        async applyPaymentStatus(tx, input) {
          const stale = await tx.findOneOrFail(Order, { id: orderId });
          expect(stale.paymentStatus).toBe('deferred');
          staleRead();
          await mayResume;
          writerAResult = await apply.applyPaymentStatus(tx, input);
          return writerAResult;
        },
      },
      effects,
      { warn: () => undefined },
    ).receive({ paymentId: payment.id, outcome: 'success' });

    try {
      await readComplete;
      await adminPaid(orderId);
      const first = await effectsFor(orderId);
      expect(first).toHaveLength(1);
      expect(first[0]!.completed_at).not.toBeNull();
      expect((await h.em().findOneOrFail(CreditLimitReservation, { id: reservation.id })).status)
        .toBe('released');
    } finally {
      resume();
    }

    expect((await writerA).status).toBe('paid');
    // A's managed Order was deferred before B committed. The port must decide
    // from the current row, not create another obligation from that stale view.
    expect(writerAResult).toMatchObject({ outcome: 'unchanged', owesEffects: false });
    const after = await effectsFor(orderId);
    expect(after).toHaveLength(1);
    expect(after[0]!.completed_at).not.toBeNull();
    expect(release.mock.calls.filter(([input]) => input.orderId === orderId)).toHaveLength(1);
    expect(minorUnits(await activeCredit())).toBe(minorUnits(creditBefore));
    await bystander.assertUnaffected();
  });

  const scenarios = [
    'receive then admin paid',
    'admin paid then receive',
    'receive twice',
    'concurrent receive and admin paid',
  ] as const;

  it.each(scenarios)('%s releases credit exactly once', async (scenario) => {
    // Keep real active credit beside the target: a doubled release must not
    // disappear behind an empty balance (transition-effects-fault-injection).
    const bystander = await place();
    const creditBefore = await activeCredit();
    expect(minorUnits(creditBefore)).toBeGreaterThan(0);
    const bystanderBefore = await h.em().findOneOrFail(CreditLimitReservation, { orderId: bystander });
    const orderId = await place();
    const reservationBefore = await h.em().findOneOrFail(CreditLimitReservation, { orderId });
    expect(reservationBefore.status).toBe('active');
    expect(minorUnits(await activeCredit())).toBe(
      minorUnits(creditBefore) + minorUnits(reservationBefore.amount),
    );
    const payment = await h.em().findOneOrFail(Payment, { orderId });
    expect(payment.status).toBe('deferred');
    expect((await h.em().findOneOrFail(Order, { id: orderId })).paymentStatus).toBe('deferred');

    const handler = new ReceivePaymentHandler(
      h.em,
      h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
      h.container.resolve<OrderTransitionPort>('orderTransitionPort'),
      h.container.resolve<OrderPaymentStatusApplyPort>('orderPaymentStatusApplyPort'),
      h.container.resolve<OrderPaymentSettlementEffectsPort>('orderPaymentSettlementEffectsPort'),
      { warn: () => undefined },
    );
    const receive = () => handler.receive({ paymentId: payment.id, outcome: 'success' });

    if (scenario === 'receive then admin paid') {
      expect((await receive()).status).toBe('paid');
      await adminPaid(orderId);
    } else if (scenario === 'admin paid then receive') {
      await adminPaid(orderId);
      expect((await receive()).status).toBe('paid');
    } else if (scenario === 'receive twice') {
      expect((await receive()).status).toBe('paid');
      expect(await receive()).toMatchObject({ status: 'paid', idempotent: true });
    } else {
      // Hold the row on a third connection until BOTH real writers are waiting
      // in Postgres. Promise.all alone can accidentally run them serially.
      const blocker = h.em().fork();
      await blocker.begin();
      try {
        await blocker.findOneOrFail(Order, { id: orderId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        const results = await Promise.all([
          receive(),
          adminPaid(orderId),
          (async () => {
            try {
              await expect.poll(async () => {
                const blockerRows = await blocker.execute<Array<{ pid: number }>>(
                  'select pg_backend_pid() as pid',
                );
                const blockerPid = blockerRows[0]!.pid;
                const rows = await h.em().execute<Array<{ waiting: number }>>(
                  `with recursive blocked(pid) as (
                     select ?::int
                     union
                     select activity.pid
                       from pg_stat_activity activity
                       join blocked on blocked.pid = any(pg_blocking_pids(activity.pid))
                      where activity.datname = current_database()
                        and activity.wait_event_type = 'Lock'
                        and activity.pid <> pg_backend_pid()
                   )
                   select count(distinct pid)::int as "waiting"
                     from blocked
                    where pid <> ? and pid <> pg_backend_pid()`,
                  [blockerPid, blockerPid],
                );
                return rows[0]!.waiting;
              }, { timeout: 10000, interval: 25 }).toBe(2);
            } catch (error) {
              const blockerRows = await blocker.execute<Array<{ pid: number }>>(
                'select pg_backend_pid() as pid',
              );
              const sessions = await h.em().execute<Array<{
                pid: number;
                application_name: string;
                state: string | null;
                wait_event_type: string | null;
                wait_event: string | null;
                blocking_pids: number[];
                query: string;
              }>>(
                `select pid, application_name, state, wait_event_type, wait_event,
                        pg_blocking_pids(pid) as blocking_pids,
                        left(query, 120) as query
                   from pg_stat_activity
                  where datname = current_database()
                    and pid <> pg_backend_pid()
                  order by pid`,
              );
              console.error('[credit-release barrier diagnostic]', JSON.stringify({
                blockerPid: blockerRows[0]!.pid,
                sessions,
              }, null, 2));
              throw error;
            } finally {
              await blocker.commit();
            }
          })(),
        ]);
        expect(results[0].status).toBe('paid');
      } finally {
        if (blocker.isInTransaction()) await blocker.rollback();
      }
    }

    // Count completed AND outstanding obligations; a partial unique index on
    // outstanding rows alone would hide a second obligation after the drain.
    const effects = await h.em().execute<Array<{ completed_at: Date | null }>>(
      `select "completed_at" from "order_transition_effects"
        where "order_id" = ? and "effect" = 'credit.release'`,
      [orderId],
    );
    expect(effects).toHaveLength(1);
    expect(effects[0]!.completed_at).not.toBeNull();
    const reservations = await h.em().find(CreditLimitReservation, { orderId }, { refresh: true });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ id: reservationBefore.id, status: 'released' });
    expect(minorUnits(await activeCredit())).toBe(minorUnits(creditBefore));
    const bystanderAfter = await h.em().findOneOrFail(
      CreditLimitReservation, { orderId: bystander }, { refresh: true },
    );
    expect(bystanderAfter).toMatchObject({
      id: bystanderBefore.id,
      status: 'active',
      amount: bystanderBefore.amount,
    });
    expect((await h.em().findOneOrFail(Order, { id: orderId }, { refresh: true })).paymentStatus).toBe('paid');
  });
});
