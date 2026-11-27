import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type QuoteRequestCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry, ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * Issue #1824 (`specs/186-aggregate-ports/` T065,
 * `contracts/quote-request-command-port.md`) — `quoteRequestCommandPort` runs
 * the Command the admin route for the same operation runs. Each case does the
 * same thing twice, once through the route and once through the port under the
 * same administrator, on two requests in the same state, and holds the two
 * results to each other: one audit entry with the same action, object type,
 * actor and state; the same history entries under the same name and label; the
 * same notification records; the same domain event, once.
 *
 * Then the port's own additions — `source` beside the state, an invalid code
 * refused before anything is written, an unclaimed extension refused — and its
 * off state: with `quote_requests` off it cannot be resolved, and nothing is
 * written.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const QR = '/api/v1/admin/quote-requests';

interface HistoryRow {
  event_type: string;
  actor_admin_user_id: string | null;
  actor_role_label: string | null;
}

interface Written {
  readonly audit: Array<{
    action: string;
    objectType: string;
    actorAdminUserId: string | null | undefined;
    stateBefore: Record<string, unknown> | null | undefined;
    stateAfter: Record<string, unknown> | null | undefined;
  }>;
  readonly history: Array<{ eventType: string; actorAdminUserId: string | null; actorRoleLabel: string | null }>;
  readonly notifications: number;
}

