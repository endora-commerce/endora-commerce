import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, RFQ_CREATED_BY_ADMIN_EVENT, type QuoteRequestCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #1824 (`specs/186-aggregate-ports/` T066, FR-004, FR-005) —
 * `quoteRequestCommandPort` from a worker: no administrator, the system scope.
 * An integration creates a quote for a customer, prices a request the customer
 * submitted and approves it. Every write is audited with the `system` actor —
 * there is no `automation` actor kind (D-293.6) — and the integration's
 * `source` code beside it; the history names the writer `System`; the buyer is
 * notified and the events are emitted as on the admin routes.
 */
describe('quoteRequestCommandPort from a worker (withSystemScope)', () => {
  let h: BackendServerHandle;
  let port: QuoteRequestCommandPort;
  let channelId: string;
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const offs: Array<() => void> = [];

  const sql = <T>(query: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(query, params);
  const inWorker = <T>(fn: () => Promise<T>) => withSystemScope('test: an ERP integration worker', fn);

  async function entries(id: string): Promise<AuditLogEntry[]> {
    h.em().clear();
    return h.em().find(AuditLogEntry, { objectType: 'quote_request', objectId: id }, { orderBy: { actedAt: 'asc' } });
  }

  const history = (id: string) =>
    sql<{ event_type: string; actor_admin_user_id: string | null; actor_role_label: string | null }>(
      `select event_type, actor_admin_user_id, actor_role_label from quote_request_events where quote_request_id = ?`,
      [id],
    );
  const notifications = async (id: string) =>
    (await sql<{ n: number }>(`select count(*)::int as n from quote_request_notifications where quote_request_id = ?`, [id]))[0]!.n;

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<QuoteRequestCommandPort>('quoteRequestCommandPort');
    for (const name of [RFQ_CREATED_BY_ADMIN_EVENT, 'rfq.modified.v1', 'rfq.approved.v1']) {
      offs.push(
        h.eventBus.on(name as never, ((payload: Record<string, unknown>) => {
          events.push({ name, payload });
        }) as never),
      );
    }
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    // The channel the customer's request landed on: one of the Organization's active channels.
    const probe = (res.json() as { data: { id: string } }).data.id;
    const rows = await sql<{ sales_channel_id: string }>(`select sales_channel_id from quote_requests where id = ?`, [probe]);
    channelId = rows[0]!.sales_channel_id;
  }, 60_000);

  afterAll(async () => {
    for (const off of offs) off();
    await teardownBackendServer(h);
  });

  it('creates a quote for a customer as the system, naming the integration', async () => {
    const record = await inWorker(() =>
      port.create(
        {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: channelId,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 12 }],
        },
        { source: 'erp' },
      ),
    );

    expect(record).toMatchObject({
      status: 'Created from admin',
      customerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: channelId,
      createdByAdminUserId: null,
      assignedAdminUserId: null,
      awaitingCustomerRevisionAcceptance: true,
    });
    const [entry, ...more] = await entries(record.id);
    expect(more).toEqual([]);
    expect(entry?.actorAdminUserId ?? null).toBeNull();
    expect(entry).toMatchObject({
      action: 'quote_request.create_on_behalf',
      stateAfter: { status: 'Created from admin', itemCount: 1, salesChannelId: channelId, source: 'erp' },
    });
    expect((await history(record.id)).map((e) => [e.event_type, e.actor_admin_user_id, e.actor_role_label]).sort()).toEqual([
      ['created', null, 'System'],
      ['note-added', null, 'System'],
    ]);
    expect(await notifications(record.id)).toBeGreaterThan(0);
    await expect
      .poll(() => events.filter((e) => e.payload['rfqId'] === record.id).map((e) => [e.name, e.payload['adminUserId']]))
      .toEqual([[RFQ_CREATED_BY_ADMIN_EVENT, null]]);
  });

  it('refuses a create that names no channel: a worker has no request to resolve one from', async () => {
    const before = (await sql<{ n: number }>(`select count(*)::int as n from quote_requests`))[0]!.n;
    await expect(
      inWorker(() =>
        port.create({
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.RFQ_SALES_CHANNEL_NOT_ALLOWED });
    expect((await sql<{ n: number }>(`select count(*)::int as n from quote_requests`))[0]!.n).toBe(before);
  });

  it('prices a submitted request and approves it as the system, notifying the buyer', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const submitted = (res.json() as { data: { id: string; version: number } }).data;
    const told = await notifications(submitted.id);

    const revised = await inWorker(() =>
      port.update(
        submitted.id,
        { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 11 }] },
        { expectedVersion: submitted.version, source: 'erp' },
      ),
    );
    const approved = await inWorker(() => port.approve(revised.id, {}, { expectedVersion: revised.version, source: 'erp' }));

    expect(approved).toMatchObject({ status: 'Approved', assignedAdminUserId: null, version: submitted.version + 2 });
    // The customer's own submission (`quote_request.create`) is the first entry.
    const written = (await entries(submitted.id))
      .filter((e) => e.action !== 'quote_request.create')
      .map((e) => [e.action, e.actorAdminUserId ?? null, e.stateAfter?.['source']]);
    expect(written).toEqual([
      ['quote_request.modify', null, 'erp'],
      ['quote_request.approve', null, 'erp'],
    ]);
    expect(await notifications(submitted.id)).toBeGreaterThan(told);
    await expect
      .poll(() => events.filter((e) => e.payload['rfqId'] === submitted.id).map((e) => e.name))
      .toEqual(['rfq.modified.v1', 'rfq.approved.v1']);
  });
});
