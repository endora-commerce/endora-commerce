import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  quoteRequestHistorySchema,
  type QuoteRequestHistory,
  type QuoteRequestHistoryEntry,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { ADMIN_COOKIES, TEST_ADMIN_ID, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { bindOrganizationToDefaultChannel } from '../../helpers/sales-channel-access.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * T068 — Quote Request change history.
 *
 * Verifies that every state transition writes one row to
 * quote_request_events, that the chronology is preserved on read,
 * and that field-level diffs land in modify-event payloads.
 */
describe('Quote Requests — change history (US6)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function getEvents(rfqId: string): Promise<Array<{ eventType: string; payload: Record<string, unknown> }>> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${rfqId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    return (
      res.json() as { data: { events: Array<{ eventType: string; payload: Record<string, unknown> }> } }
    ).data.events;
  }

  it('logs created + submitted on customer create', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice: 7.5 }],
      },
    });
    const id = (created.json() as { data: { id: string } }).data.id;
    const events = await getEvents(id);
    expect(events.map((e) => e.eventType)).toEqual(['created', 'submitted']);
  });

  it('logs the full Pending → modified → Approved chain through the negotiation loop', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 10, desiredUnitPrice: 8 }] },
    });
    const r = (created.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${r.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 10, agreedUnitPrice: 7.8 }] },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const cur = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${r.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: cur.currentRevisionNumber },
    });
    const events = await getEvents(r.id);
    const types = events.map((e) => e.eventType);
    expect(types).toEqual([
      'created',
      'submitted',
      'modified',
      'customer-accepted-revision',
      'approved',
    ]);
  });

  it('logs canceled with the reason in the payload', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    const r = (created.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${r.id}/cancel`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${r.version}"` },
      payload: { reason: 'Out of stock' },
    });
    const events = await getEvents(r.id);
    const cancel = events.find((e) => e.eventType === 'canceled');
    expect(cancel).toBeDefined();
    expect(cancel?.payload).toMatchObject({ reason: 'Out of stock' });
  });

  it('writes a non-empty diff array on modify events', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }] },
    });
    const r = (created.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${r.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 7, agreedUnitPrice: 9.99 }] },
    });
    const events = await getEvents(r.id);
    const modify = events.find((e) => e.eventType === 'modified');
    expect(modify).toBeDefined();
    const diff = (modify?.payload as { diff: Array<{ kind: string }> }).diff;
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.map((d) => d.kind)).toContain('line_quantity');
  });
});

/**
 * Feature 146, Phase 8 (T052) — `GET /api/v1/admin/quote-requests/:id/history`:
 * merged entries, attributed actors and the extended diff computed on read
 * (FR-010 – FR-019, FR-036; research R7, R8; SC-002).
 */
