import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

/**
 * `rfq.created_by_admin.v1` and the opaque `origin` of an admin-created Quote
 * Request (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md`
 * §C).
 *
 * The admin create path announced nothing before; `rfq.created.v1` belongs to
 * the customer's submission and still does. The new event names the request,
 * its Organization and the administrator, and hands on the `origin` of the
 * create request — unread, unstored — or `null` when there was none.
 */
describe('quote_requests — rfq.created_by_admin.v1 and the origin of an admin-created request', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    organizationId: TEST_ORGANIZATION_ID,
    customerAccountId: TEST_CUSTOMER_ID,
    items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 12.5 }],
    ...extra,
  });

  /**
   * Run `act` and answer what was announced meanwhile, by event name.
   *
   * The bus hands an event to its subscribers one after another and the
   * emitter does not wait for them, so a listener registered here hears it
   * only once every composed subscriber has finished. `expected` says how many
   * announcements to wait for; with none expected, a pause stands in.
   */
  const announced = async <T>(act: () => Promise<T>, expected: { byAdmin?: number; byCustomer?: number } = {}) => {
    const byAdmin: Array<Record<string, unknown>> = [];
    const byCustomer: Array<Record<string, unknown>> = [];
    const offAdmin = h.eventBus.on('rfq.created_by_admin.v1' as never, (payload: unknown) => {
      byAdmin.push(payload as Record<string, unknown>);
    });
    const offCustomer = h.eventBus.on('rfq.created.v1' as never, (payload: unknown) => {
      byCustomer.push(payload as Record<string, unknown>);
    });
    try {
      const result = await act();
      if (expected.byAdmin || expected.byCustomer) {
        await vi.waitFor(
          () => {
            expect(byAdmin.length).toBeGreaterThanOrEqual(expected.byAdmin ?? 0);
            expect(byCustomer.length).toBeGreaterThanOrEqual(expected.byCustomer ?? 0);
          },
          { timeout: 10_000, interval: 20 },
        );
      }
      // Anything that should not have been announced has had its chance.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { result, byAdmin, byCustomer };
    } finally {
      offAdmin();
      offCustomer();
    }
  };

  const createAsAdmin = (extra: Record<string, unknown> = {}) =>
    h.app.inject({ method: 'POST', url: '/api/v1/admin/quote-requests', cookies: ADMIN, payload: body(extra) });

  it('announces an admin-created request exactly once, with its origin — and not as a customer submission', async () => {
    const origin = { type: 'some_other_module_thing', id: randomUUID() };
    const { result, byAdmin, byCustomer } = await announced(() => createAsAdmin({ origin }), { byAdmin: 1 });
    expect(result.statusCode, result.body).toBe(201);
    const rfq = (result.json() as { data: { id: string } }).data;

    expect(byAdmin).toHaveLength(1);
    expect(byAdmin[0]).toMatchObject({
      rfqId: rfq.id,
      organizationId: TEST_ORGANIZATION_ID,
      adminUserId: TEST_ADMIN_ID,
      origin,
    });
    expect(Object.keys(byAdmin[0] ?? {}).sort()).toEqual(
      ['adminUserId', 'eventId', 'occurredAt', 'organizationId', 'origin', 'rfqId'].sort(),
    );
    expect(byCustomer).toEqual([]);
  });

  it('carries origin: null when the request named none', async () => {
    const { result, byAdmin, byCustomer } = await announced(() => createAsAdmin(), { byAdmin: 1 });
    expect(result.statusCode, result.body).toBe(201);
    expect(byAdmin).toHaveLength(1);
    expect(byAdmin[0]).toHaveProperty('origin', null);
    expect(byCustomer).toEqual([]);
  });

  it('the request is readable by the time the event is announced', async () => {
    let readable: boolean | null = null;
    const off = h.eventBus.on('rfq.created_by_admin.v1' as never, async (payload: unknown) => {
      const { rfqId } = payload as { rfqId: string };
      const lines = await h.em().getConnection().execute<Array<{ id: string }>>(
        `select i."id" from "quote_requests" q
           join "quote_request_items" i on i."quote_request_id" = q."id" where q."id" = ?`,
        [rfqId],
      );
      readable = lines.length > 0;
    });
    try {
      const created = await createAsAdmin();
      expect(created.statusCode, created.body).toBe(201);
      await vi.waitFor(() => expect(readable).not.toBeNull(), { timeout: 10_000, interval: 20 });
    } finally {
      off();
    }
    expect(readable).toBe(true);
  });

  it('answers the same response with and without an origin — it is not stored and not returned', async () => {
    const plain = await createAsAdmin();
    const withOrigin = await createAsAdmin({ origin: { type: 'crm_opportunity', id: randomUUID() } });
    expect(plain.statusCode, plain.body).toBe(201);
    expect(withOrigin.statusCode, withOrigin.body).toBe(201);
    const plainData = (plain.json() as { data: Record<string, unknown> }).data;
    const originData = (withOrigin.json() as { data: Record<string, unknown> }).data;
    expect(Object.keys(originData).sort()).toEqual(Object.keys(plainData).sort());
    expect(JSON.stringify(originData)).not.toContain('crm_opportunity');
  });

  it.each([
    ['an id that is not a uuid', { type: 'crm_opportunity', id: 'not-a-uuid' }],
    ['a missing id', { type: 'crm_opportunity' }],
    ['a type that is not an identifier', { type: 'CRM Opportunity!', id: randomUUID() }],
    ['an unknown key', { type: 'crm_opportunity', id: randomUUID(), organizationId: randomUUID() }],
  ])('refuses %s and announces nothing', async (_label, origin) => {
    const { result, byAdmin } = await announced(() => createAsAdmin({ origin }));
    expect(result.statusCode, result.body).toBe(400);
    expect((result.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    expect(byAdmin).toEqual([]);
  });

  it('announces nothing for a request that is refused', async () => {
    const { result, byAdmin } = await announced(() =>
      createAsAdmin({ customerAccountId: '00000000-0000-4000-8000-00000000ffff' }),
    );
    expect(result.statusCode).toBe(404);
    expect(byAdmin).toEqual([]);
  });

  it('a customer’s submission is still rfq.created.v1 and nothing else, whatever its body smuggles', async () => {
    const { result, byAdmin, byCustomer } = await announced(
      () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/quote-requests',
          cookies: CUSTOMER,
          payload: {
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }],
            origin: { type: 'crm_opportunity', id: randomUUID() },
          },
        }),
      { byCustomer: 1 },
    );
    // The customer's schema is its own and drops what it does not know.
    expect(result.statusCode, result.body).toBe(201);
    expect(byAdmin).toEqual([]);
    expect(byCustomer).toHaveLength(1);
    expect(byCustomer[0]).not.toHaveProperty('origin');
  });
});
