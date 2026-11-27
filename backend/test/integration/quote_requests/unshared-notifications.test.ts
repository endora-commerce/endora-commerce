import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { markUnsharedForTest } from '../../helpers/quote-request-share.js';

const ADMIN = { b2b_session: 'stub-admin-session' };

/**
 * `specs/192-quote-request-draft-share/` T013, T014 — an unshared quote is
 * silent (FR-005) and fully editable (FR-008): every admin edit and the admin
 * cancel record their history entry and audit row, and **no** customer
 * notification record (amendment R-A1). Its validity is kept as days, applied
 * at the share (R-10, FR-032): `0` and `null` mean no deadline, and no date is
 * written while it is unshared.
 */
describe('an unshared quote: edits and cancel are recorded, nobody is told', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const scalar = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await h.em().fork().execute<Array<{ n: string }>>(sql, params))[0]!.n);
  const records = (id: string) =>
    scalar(`select count(*) as "n" from "quote_request_notifications" where "quote_request_id" = ?`, [id]);
  const eventsOf = (id: string, type: string) =>
    scalar(`select count(*) as "n" from "quote_request_events" where "quote_request_id" = ? and "event_type" = ?`, [id, type]);
  const auditsOf = (id: string, action: string) =>
    scalar(`select count(*) as "n" from "audit_log_entries" where "object_id" = ? and "action" = ?`, [id, action]);
  const row = async (id: string) =>
    (
      await h
        .em()
        .fork()
        .execute<Array<{ share_validity_days: number | null; expires_at: Date | null; status: string; version: number }>>(
          `select "share_validity_days", "expires_at", "status", "version" from "quote_requests" where "id" = ?`,
          [id],
        )
    )[0]!;

  async function unsharedQuote(): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = (res.json() as { data: { id: string } }).data;
    await markUnsharedForTest(h.em(), id);
    // Records the create may have written before it was made unshared are not this test's subject.
    await h.em().fork().execute(`delete from "quote_request_notifications" where "quote_request_id" = ?`, [id]);
    return { id, version: Number((await row(id)).version) };
  }

  async function patch(id: string, version: number, payload: Record<string, unknown>) {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${version}"` },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { version: number; expiresAt: string | null; shareValidityDays?: number | null } }).data;
  }

  it('lines, prices, groups, note, days and custom fields: a history entry and an audit row each, no record', async () => {
    const quote = await unsharedQuote();
    let version = quote.version;
    const edits: Array<Record<string, unknown>> = [
      { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 10 }] },
      { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 12.5 }] },
      {
        groups: [{ key: 'g', name: 'Hall A' }],
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 12.5, groupKey: 'g' }],
      },
      { headerNote: 'Prepared over two calls.' },
      { expiresInDays: 30 },
      { customFieldValues: {} },
    ];
    for (const edit of edits) version = (await patch(quote.id, version, edit)).version;

    expect(await eventsOf(quote.id, 'modified')).toBe(edits.length);
    expect(await auditsOf(quote.id, 'quote_request.modify')).toBe(edits.length);
    expect(await records(quote.id)).toBe(0);
  });

  it('cancel: the entry and the audit row, no record, and the quote stays unshared', async () => {
    const quote = await unsharedQuote();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${quote.id}/cancel`,
      cookies: ADMIN,
      payload: { reason: 'Customer went quiet.' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await row(quote.id)).status).toBe('Canceled');
    expect(await eventsOf(quote.id, 'canceled')).toBe(1);
    expect(await auditsOf(quote.id, 'quote_request.cancel')).toBe(1);
    expect(await records(quote.id)).toBe(0);
    const shared = await scalar(
      `select count(*) as "n" from "quote_requests" where "id" = ? and "shared_with_customer"`,
      [quote.id],
    );
    expect(shared).toBe(0);
  });

  it('validity days: a number is kept, 0 and null clear it, absent keeps it; no date is written', async () => {
    const quote = await unsharedQuote();
    let version = quote.version;

    let reply = await patch(quote.id, version, { expiresInDays: 14 });
    version = reply.version;
    expect(reply.expiresAt).toBeNull();
    expect(reply.shareValidityDays).toBe(14);
    expect(await row(quote.id)).toMatchObject({ share_validity_days: 14, expires_at: null });

    reply = await patch(quote.id, version, { headerNote: 'no days in this body' });
    version = reply.version;
    expect((await row(quote.id)).share_validity_days).toBe(14);

    reply = await patch(quote.id, version, { expiresInDays: 0 });
    version = reply.version;
    expect(await row(quote.id)).toMatchObject({ share_validity_days: null, expires_at: null });

    reply = await patch(quote.id, version, { expiresInDays: 7 });
    version = reply.version;
    reply = await patch(quote.id, version, { expiresInDays: null });
    expect(await row(quote.id)).toMatchObject({ share_validity_days: null, expires_at: null });

    const payloads = await h
      .em()
      .fork()
      .execute<Array<{ payload: { validityDays?: { before: number | null; after: number | null } } }>>(
        `select "payload" from "quote_request_events" where "quote_request_id" = ? and "event_type" = 'modified' order by "created_at", "id"`,
        [quote.id],
      );
    expect(payloads.map((p) => p.payload.validityDays ?? 'unchanged')).toEqual([
      { before: null, after: 14 },
      'unchanged',
      { before: 14, after: null },
      { before: null, after: 7 },
      { before: 7, after: null },
    ]);
    expect(await records(quote.id)).toBe(0);
  });

  // Owner decision of 2026-11-24 — `0` (or empty) is no deadline on a shared
  // quote too, never "expires now"; the offer stays acceptable. An operator
  // closes an offer by cancelling it.
  it('a shared quote revised with 0 days, or none, has no deadline and stays acceptable', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id, version } = (res.json() as { data: { id: string; version: number } }).data;

    const dated = await patch(id, version, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 4 }], expiresInDays: 7 });
    expect(dated.expiresAt).not.toBeNull();
    const cleared = await patch(id, dated.version, { expiresInDays: 0 });
    expect(cleared.expiresAt).toBeNull();
    const again = await patch(id, cleared.version, { expiresInDays: 7 });
    expect(again.expiresAt).not.toBeNull();
    const emptied = await patch(id, again.version, { expiresInDays: null });
    expect(emptied.expiresAt).toBeNull();
    expect((await row(id)).expires_at).toBeNull();

    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: { b2b_session: 'stub-customer-session' } });
    const revision = (detail.json() as { data: { currentRevisionNumber: number } }).data.currentRevisionNumber;
    const accepted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: revision },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((accepted.json() as { data: { status: string } }).data.status).toBe('Approved');
  });
});