describe('quoteRequestCommandPort — the admin routes’ Commands (#1824)', () => {
  let h: BackendServerHandle;
  let port: QuoteRequestCommandPort;
  let channelId: string;
  const emitted: Array<{ name: string; rfqId: unknown }> = [];
  const offs: Array<() => void> = [];

  const sql = <T>(query: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(query, params);
  const asAdmin = <T>(fn: () => Promise<T>) => withSystemScopeActingFor(TEST_ADMIN_ID, 'test: quote request command port', fn);

  async function written(id: string, actions?: readonly string[]): Promise<Written> {
    h.em().clear();
    const audit = (await h.em().find(AuditLogEntry, { objectType: 'quote_request', objectId: id }, { orderBy: { actedAt: 'asc' } }))
      .filter((entry) => !actions || actions.includes(entry.action))
      .map(({ action, objectType, actorAdminUserId, stateBefore, stateAfter }) => ({
        action,
        objectType,
        actorAdminUserId,
        stateBefore,
        stateAfter,
      }));
    const history = await sql<HistoryRow>(
      `select event_type, actor_admin_user_id, actor_role_label from quote_request_events where quote_request_id = ? order by created_at, id`,
      [id],
    );
    const counted = await sql<{ n: number }>(`select count(*)::int as n from quote_request_notifications where quote_request_id = ?`, [id]);
    return {
      audit,
      // The entries one write appends share its transaction: compared as a set, in name order.
      history: history
        .map((row) => ({ eventType: row.event_type, actorAdminUserId: row.actor_admin_user_id, actorRoleLabel: row.actor_role_label }))
        .sort((x, y) => x.eventType.localeCompare(y.eventType)),
      notifications: counted[0]!.n,
    };
  }

  /** What one write added: the entries of `after` that `before` did not have. */
  function added(before: Written, after: Written): Written {
    const seen = [...before.history];
    return {
      audit: after.audit.slice(before.audit.length),
      history: after.history.filter((entry) => {
        const i = seen.findIndex((old) => JSON.stringify(old) === JSON.stringify(entry));
        if (i === -1) return true;
        seen.splice(i, 1);
        return false;
      }),
      notifications: after.notifications - before.notifications,
    };
  }

  const eventsFor = (id: string) => emitted.filter((event) => event.rfqId === id).map((event) => event.name);

  /** A Pending request as the customer submits it: no agreed price on its line. */
  async function pending(): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  /** A Pending request the operator priced through the route — the only kind `approve` takes. */
  async function priced(): Promise<{ id: string; version: number }> {
    const created = await pending();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `${QR}/${created.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${created.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9 }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  const createBody = () => ({
    organizationId: TEST_ORGANIZATION_ID,
    customerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: channelId,
    headerNote: 'Prepared for you',
    items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 7.5 }],
    expiresInDays: 14,
  });

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: new InMemoryMailer() });
    port = h.container.resolve<QuoteRequestCommandPort>('quoteRequestCommandPort');
    for (const name of ['rfq.created_by_admin.v1', 'rfq.modified.v1', 'rfq.approved.v1', 'rfq.canceled.v1']) {
      offs.push(
        h.eventBus.on(name as never, ((payload: { rfqId?: unknown }) => {
          emitted.push({ name, rfqId: payload.rfqId });
        }) as never),
      );
    }
    // The channel a customer's request lands on: one of the Organization's active channels.
    const probe = await pending();
    const rows = await sql<{ sales_channel_id: string }>(`select sales_channel_id from quote_requests where id = ?`, [probe.id]);
    channelId = rows[0]!.sales_channel_id;
  }, 60_000);

  afterAll(async () => {
    for (const off of offs) off();
    await teardownBackendServer(h);
  });

  it('create runs quote_request.create_on_behalf exactly as POST …/quote-requests does', async () => {
    const res = await h.app.inject({ method: 'POST', url: QR, cookies: ADMIN, payload: createBody() });
    expect(res.statusCode, res.body).toBe(201);
    const viaRoute = (res.json() as { data: { id: string } }).data.id;
    const record = await asAdmin(() => port.create(createBody()));

    expect(record).toMatchObject({
      status: 'Created from admin',
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: channelId,
      createdByAdminUserId: TEST_ADMIN_ID,
      headerNote: 'Prepared for you',
      // `specs/192-quote-request-draft-share/` — unshared, the days kept until the share.
      sharedWithCustomer: false,
      expiresAt: null,
    });
    const route = await written(viaRoute);
    const viaPort = await written(record.id);
    expect(viaPort).toEqual(route);
    expect(route.notifications).toBe(0);
    expect(route.audit).toHaveLength(1);
    expect(route.audit[0]).toMatchObject({ action: 'quote_request.create_on_behalf', actorAdminUserId: TEST_ADMIN_ID });
    expect(route.history.map((e) => e.eventType)).toEqual(['created', 'note-added']);
    await expect.poll(() => eventsFor(record.id)).toEqual(['rfq.created_by_admin.v1']);
    expect(eventsFor(viaRoute)).toEqual(['rfq.created_by_admin.v1']);
  });

  it('update runs quote_request.modify exactly as PATCH …/:id does, and honours expectedVersion', async () => {
    const [a, b] = [await pending(), await pending()];
    const patch = { headerNote: 'Revised', items: [{ productId: SEED_PRODUCT_101_ID, quantity: 6, agreedUnitPrice: 8 }] };
    const [beforeA, beforeB] = [await written(a.id), await written(b.id)];

    const res = await h.app.inject({ method: 'PATCH', url: `${QR}/${a.id}`, cookies: ADMIN, headers: { 'if-match': `"${a.version}"` }, payload: patch });
    expect(res.statusCode, res.body).toBe(200);
    await expect(asAdmin(() => port.update(b.id, patch, { expectedVersion: b.version - 1 }))).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
    });
    const record = await asAdmin(() => port.update(b.id, patch, { expectedVersion: b.version }));

    expect(record).toMatchObject({ currentRevisionNumber: 2, awaitingCustomerRevisionAcceptance: true, version: b.version + 1 });
    const route = added(beforeA, await written(a.id));
    expect(added(beforeB, await written(b.id))).toEqual(route);
    expect(route.audit.map((e) => e.action)).toEqual(['quote_request.modify']);
    expect(route.history.map((e) => e.eventType)).toEqual(['modified']);
    expect(route.notifications).toBeGreaterThan(0);
    await expect.poll(() => eventsFor(b.id)).toEqual(['rfq.modified.v1']);
  });

  it('approve runs quote_request.approve exactly as POST …/:id/approve does', async () => {
    const [a, b] = [await priced(), await priced()];
    const [beforeA, beforeB] = [await written(a.id), await written(b.id)];

    const res = await h.app.inject({ method: 'POST', url: `${QR}/${a.id}/approve`, cookies: ADMIN, payload: { note: 'Agreed' } });
    expect(res.statusCode, res.body).toBe(200);
    const record = await asAdmin(() => port.approve(b.id, { note: 'Agreed' }));

    expect(record.status).toBe('Approved');
    const route = added(beforeA, await written(a.id));
    expect(added(beforeB, await written(b.id))).toEqual(route);
    expect(route.audit).toEqual([
      expect.objectContaining({ action: 'quote_request.approve', stateBefore: { status: 'Pending' }, stateAfter: { status: 'Approved' } }),
    ]);
    expect(route.history.map((e) => e.eventType)).toEqual(['approved', 'note-added']);
    expect(route.notifications).toBeGreaterThan(0);
    await expect.poll(() => eventsFor(b.id)).toEqual(['rfq.modified.v1', 'rfq.approved.v1']);
    expect(eventsFor(a.id)).toEqual(['rfq.modified.v1', 'rfq.approved.v1']);
  });

  it('cancel runs quote_request.cancel exactly as POST …/:id/cancel does', async () => {
    const [a, b] = [await pending(), await pending()];
    const [beforeA, beforeB] = [await written(a.id), await written(b.id)];

    const res = await h.app.inject({ method: 'POST', url: `${QR}/${a.id}/cancel`, cookies: ADMIN, payload: { reason: 'S1824 out of stock' } });
    expect(res.statusCode, res.body).toBe(200);
    const record = await asAdmin(() => port.cancel(b.id, { reason: 'S1824 out of stock' }));

    expect(record).toMatchObject({ status: 'Canceled', cancellationReason: 'S1824 out of stock' });
    const route = added(beforeA, await written(a.id));
    expect(added(beforeB, await written(b.id))).toEqual(route);
    expect(route.audit).toEqual([
      // No before-state: the entry carries the after-state alone, as the hand audit did.
      expect.objectContaining({ action: 'quote_request.cancel', stateAfter: { status: 'Canceled', hasReason: true } }),
    ]);
    await expect.poll(() => eventsFor(b.id)).toEqual(['rfq.canceled.v1']);
  });

  it('assign runs quote_request.assign exactly as POST …/:id/assign does, and clears with null', async () => {
    const [a, b] = [await pending(), await pending()];
    const [beforeA, beforeB] = [await written(a.id), await written(b.id)];

    const res = await h.app.inject({ method: 'POST', url: `${QR}/${a.id}/assign`, cookies: ADMIN, payload: { adminUserId: TEST_ADMIN_ID } });
    expect(res.statusCode, res.body).toBe(200);
    const record = await asAdmin(() => port.assign(b.id, { adminUserId: TEST_ADMIN_ID }));

    expect(record.assignedAdminUserId).toBe(TEST_ADMIN_ID);
    const route = added(beforeA, await written(a.id));
    expect(added(beforeB, await written(b.id))).toEqual(route);
    expect(route).toEqual({
      audit: [expect.objectContaining({ action: 'quote_request.assign', stateAfter: { assignedAdminUserId: TEST_ADMIN_ID } })],
      history: [],
      notifications: 0,
    });

    const cleared = await asAdmin(() => port.assign(b.id, { adminUserId: null }));
    expect(cleared.assignedAdminUserId).toBeNull();
  });

  it('assign refuses a target who may not handle quote requests with 422 RFQ_ASSIGNEE_NOT_ELIGIBLE, on the route and the port alike (#1906)', async () => {
    // `stub-restricted-admin-session`'s administrator: active, `orders:read` only.
    const restricted = '00000000-0000-4000-8000-0000000000b2';
    const unknown = '00000000-0000-4000-8000-00000019060f';
    const [a, b] = [await pending(), await pending()];
    const [beforeA, beforeB] = [await written(a.id), await written(b.id)];

    for (const target of [restricted, unknown]) {
      const res = await h.app.inject({ method: 'POST', url: `${QR}/${a.id}/assign`, cookies: ADMIN, payload: { adminUserId: target } });
      expect(res.statusCode, res.body).toBe(422);
      const error = (res.json() as { error: { code: string; message: string } }).error;
      expect(error.code).toBe(ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE);
      // The operator's sentence, not the buyer's (`submission`).
      expect(error.message).toContain('Choose another administrator');
      await expect(asAdmin(() => port.assign(b.id, { adminUserId: target }))).rejects.toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE,
      });
    }
    // Nothing written: no entry, no version moved.
    expect(added(beforeA, await written(a.id))).toEqual({ audit: [], history: [], notifications: 0 });
    expect(added(beforeB, await written(b.id))).toEqual({ audit: [], history: [], notifications: 0 });
    const versions = await sql<{ version: number }>(`select version from quote_requests where id in (?, ?) order by id`, [a.id, b.id]);
    expect(versions.map((row) => Number(row.version)).sort()).toEqual([a.version, b.version].sort());
  });

  it('sendDocument runs quote_request.send_document exactly as POST …/:id/pdf/send does', async () => {
    const [a, b] = [await priced(), await priced()];
    const [beforeA, beforeB] = [await written(a.id), await written(b.id)];

    const res = await h.app.inject({
      method: 'POST',
      url: `${QR}/${a.id}/pdf/send`,
      cookies: ADMIN,
      payload: { recipients: ['buyer-1824@example.com'], language: 'en' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = await asAdmin(() => port.sendDocument(b.id, { recipients: ['buyer-1824@example.com'], language: 'en' }));

    expect(result).toEqual((res.json() as { data: unknown }).data);
    const route = added(beforeA, await written(a.id));
    expect(added(beforeB, await written(b.id))).toEqual(route);
    expect(route.audit.map((e) => e.action)).toEqual(['quote_request.send_document']);
    expect(route.history.map((e) => e.eventType)).toEqual(['pdf-sent']);
  });

  it('setCustomFieldValues stores the merge’s answer as quote_request.custom_fields.update, the keys and never the values', async () => {
    const quote = await pending();
    const before = await written(quote.id);
    const record = await asAdmin(() =>
      port.setCustomFieldValues(quote.id, async (current) => ({ ...current, s1824_ref: 'S1824-VALUE' }), { source: 'erp' }),
    );
    expect(record.customFieldValues).toMatchObject({ s1824_ref: 'S1824-VALUE' });
    expect(record.version).toBe(quote.version + 1);
    const { audit, history, notifications } = added(before, await written(quote.id));
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'quote_request.custom_fields.update',
        actorAdminUserId: TEST_ADMIN_ID,
        stateAfter: { changedCustomFields: ['s1824_ref'], source: 'erp' },
      }),
    ]);
    expect(JSON.stringify(audit)).not.toContain('S1824-VALUE');
    // No revision, no history entry, nobody told.
    expect(history).toEqual([]);
    expect(notifications).toBe(0);
  });

  it('records the caller’s source beside the actor, and refuses an invalid one before anything is written', async () => {
    const quote = await priced();
    await expect(asAdmin(() => port.approve(quote.id, {}, { source: 'Not A Code' }))).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect((await written(quote.id, ['quote_request.approve'])).audit).toEqual([]);

    await asAdmin(() => port.approve(quote.id, {}, { source: 'm3.connector' }));
    expect((await written(quote.id, ['quote_request.approve'])).audit).toEqual([
      expect.objectContaining({ stateAfter: { status: 'Approved', source: 'm3.connector' } }),
    ]);
  });

  it('refuses an extension no hook module claims, before anything is written', async () => {
    const quote = await pending();
    await expect(asAdmin(() => port.cancel(quote.id, { reason: null }, { extensions: { nobody: {} } }))).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
    });
    const [stored] = await sql<{ status: string }>(`select status from quote_requests where id = ?`, [quote.id]);
    expect(stored?.status).toBe('Pending');
    expect((await written(quote.id, ['quote_request.cancel'])).audit).toEqual([]);
  });

  it('cannot be resolved while quote_requests is off, so nothing is written — and is back after', async () => {
    const quote = await pending();
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const attempt = withSystemScope('test: quote request command port off', async () =>
        h.container.resolve<QuoteRequestCommandPort>('quoteRequestCommandPort').cancel(quote.id, { reason: null }),
      );
      await expect(attempt).rejects.toBeInstanceOf(ModuleDisabledError);
    });
    const [stored] = await sql<{ status: string }>(`select status from quote_requests where id = ?`, [quote.id]);
    expect(stored?.status).toBe('Pending');
    expect((await written(quote.id, ['quote_request.cancel'])).audit).toEqual([]);

    const record = await withSystemScope('test: quote request command port on again', () =>
      h.container.resolve<QuoteRequestCommandPort>('quoteRequestCommandPort').cancel(quote.id, { reason: null }),
    );
    expect(record.status).toBe('Canceled');
  });
});
