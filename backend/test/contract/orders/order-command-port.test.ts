import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORDER_EXTERNAL_REFERENCE_PORT,
  type CustomFieldValuePort,
  type OrderCommandPort,
  type OrderExternalReferencePort,
  type OrderTransitionPort,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { Order, OrderComment } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import type { OrderTransitionService } from '../../../../packages/modules/orders/src/backend/services/order-transition-service.js';
// `dist`, not `src`: `apply` compares the veto with `instanceof`, and the
// composed platform holds the package's `dist` copy (see order-transition-port.test.ts).
import { OrderTransitionVetoError } from '../../../../packages/modules/orders/dist/backend/events/order-status-events.js';

/**
 * `specs/186-aggregate-ports/` T056 (issue #1823, US4) — `orderCommandPort`
 * runs the Command the admin route for the same operation runs. Each case
 * performs the operation twice, once through the route and once through the
 * port under the same administrator, on two orders in the same state, and
 * holds what each wrote to the other (`expectPortParity`): the audit entries,
 * the command hooks fired, the outbox rows, and a side-effect probe — the
 * status the order reached and the announcement heard, the customer notice
 * sent for a comment.
 *
 * `setExternalReference` has no admin route: it is measured against the
 * deprecated `orderExternalReferencePort.set`, which ran it until now
 * (research R-17.7's precedent). The deprecated `orderTransitionPort` is held
 * to delegation the same way.
 *
 * Then the port's own additions: `source` recorded beside the actor, a
 * malformed `source` and an unclaimed extension refused with nothing written,
 * and `applyStatus`' refusals answered as outcomes that write and audit
 * nothing.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const ORDERS = '/api/v1/admin/orders';
const RUN = randomUUID().slice(0, 8);

describe('orderCommandPort — the admin routes’ Commands (#1823)', () => {
  let h: BackendServerHandle;
  let port: OrderCommandPort;
  const mailer = new InMemoryMailer();
  const announced: Array<{ orderId: string; from: string; to: string }> = [];
  const definitions: string[] = [];
  let off: (() => void) | undefined;

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: order command port', fn);
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: order command port worker', fn);

  async function seedOrder(over: Partial<Order> = {}): Promise<Order> {
    const em = h.em().fork();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: randomUUID(),
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer', adapter: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
      ...over,
    });
    await em.persist(order).flush();
    return order;
  }

  async function route(method: 'POST' | 'PATCH', url: string, payload: object, status = 200) {
    const res = await h.app.inject({ method, url, cookies: ADMIN, payload });
    expect(res.statusCode, res.body).toBe(status);
    return res.json() as { data: Record<string, unknown> };
  }

  function observe<T>(objectId: string, write: () => Promise<T>, probe?: (result: T) => unknown): Promise<ParityObservation> {
    return observeWrite<T>(
      { em: () => h.em().fork(), objectType: 'order', objectId, ...(probe ? { probe } : {}) },
      write,
    ).then(({ observation }) => observation);
  }

  const reread = (id: string) => h.em().fork().findOneOrFail(Order, { id });
  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'order', objectId }, { orderBy: { actedAt: 'asc' } });
  const heardFor = (orderId: string) =>
    announced.filter((a) => a.orderId === orderId).map(({ from, to }) => ({ from, to }));
  const noticesFor = (orderId: string) =>
    mailer.sent.filter((message) => JSON.stringify(message).includes(orderId)).length;

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    port = h.container.resolve<OrderCommandPort>('orderCommandPort');
    off = h.eventBus.on('order.status_changed.v1' as never, ((payload: { orderId: string; from: string; to: string }) => {
      announced.push({ orderId: payload.orderId, from: payload.from, to: payload.to });
    }) as never);
  });

  afterAll(async () => {
    off?.();
    for (const id of [...definitions].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/custom-fields/definitions/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('is registered under its container name', () => {
    expect(typeof port.applyStatus).toBe('function');
  });

  describe('applyStatus — order.status_transition', () => {
    it('runs the Command POST …/:id/status runs, with the same announcement', async () => {
      const [a, b] = [await seedOrder(), await seedOrder()];
      const probe = (id: string) => async () => ({ status: (await reread(id)).status, heard: heardFor(id) });

      // In a bus scope, so the announcement is dispatched (and awaited) before the probe reads it.
      const scoped = <T>(fn: () => Promise<T>) => h.eventBus.run(fn);
      await expectPortParity({
        viaRoute: () =>
          observe(a.id, () => scoped(() => route('POST', `${ORDERS}/${a.id}/status`, { to: 'paid' })), probe(a.id)),
        viaPort: () => observe(b.id, () => scoped(() => asAdmin(() => port.applyStatus(b.id, { to: 'paid' }))), probe(b.id)),
      });
      expect(heardFor(b.id)).toEqual([{ from: 'new', to: 'paid' }]);
      // The admin route keeps its strict status-code pattern (review of #1963).
      const strict = await h.app.inject({
        method: 'POST',
        url: `${ORDERS}/${a.id}/status`,
        cookies: ADMIN,
        payload: { to: 'On-Hold' },
      });
      expect(strict.statusCode).toBeGreaterThanOrEqual(400);
      expect(strict.statusCode).toBeLessThan(500);
    });

    it('answers applied, and records the caller’s source beside the system actor from a worker', async () => {
      const order = await seedOrder();

      const outcome = await asWorker(() => port.applyStatus(order.id, { to: 'paid' }, { source: 'payment' }));

      expect(outcome).toEqual({ applied: true, from: 'new', to: 'paid' });
      const [entry] = await entries(order.id);
      expect(entry).toMatchObject({
        action: 'order.status_transition',
        stateBefore: { status: 'new' },
        stateAfter: { status: 'paid', source: 'payment' },
      });
      expect(entry?.actorAdminUserId ?? null).toBeNull();
    });

    it('answers refusals as outcomes that write and audit nothing; already_there records nothing', async () => {
      const order = await seedOrder();
      const transitions = h.container.resolve<() => OrderTransitionService | null>('orderTransitionServiceAccessor')();
      const unsubscribe = transitions!.onOrderTransitionGuard({ to: 'pending' }, () => {
        throw new OrderTransitionVetoError('not today', 'new', 'pending');
      });

      try {
        await asAdmin(async () => {
          expect(await port.applyStatus(randomUUID(), { to: 'paid' })).toMatchObject({ applied: false, reason: 'not_found' });
          expect(await port.applyStatus(order.id, { to: 'no_such_status' })).toMatchObject({
            applied: false,
            reason: 'unknown_status',
            from: 'new',
          });
          // Review of #1963 — a code outside the admin route's pattern, as a
          // payment or delivery method may be configured with, is the same
          // outcome, never a thrown 422 (refusals are values).
          expect(await port.applyStatus(order.id, { to: 'On-Hold' })).toMatchObject({
            applied: false,
            reason: 'unknown_status',
            from: 'new',
          });
          expect(
            await h
              .container.resolve<OrderTransitionPort>('orderTransitionPort')
              .applyStatus({ orderId: order.id, to: 'On-Hold', actor: { kind: 'system', source: 'payment' } }),
          ).toMatchObject({ applied: false, reason: 'unknown_status', from: 'new' });
          expect(await port.applyStatus(order.id, { to: 'completed' })).toMatchObject({
            applied: false,
            reason: 'not_permitted',
            from: 'new',
          });
          expect(await port.applyStatus(order.id, { to: 'pending' })).toMatchObject({
            applied: false,
            reason: 'vetoed',
            from: 'new',
          });
          expect(await port.applyStatus(order.id, { to: 'new' })).toEqual({
            applied: false,
            reason: 'already_there',
            from: 'new',
          });
        });
      } finally {
        unsubscribe();
      }

      expect((await reread(order.id)).status).toBe('new');
      expect(await entries(order.id)).toHaveLength(0);
      expect(heardFor(order.id)).toEqual([]);
    });

    it('refuses a malformed source and an unclaimed extension before anything is written', async () => {
      const order = await seedOrder();

      expect(await refusal(asAdmin(() => port.applyStatus(order.id, { to: 'paid' }, { source: 'Not A Code' })))).toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_FAILED',
      });
      expect(
        await refusal(asAdmin(() => port.applyStatus(order.id, { to: 'paid' }, { extensions: { nobody: { x: 1 } } }))),
      ).toMatchObject({ statusCode: 422, code: 'COMMAND_EXTENSION_UNCLAIMED' });

      expect((await reread(order.id)).status).toBe('new');
      expect(await entries(order.id)).toHaveLength(0);
    });

    it('the deprecated orderTransitionPort delegates: the same entry, its actor’s source as the code', async () => {
      const [a, b] = [await seedOrder(), await seedOrder()];
      const deprecated = h.container.resolve<OrderTransitionPort>('orderTransitionPort');

      const { port: viaDeprecated } = await expectPortParity({
        viaRoute: () => observe(a.id, () => asWorker(() => port.applyStatus(a.id, { to: 'paid' }, { source: 'shipment' }))),
        viaPort: () =>
          observe(b.id, () =>
            asWorker(() => deprecated.applyStatus({ orderId: b.id, to: 'paid', actor: { kind: 'system', source: 'shipment' } })),
          ),
      });
      expect(viaDeprecated.audit[0]?.stateAfter).toEqual({ status: 'paid', source: 'shipment' });
      expect(await deprecated.isTerminal(b.id)).toBe(false);
    });
  });

  describe('applyPaymentStatus — order.payment_status_transition', () => {
    it('runs the Command POST …/:id/payment-status runs', async () => {
      const [a, b] = [await seedOrder(), await seedOrder()];
      const probe = (id: string) => async () => (await reread(id)).paymentStatus;

      await expectPortParity({
        viaRoute: () => observe(a.id, () => route('POST', `${ORDERS}/${a.id}/payment-status`, { to: 'paid' }), probe(a.id)),
        viaPort: () => observe(b.id, () => asAdmin(() => port.applyPaymentStatus(b.id, { to: 'paid' })), probe(b.id)),
      });
    });

    it('refuses what the route refuses, with nothing written', async () => {
      const order = await seedOrder();

      expect(await refusal(asAdmin(() => port.applyPaymentStatus(order.id, { to: 'refunded' })))).toEqual({
        statusCode: 409,
        code: 'ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED',
      });
      expect(await refusal(asAdmin(() => port.applyPaymentStatus(randomUUID(), { to: 'paid' })))).toEqual({
        statusCode: 404,
        code: 'ORDER_NOT_FOUND',
      });
      expect(
        await refusal(asAdmin(() => port.applyPaymentStatus(order.id, { to: 'failed' } as never))),
      ).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' });
      expect((await reread(order.id)).paymentStatus).toBe('awaiting_payment');
      expect(await entries(order.id)).toHaveLength(0);
    });
  });

  describe('setCustomFieldValues — order.custom_fields.update', () => {
    it('runs the Command PATCH …/:id/custom-fields runs, over the caller’s merge', async () => {
      const key = `ocp_${RUN}_channel`;
      const defined = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/custom-fields/definitions',
        cookies: ADMIN,
        payload: {
          entityType: 'order',
          key,
          label: {},
          labelDefault: key,
          valueType: 'select',
          required: false,
          sortOrder: 0,
          config: {},
          options: ['fair', 'web'].map((value, sortOrder) => ({
            value,
            label: {},
            labelDefault: value,
            isDefault: false,
            sortOrder,
          })),
        },
      });
      expect(defined.statusCode, defined.body).toBe(201);
      definitions.push((defined.json() as { data: { id: string } }).data.id);
      const values = h.container.resolve<CustomFieldValuePort>('customFieldValueService');

      const [a, b] = [await seedOrder(), await seedOrder()];
      const probe = (id: string) => async () => (await reread(id)).customFieldValues;
      await expectPortParity({
        viaRoute: () =>
          observe(a.id, () => route('PATCH', `${ORDERS}/${a.id}/custom-fields`, { [key]: 'web' }), probe(a.id)),
        viaPort: () =>
          observe(
            b.id,
            () =>
              asAdmin(() =>
                port.setCustomFieldValues(b.id, (current) => values.validateAndMerge('order', current, { [key]: 'web' })),
              ),
            probe(b.id),
          ),
      });
      expect((await reread(b.id)).customFieldValues).toEqual({ [key]: 'web' });
    });

    it('propagates the merge’s refusal and answers 404 for an unknown order, writing nothing', async () => {
      const order = await seedOrder();
      const refused = Object.assign(new Error('nope'), { statusCode: 422, code: 'CUSTOM_FIELD_VALUE_INVALID' });

      expect(
        await refusal(
          asAdmin(() =>
            port.setCustomFieldValues(order.id, async () => {
              throw refused;
            }),
          ),
        ),
      ).toEqual({ statusCode: 422, code: 'CUSTOM_FIELD_VALUE_INVALID' });
      expect(await refusal(asAdmin(() => port.setCustomFieldValues(randomUUID(), async (c) => c)))).toMatchObject({
        statusCode: 404,
      });
      expect(await entries(order.id)).toHaveLength(0);
    });
  });

  describe('addComment — order.comment.add', () => {
    it('runs the Command POST …/:id/comments runs, with the same customer notice after the commit', async () => {
      const [a, b] = [await seedOrder(), await seedOrder()];
      const body = { body: 'Your order ships on Monday.', isCustomerVisible: true, notifyCustomer: true };
      const probe = (id: string) => async () => {
        const rows = await h.em().fork().find(OrderComment, { orderId: id });
        return {
          comments: rows.map((c) => ({ visible: c.isCustomerVisible, notify: c.notifyCustomer, admin: c.authorAdminUserId })),
          notices: noticesFor(id),
        };
      };

      const { port: viaPort } = await expectPortParity({
        viaRoute: () => observe(a.id, () => route('POST', `${ORDERS}/${a.id}/comments`, body, 201), probe(a.id)),
        viaPort: () => observe(b.id, () => asAdmin(() => port.addComment(b.id, body)), probe(b.id)),
      });
      expect(viaPort.audit[0]?.action).toBe('order.comment.add');
      // The probe measured a notice, not two absences.
      expect(noticesFor(b.id)).toBe(1);
      expect(JSON.stringify(viaPort.audit)).not.toContain('ships on Monday');
    });

    it('refuses a terminal order and a body outside the route’s bounds, writing nothing', async () => {
      const closed = await seedOrder({ status: 'cancelled' });

      expect(
        await refusal(asAdmin(() => port.addComment(closed.id, { body: 'late', isCustomerVisible: false, notifyCustomer: false }))),
      ).toEqual({ statusCode: 409, code: 'ORDER_COMMENTS_CLOSED' });
      expect(
        await refusal(asAdmin(() => port.addComment(closed.id, { body: '', isCustomerVisible: false, notifyCustomer: false }))),
      ).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' });
      expect(await h.em().fork().count(OrderComment, { orderId: closed.id })).toBe(0);
      expect(await entries(closed.id)).toHaveLength(0);
    });
  });

  describe('setExternalReference — order.external_reference.set', () => {
    it('runs the Command the deprecated orderExternalReferencePort.set runs, and that port delegates', async () => {
      const [a, b] = [await seedOrder(), await seedOrder()];
      const deprecated = h.container.resolve<OrderExternalReferencePort>(ORDER_EXTERNAL_REFERENCE_PORT);
      const value = { reference: 'ERP-1823', state: 'synced' as const };

      const { port: viaPort } = await expectPortParity({
        viaRoute: () => observe(a.id, () => asWorker(() => deprecated.set(a.id, 'acme_erp', value))),
        viaPort: () => observe(b.id, () => asWorker(() => port.setExternalReference(b.id, 'acme_erp', value, { source: 'acme_erp' }))),
      });
      expect(viaPort.audit[0]?.stateAfter).toMatchObject({ state: 'synced', source: 'acme_erp' });

      // A resend changes nothing and records nothing.
      const resend = await observe(b.id, () => asWorker(() => port.setExternalReference(b.id, 'acme_erp', value)));
      expect(resend.audit).toEqual([]);
    });
  });
});