describe('146 — readable history: content [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  type Item = { id: string; productId: string; customerProposedUnitPrice?: number | null };
  type Detail = { id: string; version: number; currentRevisionNumber: number; expiresAt: string | null; items: Item[] };

  const create = async (items: Array<Record<string, unknown>>, headerNote?: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: { items, ...(headerNote !== undefined ? { headerNote } : {}) },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };

  const detail = async (id: string): Promise<Detail> => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${id}`, cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Detail }).data;
  };

  const modify = async (id: string, payload: Record<string, unknown>) => {
    const { version } = await detail(id);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: admin,
      headers: { 'if-match': `"${version}"` },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  const customerPatch = async (id: string, payload: Record<string, unknown>) => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/quote-requests/${id}`,
      cookies: customer,
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  const history = async (id: string): Promise<QuoteRequestHistory> => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${id}/history`, cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: QuoteRequestHistory };
    // The wire carries exactly what the contract promises, at every depth.
    expect(disagreements(deepStrict(quoteRequestHistorySchema), body.data)).toEqual([]);
    return body.data;
  };

  const ADMIN_ACTOR = { kind: 'admin', adminUserId: TEST_ADMIN_ID, name: 'Plat Admin', recordedRole: 'Platform administrator' };
  const CUSTOMER_ACTOR = {
    kind: 'customer',
    customerAccountId: TEST_CUSTOMER_ID,
    name: 'Stub Customer',
    email: 'stub-customer@example.com',
    recordedRole: 'Customer',
  };

  it('submitted, revised three times by a rep and accepted reads as five attributed entries (US2 #2–#4, #6; US1 #9; SC-002)', async () => {
    const id = await create(
      [
        { productId: SEED_PRODUCT_101_ID, quantity: 10, desiredUnitPrice: 100, lineNote: 'urgent' },
        { productId: SEED_PRODUCT_102_ID, quantity: 5, desiredUnitPrice: 50 },
      ],
      'Initial note',
    );
    const lines = (await detail(id)).items;
    const p = lines.find((l) => l.productId === SEED_PRODUCT_101_ID)!;
    const r = lines.find((l) => l.productId === SEED_PRODUCT_102_ID)!;

    // 1 — prices only (US1 #9): nothing but the two agreed prices may be listed.
    await modify(id, {
      items: [
        { id: p.id, productId: SEED_PRODUCT_101_ID, quantity: 10, agreedUnitPrice: 110 },
        { id: r.id, productId: SEED_PRODUCT_102_ID, quantity: 5, agreedUnitPrice: 55 },
      ],
    });
    // 2 — price and quantity of P (US2 #2).
    await modify(id, {
      items: [
        { id: p.id, productId: SEED_PRODUCT_101_ID, quantity: 12, agreedUnitPrice: 105 },
        { id: r.id, productId: SEED_PRODUCT_102_ID, quantity: 5, agreedUnitPrice: 55 },
      ],
    });
    // 3 — removal of R and a new validity (US2 #3, #4).
    const beforeValidity = (await detail(id)).expiresAt;
    const p2 = (await detail(id)).items.find((l) => l.productId === SEED_PRODUCT_101_ID)!;
    await modify(id, {
      items: [{ id: p2.id, productId: SEED_PRODUCT_101_ID, quantity: 12, agreedUnitPrice: 105 }],
      expiresInDays: 45,
    });
    const afterRevisions = await detail(id);

    // SC-002 / M6 — the customer's original proposal survives three revisions.
    expect(afterRevisions.items).toHaveLength(1);
    expect(afterRevisions.items[0]?.customerProposedUnitPrice).toBe(100);

    const accepted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/accept-revision`,
      cookies: customer,
      payload: { expectedRevisionNumber: afterRevisions.currentRevisionNumber },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    const { entries, truncated } = await history(id);
    expect(truncated).toBe(false);
    expect(entries.map((e) => e.kind)).toEqual(['submitted', 'modified', 'modified', 'modified', 'accepted_by_customer']);
    expect(entries.map((e) => e.eventIds.length)).toEqual([2, 1, 1, 1, 2]);
    expect(entries.map((e) => e.actor)).toEqual([CUSTOMER_ACTOR, ADMIN_ACTOR, ADMIN_ACTOR, ADMIN_ACTOR, CUSTOMER_ACTOR]);
    expect(entries.map((e) => e.revisionNumber)).toEqual([1, 2, 3, 4, 4]);

    const P = { productId: SEED_PRODUCT_101_ID, variantId: null, variantLabel: null };
    const R = { productId: SEED_PRODUCT_102_ID, variantId: null, variantLabel: null };
    expect(entries[1]?.changes).toEqual([
      { kind: 'line_agreed_unit_price', line: expect.objectContaining(P), before: null, after: 110, currency: 'PLN' },
      { kind: 'line_agreed_unit_price', line: expect.objectContaining(R), before: null, after: 55, currency: 'PLN' },
    ]);
    expect(entries[2]?.changes).toEqual([
      { kind: 'line_quantity', line: expect.objectContaining(P), before: 10, after: 12 },
      { kind: 'line_agreed_unit_price', line: expect.objectContaining(P), before: 110, after: 105, currency: 'PLN' },
    ]);
    const afterValidity = afterRevisions.expiresAt;
    expect(afterValidity).not.toBeNull();
    expect(afterValidity).not.toBe(beforeValidity);
    expect(entries[3]?.changes).toEqual([
      { kind: 'line_removed', line: expect.objectContaining(R) },
      { kind: 'validity', before: beforeValidity, after: afterValidity },
    ]);
    expect(entries[0]?.changes).toBeNull();
    expect(entries[4]?.changes).toBeNull();
  });

  it('a customer draft edit before any revision is one customer `modified` entry; a quantity-only edit lists only the quantity (US2 #4a, US1 #10)', async () => {
    const id = await create([{ productId: SEED_PRODUCT_101_ID, quantity: 10, desiredUnitPrice: 100, lineNote: 'urgent' }]);
    await customerPatch(id, {
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 10, desiredUnitPrice: 95, lineNote: 'not urgent' }],
    });
    await customerPatch(id, {
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 14, desiredUnitPrice: 95, lineNote: 'not urgent' }],
    });

    const { entries } = await history(id);
    expect(entries.map((e) => e.kind)).toEqual(['submitted', 'modified', 'modified']);
    expect(entries[1]?.actor).toEqual(CUSTOMER_ACTOR);
    const P = expect.objectContaining({ productId: SEED_PRODUCT_101_ID, variantId: null });
    expect(entries[1]?.changes).toEqual([
      { kind: 'line_proposed_unit_price', line: P, before: 100, after: 95, currency: 'PLN' },
      { kind: 'line_note', line: P, before: 'urgent', after: 'not urgent' },
    ]);
    expect(entries[2]?.changes).toEqual([{ kind: 'line_quantity', line: P, before: 10, after: 14 }]);
  });

  it('a pre-release modification (no validity in its event) still lists its line changes (US2 #8)', async () => {
    const id = await create([{ productId: SEED_PRODUCT_101_ID, quantity: 3 }]);
    await modify(id, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 9 }], expiresInDays: 20 });
    await h
      .em()
      .getConnection()
      .execute(
        `update "quote_request_events" set payload = payload - 'validity' where quote_request_id = ? and event_type = 'modified'`,
        [id],
      );
    const { entries } = await history(id);
    const modified = entries.find((e) => e.kind === 'modified');
    expect(modified?.changes?.map((c) => c.kind)).toEqual(['line_quantity', 'line_agreed_unit_price']);
  });

  it('a modification that changes the validity records it in the event payload (research R7)', async () => {
    const id = await create([{ productId: SEED_PRODUCT_101_ID, quantity: 3 }]);
    await modify(id, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 9 }], expiresInDays: 10 });
    await modify(id, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 9 }] });
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select payload from "quote_request_events" where quote_request_id = ? and event_type = 'modified' order by created_at`,
        [id],
      )) as Array<{ payload: Record<string, unknown> }>;
    expect(rows).toHaveLength(2);
    const validity = rows[0]?.payload['validity'] as { before: unknown; after: unknown } | undefined;
    expect(Object.keys(validity ?? {}).sort()).toEqual(['after', 'before']);
    expect(typeof validity?.after).toBe('string');
    // No `expiresInDays` sent — nothing changed, nothing recorded.
    expect(rows[1]?.payload).not.toHaveProperty('validity');
  });
});

/**
 * Feature 146, Phase 8 (T052a) — authority and bounds (threat model C1, T9;
 * FR-018, FR-019).
 */
describe('146 — readable history: authority and bounds [integration]', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const admin = { b2b_session: 'stub-admin-session' };
  let outsiderCookie: string;
  let strangerOrgId: string;
  let strangerAccountId: string;
  let deletedAccountId: string;
  let strangerRfqId: string;

  const newOrganization = (em: EntityManager, suffix: string): Organization =>
    em.create(Organization, {
      name: `146 history org ${suffix}`,
      taxId: `PL146H${suffix}${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('146 T052a: a stranger organization, its rep, an outsider rep and a deleted customer', async () => {
      const em = h.orm.em.fork();
      const stranger = newOrganization(em, 'S');
      const own = newOrganization(em, 'O');
      await em.persistAndFlush([stranger, own]);
      strangerOrgId = stranger.id;
      const role = em.create(AdminRole, {
        code: `history-rep-${stamp}`,
        name: '146 history rep',
        permissions: ['rfqs:handle'],
      });
      await em.persistAndFlush(role);
      const owner = em.create(AdminUser, {
        email: `146-history-owner-${stamp}@h.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '146',
        lastName: 'Owner',
      });
      const outsider = em.create(AdminUser, {
        email: `146-history-outsider-${stamp}@h.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '146',
        lastName: 'Outsider',
      });
      await em.persistAndFlush([owner, outsider]);
      await em.persistAndFlush([
        em.create(OrganizationSalesRepAssignment, { organizationId: stranger.id, adminUserId: owner.id }),
        em.create(OrganizationSalesRepAssignment, { organizationId: own.id, adminUserId: outsider.id }),
      ]);
      const account = em.create(CustomerAccount, {
        organizationId: stranger.id,
        email: `146-history-buyer-${stamp}@h.local`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Active',
        lastName: 'Buyer',
        // The role held is the one the platform judges
        // (`specs/170-organization-roles/`); the legacy `role` is dual-written.
        organizationRoleId: await predefinedRoleIdOf(em, stranger.id, 'administrator'),
      });
      const gone = em.create(CustomerAccount, {
        organizationId: stranger.id,
        email: `146-history-gone-${stamp}@h.local`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Deleted',
        lastName: 'Buyer',
        deletedAt: new Date(),
      });
      await em.persistAndFlush([account, gone]);
      strangerAccountId = account.id;
      deletedAccountId = gone.id;
      outsiderCookie = `stub-146-history-outsider-${stamp}`;
      ADMIN_COOKIES[outsiderCookie] = { adminUserId: outsider.id };
    });
    // The admin request below names no channel, so it is raised on the system
    // default, which `createOnBehalf` accepts only for an Organization assigned
    // to it (feature 163, owner decision 2026-10-29 "A").
    await bindOrganizationToDefaultChannel(h, strangerOrgId);

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: admin,
      payload: {
        organizationId: strangerOrgId,
        customerAccountId: strangerAccountId,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    strangerRfqId = (created.json() as { data: { id: string } }).data.id;
  }, 60_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[outsiderCookie];
    await teardownBackendServer(h);
  });

  /** An error body without its per-request id. */
  const errorOf = (res: { json: () => unknown }) => {
    const { error } = res.json() as { error: Record<string, unknown> };
    const { requestId: _requestId, ...rest } = error;
    return rest;
  };

  const get = (id: string, cookies?: Record<string, string>) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${id}/history`, ...(cookies ? { cookies } : {}) });

  const sql = (query: string, params: unknown[]) => h.em().getConnection().execute(query, params);

  it('no session → 401; a customer session → 401/403', async () => {
    expect((await get(strangerRfqId)).statusCode).toBe(401);
    expect([401, 403]).toContain((await get(strangerRfqId, { b2b_session: 'stub-customer-session' })).statusCode);
  });

  it('a sales representative outside the request\'s organization gets the same 404 and body as an unknown id (C1)', async () => {
    const foreign = await get(strangerRfqId, { b2b_session: outsiderCookie });
    const unknown = await get('00000000-0000-4000-8000-00000000ffff', { b2b_session: outsiderCookie });
    expect(unknown.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
    expect(errorOf(foreign)).toEqual(errorOf(unknown));
    // The detail route answers the same way — no existence leak beside it.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${strangerRfqId}`,
      cookies: { b2b_session: outsiderCookie },
    });
    expect(detail.statusCode).toBe(404);
    expect(errorOf(detail)).toEqual(errorOf(unknown));
    // And the platform administrator reads it.
    expect((await get(strangerRfqId, admin)).statusCode).toBe(200);
  });

  it('an admin-created request is one `created_by_admin` entry; a deleted customer actor is "unknown user" (FR-018)', async () => {
    await sql(
      `insert into "quote_request_events" (id, quote_request_id, event_type, actor_customer_account_id, actor_role_label, payload, created_at)
       values (gen_random_uuid(), ?, 'note-added', ?, 'Customer', '{"type":"note-added","note":"from the active buyer"}'::jsonb, now() + interval '1 second'),
              (gen_random_uuid(), ?, 'note-added', ?, 'Customer', '{"type":"note-added","note":"from the deleted buyer"}'::jsonb, now() + interval '2 seconds')`,
      [strangerRfqId, strangerAccountId, strangerRfqId, deletedAccountId],
    );
    const res = await get(strangerRfqId, admin);
    expect(res.statusCode, res.body).toBe(200);
    const { entries } = (res.json() as { data: QuoteRequestHistory }).data;
    expect(entries.map((e) => [e.kind, e.note])).toEqual([
      ['created_by_admin', null],
      ['note_added', 'from the active buyer'],
      ['note_added', 'from the deleted buyer'],
    ]);
    expect(entries[1]?.actor).toMatchObject({ kind: 'customer', name: 'Active Buyer' });
    expect(entries[2]?.actor).toEqual({
      kind: 'customer',
      customerAccountId: deletedAccountId,
      name: null,
      email: null,
      recordedRole: 'Customer',
    });
    expect(res.body).not.toContain(`146-history-gone-${stamp}`);
    // T9 — an admin actor carries no e-mail key, and no admin e-mail is on the wire.
    const adminActors = entries.map((e) => e.actor).filter((a) => a.kind === 'admin');
    expect(adminActors.length).toBeGreaterThan(0);
    for (const actor of adminActors) expect(actor).not.toHaveProperty('email');
    expect(res.body).not.toContain('platform-admin@example.com');
  });

  it('answers the most recent 100 events and `truncated: true` once a 101st exists', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    const id = (created.json() as { data: { id: string } }).data.id;
    const firstEventId = (
      (await sql(
        `select id from "quote_request_events" where quote_request_id = ? and event_type = 'created'`,
        [id],
      )) as Array<{ id: string }>
    )[0]!.id;
    const addNotes = (from: number, to: number) =>
      sql(
        `insert into "quote_request_events" (id, quote_request_id, event_type, actor_role_label, payload, created_at)
         select gen_random_uuid(), ?, 'note-added', 'System', jsonb_build_object('type', 'note-added', 'note', 'n' || g), now() + g * interval '1 millisecond' + interval '1 second'
           from generate_series(?::int, ?::int) g`,
        [id, from, to],
      );

    // 2 + 98 = exactly 100 events: everything, not truncated.
    await addNotes(1, 98);
    let res = await get(id, admin);
    let body = (res.json() as { data: QuoteRequestHistory }).data;
    expect(body.truncated).toBe(false);
    expect(body.entries.flatMap((e: QuoteRequestHistoryEntry) => e.eventIds)).toHaveLength(100);

    // The 101st: the oldest drops out of the window and the reply says so.
    await addNotes(99, 99);
    res = await get(id, admin);
    body = (res.json() as { data: QuoteRequestHistory }).data;
    expect(body.truncated).toBe(true);
    const eventIds = body.entries.flatMap((e: QuoteRequestHistoryEntry) => e.eventIds);
    expect(eventIds).toHaveLength(100);
    expect(eventIds).not.toContain(firstEventId);
    expect(body.entries[0]?.kind).toBe('submitted');
    expect(body.entries.at(-1)?.note).toBe('n99');
  });
});
