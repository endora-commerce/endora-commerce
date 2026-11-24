import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  ADMIN_COOKIES,
  CUSTOMER_COOKIES,
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { moveAccountToOrganization } from '../../helpers/seed-organization-roles.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const QR = '/api/v1/admin/quote-requests';
const DAY_MS = 86_400_000;

/**
 * `specs/192-quote-request-draft-share/` T019 — **Share with customer**
 * (`POST /api/v1/admin/quote-requests/:id/share`, `contracts/admin-api.md` §1)
 * against the composed module.
 *
 * The share runs on the Command Bus, which forks its own transaction, so every
 * row here commits. A share flips the row, writes the `shared` history entry,
 * the `quote_request.share` audit row and the three `prepared` records on that
 * entry, which the delivery worker then closes once (FR-021 – FR-024, SC-002);
 * the validity date counts from the share (FR-032). Every refusal leaves the
 * quote unshared with nothing recorded (FR-025 – FR-027), and two shares at
 * once share it once (FR-024).
 */
describe('Share with customer', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const cookies: string[] = [];
  const admins: string[] = [];

  const scalar = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await h.em().fork().execute<Array<{ n: string }>>(sql, params))[0]!.n);
  const records = (id: string, extra = '') =>
    scalar(`select count(*) as "n" from "quote_request_notifications" where "quote_request_id" = ? ${extra}`, [id]);
  const eventsOf = (id: string, type: string) =>
    scalar(`select count(*) as "n" from "quote_request_events" where "quote_request_id" = ? and "event_type" = ?`, [id, type]);
  const audits = (id: string) =>
    scalar(`select count(*) as "n" from "audit_log_entries" where "object_id" = ? and "action" = 'quote_request.share'`, [id]);
  const row = async (id: string) =>
    (
      await h
        .em()
        .fork()
        .execute<
          Array<{ shared_with_customer: boolean; shared_at: Date | null; shared_by_admin_user_id: string | null; expires_at: Date | null; version: number }>
        >(`select "shared_with_customer", "shared_at", "shared_by_admin_user_id", "expires_at", "version" from "quote_requests" where "id" = ?`, [id])
    )[0]!;

  async function draft(
    options: { customerAccountId?: string; organizationId?: string; items?: Array<Record<string, unknown>>; expiresInDays?: number | null } = {},
  ): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: QR,
      cookies: ADMIN,
      payload: {
        organizationId: options.organizationId ?? TEST_ORGANIZATION_ID,
        customerAccountId: options.customerAccountId ?? TEST_CUSTOMER_ID,
        items: options.items ?? [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 12.5 }],
        ...(options.expiresInDays !== undefined ? { expiresInDays: options.expiresInDays } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const data = (res.json() as { data: { id: string; version: number; sharedWithCustomer: boolean } }).data;
    expect(data.sharedWithCustomer).toBe(false);
    return data;
  }

  const share = (id: string, as: Record<string, string> = ADMIN, headers: Record<string, string> = {}, payload?: unknown) =>
    h.app.inject({
      method: 'POST',
      url: `${QR}/${id}/share`,
      cookies: as,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  /** An account of `organizationId` behind a cookie of its own. */
  async function account(organizationId = TEST_ORGANIZATION_ID): Promise<{ id: string; cookies: Record<string, string> }> {
    const em = h.em();
    const created = em.create(CustomerAccount, {
      organizationId,
      email: `192-share-${stamp}-${randomUUID().slice(0, 6)}@share.example`,
      passwordHash: 'x',
      firstName: 'Share',
      lastName: 'Test',
    });
    await em.persistAndFlush(created);
    const cookie = `stub-192-share-${created.id.slice(0, 8)}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: created.id, organizationId };
    cookies.push(cookie);
    return { id: created.id, cookies: { b2b_session: cookie } };
  }

  async function expectRefused(
    id: string,
    res: { statusCode: number; body: string; json(): unknown },
    statusCode: number,
    code: string,
  ): Promise<{ details?: unknown }> {
    expect(res.statusCode, res.body).toBe(statusCode);
    const { error } = res.json() as { error: { code: string; details?: unknown } };
    expect(error.code).toBe(code);
    expect(await records(id)).toBe(0);
    expect(await eventsOf(id, 'shared')).toBe(0);
    expect(await audits(id)).toBe(0);
    return error;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    for (const cookie of cookies) delete CUSTOMER_COOKIES[cookie];
    for (const cookie of admins) delete ADMIN_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  it('shares: the row, one `shared` entry, one audit row, three `prepared` records on it — delivered once', async () => {
    const quote = await draft();
    const before = Date.now();
    const res = await share(quote.id);
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ sharedWithCustomer: true, sharedByAdminUserId: TEST_ADMIN_ID, version: quote.version + 1 });
    expect(Date.parse(data['sharedAt'] as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(res.headers['etag']).toBe(`"${quote.version + 1}"`);

    const events = await h
      .em()
      .fork()
      .execute<Array<{ id: string; actor_admin_user_id: string | null; revision_id: string | null }>>(
        `select "id", "actor_admin_user_id", "revision_id" from "quote_request_events" where "quote_request_id" = ? and "event_type" = 'shared'`,
        [quote.id],
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.actor_admin_user_id).toBe(TEST_ADMIN_ID);
    const current = await h
      .em()
      .fork()
      .execute<Array<{ id: string }>>(
        `select r."id" from "quote_request_revisions" r join "quote_requests" q on q."id" = r."quote_request_id"
          where q."id" = ? and r."revision_number" = q."current_revision_number"`,
        [quote.id],
      );
    expect(events[0]!.revision_id).toBe(current[0]!.id);
    expect(await audits(quote.id)).toBe(1);

    const named = await h
      .em()
      .fork()
      .execute<Array<{ change: string; channel: string; source_event_id: string }>>(
        `select "change", "channel", "source_event_id" from "quote_request_notifications" where "quote_request_id" = ?`,
        [quote.id],
      );
    expect(named).toHaveLength(3);
    expect(new Set(named.map((n) => n.change))).toEqual(new Set(['prepared']));
    expect(new Set(named.map((n) => n.channel))).toEqual(new Set(['customer_email', 'customer_in_app', 'customer_push']));
    expect(new Set(named.map((n) => n.source_event_id))).toEqual(new Set([events[0]!.id]));

    const delivery = (h.container.resolve('quoteRequests') as {
      handle(): { deliveryService: { deliverInScope(now?: Date): Promise<unknown> } };
    }).handle().deliveryService;
    await withSystemScope('192 share test: deliver', () => delivery.deliverInScope());
    await withSystemScope('192 share test: deliver again', () => delivery.deliverInScope());
    expect(await records(quote.id, `and "status" = 'pending'`)).toBe(0);
    expect(await records(quote.id)).toBe(3);
  });

  it('the customer then lists it and accepts it; another shared quote is rejected', async () => {
    const accepted = await draft();
    const rejected = await draft();
    expect((await share(accepted.id)).statusCode).toBe(200);
    expect((await share(rejected.id)).statusCode).toBe(200);

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/quote-requests', cookies: CUSTOMER });
    expect((list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual(
      expect.arrayContaining([accepted.id, rejected.id]),
    );

    for (const [id, action, status] of [
      [accepted.id, 'accept-revision', 'Approved'],
      [rejected.id, 'reject-revision', 'Canceled'],
    ] as const) {
      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: CUSTOMER });
      expect(detail.statusCode).toBe(200);
      const revision = (detail.json() as { data: { currentRevisionNumber: number } }).data.currentRevisionNumber;
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${id}/${action}`,
        cookies: CUSTOMER,
        payload: { expectedRevisionNumber: revision },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { status: string } }).data.status).toBe(status);
    }
  });

  it('a quote edited while unshared: the customer’s history starts at the share; the operator keeps every entry (FR-012)', async () => {
    const quote = await draft();
    const edited = await h.app.inject({
      method: 'PATCH',
      url: `${QR}/${quote.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${quote.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 11 }] },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await share(quote.id)).statusCode).toBe(200);

    const customer = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${quote.id}`, cookies: CUSTOMER });
    const customerEvents = (customer.json() as { data: { events: Array<{ eventType: string }> } }).data.events;
    expect(customerEvents.map((e) => e.eventType)).toEqual(['shared']);

    const admin = await h.app.inject({ method: 'GET', url: `${QR}/${quote.id}`, cookies: ADMIN });
    const adminEvents = (admin.json() as { data: { events: Array<{ eventType: string }> } }).data.events;
    expect(adminEvents.map((e) => e.eventType)).toEqual(['created', 'note-added', 'modified', 'shared']);

    const history = await h.app.inject({ method: 'GET', url: `${QR}/${quote.id}/history`, cookies: ADMIN });
    const entries = (history.json() as { data: { entries: Array<{ kind: string; deliveries?: unknown[] }> } }).data.entries;
    expect(entries.map((e) => e.kind)).toEqual(['created_by_admin', 'modified', 'shared']);
    expect(entries.at(-1)!.deliveries).toHaveLength(3);
  });

  it('a draft created with an unpriced line, then priced, shares (FR-013)', async () => {
    const quote = await draft({ items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }] });
    const priced = await h.app.inject({
      method: 'PATCH',
      url: `${QR}/${quote.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${quote.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 7 }] },
    });
    expect(priced.statusCode, priced.body).toBe(200);
    expect((await share(quote.id)).statusCode).toBe(200);
  });

  it('the validity date is the share moment plus the days; no days, no date (FR-032)', async () => {
    const dated = await draft({ expiresInDays: 10 });
    const before = Date.now();
    const res = await share(dated.id);
    const after = Date.now();
    const expiresAt = Date.parse((res.json() as { data: { expiresAt: string } }).data.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 10 * DAY_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 10 * DAY_MS + 1000);

    const undated = await draft();
    expect(((await share(undated.id)).json() as { data: { expiresAt: string | null } }).data.expiresAt).toBeNull();
  });

  it('an unpriced line: 409 QUOTE_INCOMPLETE `share`, naming the line; nothing recorded (FR-026)', async () => {
    const quote = await draft({
      items: [
        { productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 5 },
        { productId: SEED_PRODUCT_101_ID, quantity: 2 },
      ],
    });
    const error = await expectRefused(quote.id, await share(quote.id), 409, 'QUOTE_INCOMPLETE');
    const details = error.details as { code: string; lines: Array<{ productName: string; groupName: string | null }> };
    expect(details.code).toBe('share');
    expect(details.lines).toHaveLength(1);
    expect(details.lines[0]).toMatchObject({ groupName: null });
    expect(details.lines[0]!.productName).toEqual(expect.any(String));
    expect((await row(quote.id)).shared_with_customer).toBe(false);
  });

  it('an unavailable customer: not_member, inactive, blocked — the quote stays a draft (FR-027)', async () => {
    const em = h.em();
    const other = em.create(Organization, {
      name: `192 share other ${stamp}`,
      taxId: `PL192SH${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(other);
    await bindOrganizationsToFixtureChannelsSql(em, [other.id]);

    const moved = await account();
    const movedQuote = await draft({ customerAccountId: moved.id });
    await moveAccountToOrganization(em, moved.id, other.id);

    const deleted = await account();
    const deletedQuote = await draft({ customerAccountId: deleted.id });
    await em.getConnection().execute(`update "customer_accounts" set "deleted_at" = now() where "id" = ?`, [deleted.id]);

    const blocked = await account();
    const blockedQuote = await draft({ customerAccountId: blocked.id });
    await em.getConnection().execute(`update "customer_accounts" set "blocked_at" = now() where "id" = ?`, [blocked.id]);

    for (const [quote, token] of [
      [movedQuote, 'not_member'],
      [deletedQuote, 'inactive'],
      [blockedQuote, 'blocked'],
    ] as const) {
      const error = await expectRefused(quote.id, await share(quote.id), 409, 'RFQ_SHARE_CUSTOMER_UNAVAILABLE');
      expect(error.details).toEqual({ code: token });
      expect((await row(quote.id)).shared_with_customer).toBe(false);
    }
  });

  it('a cancelled draft: 409 RFQ_NOT_QUOTED', async () => {
    const quote = await draft();
    const cancelled = await h.app.inject({ method: 'POST', url: `${QR}/${quote.id}/cancel`, cookies: ADMIN, payload: {} });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    await expectRefused(quote.id, await share(quote.id), 409, 'RFQ_NOT_QUOTED');
  });

  it('already shared, a legacy operator quote, a customer submission: 409 RFQ_ALREADY_SHARED (FR-025)', async () => {
    const quote = await draft();
    expect((await share(quote.id)).statusCode).toBe(200);
    const again = await share(quote.id);
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: { code: string } }).error.code).toBe('RFQ_ALREADY_SHARED');
    expect(await records(quote.id)).toBe(3);
    expect(await eventsOf(quote.id, 'shared')).toBe(1);

    // An operator quote created before the feature: shared by the column's default.
    const legacy = await draft();
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set "shared_with_customer" = true where "id" = ?`, [legacy.id]);
    await expectRefused(legacy.id, await share(legacy.id), 409, 'RFQ_ALREADY_SHARED');

    const submitted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    const submittedId = (submitted.json() as { data: { id: string } }).data.id;
    const before = await records(submittedId);
    const res = await share(submittedId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('RFQ_ALREADY_SHARED');
    expect(await records(submittedId)).toBe(before);
  });

  it('a stale If-Match: 409 VERSION_CONFLICT; the current one shares', async () => {
    const quote = await draft();
    await expectRefused(quote.id, await share(quote.id, ADMIN, { 'if-match': `"${quote.version + 7}"` }), 409, 'VERSION_CONFLICT');
    expect((await share(quote.id, ADMIN, { 'if-match': `"${quote.version}"` })).statusCode).toBe(200);
  });

  it('a sales representative not assigned to the Organization: 404, as an unknown quote', async () => {
    const quote = await draft();
    const session = `stub-192-share-rep-${stamp}`;
    await withSystemScope('192 share test: a representative of another organisation', async () => {
      const em = h.orm.em.fork();
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) role = em.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: ['rfqs:handle'] });
      else role.permissions = Array.from(new Set([...role.permissions, 'rfqs:handle']));
      await em.persistAndFlush(role);
      const elsewhere = em.create(Organization, {
        name: `192 share rep ${stamp}`,
        taxId: `PL192RP${String(stamp).slice(-7)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      });
      const rep = em.create(AdminUser, {
        email: `192-share-rep-${stamp}@share.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '192',
        lastName: 'rep',
      });
      await em.persistAndFlush([elsewhere, rep]);
      await em.persistAndFlush([
        em.create(OrganizationSalesRepAssignment, { organizationId: elsewhere.id, adminUserId: rep.id }),
        // The quote's Organization is governed by somebody else.
        em.create(OrganizationSalesRepAssignment, { organizationId: TEST_ORGANIZATION_ID, adminUserId: TEST_ADMIN_ID }),
      ]);
      ADMIN_COOKIES[session] = { adminUserId: rep.id };
      admins.push(session);
    });
    try {
      const unknown = await share(randomUUID(), { b2b_session: session });
      const res = await share(quote.id, { b2b_session: session });
      await expectRefused(quote.id, res, 404, 'NOT_FOUND');
      expect(unknown.statusCode).toBe(404);
    } finally {
      await h
        .em()
        .getConnection()
        .execute(`delete from "organization_sales_rep_assignments" where "organization_id" = ? and "admin_user_id" = ?`, [
          TEST_ORGANIZATION_ID,
          TEST_ADMIN_ID,
        ]);
    }
  });

  it('two shares at once: one 200, one 409 RFQ_ALREADY_SHARED, three records in all (FR-024)', async () => {
    const quote = await draft();
    const results = await Promise.all([share(quote.id), share(quote.id)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const refused = results.find((r) => r.statusCode === 409)!;
    expect((refused.json() as { error: { code: string } }).error.code).toBe('RFQ_ALREADY_SHARED');
    expect(await records(quote.id)).toBe(3);
    expect(await eventsOf(quote.id, 'shared')).toBe(1);
    expect(await audits(quote.id)).toBe(1);
  });
});
