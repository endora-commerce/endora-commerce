import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ADMIN, customerNotificationsOf, drainOutbox, makeAddress, makeOrganizationWithAdmin } from './fixtures.js';

/**
 * `specs/182-related-payers/` T071 (US4; FR-040, FR-042, FR-045, FR-047, FR-119) — a buyer asks a
 * payer by tax ID; the payer's approvers see it and decide; acceptance creates the link on the
 * buyer's terms; one decision wins; the sender withdraws a pending one; a rejection's reason is
 * the sender's to read.
 */
describe('related_payers — payer requests (US4)', () => {
  let h: BackendServerHandle;
  let x: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  let y: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  const mailer = new InMemoryMailer();
  const mailsOf = (requestId: string, kind: string) =>
    mailer.sent.filter((m) => m.meta?.['requestId'] === requestId && m.meta?.['kind'] === kind);

  const call = (cookie: Record<string, string>, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: cookie, ...(payload !== undefined ? { payload: payload as object } : {}) });

  async function request(comment = 'Please pay for our orders') {
    const res = await call(x.cookie, 'POST', '/api/v1/account/related-payers/requests', {
      taxId: y.taxId,
      contactEmail: 'payer-contact@example.com',
      comment,
    });
    expect(res.statusCode, res.body).toBe(202);
    return res.json().data.id as string;
  }

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    const enabled = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    x = await makeOrganizationWithAdmin(h.em(), 'Requesting buyer');
    y = await makeOrganizationWithAdmin(h.em(), 'Requested payer');
    await makeAddress(h.em(), y.organizationId, 'billing');
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('US4-1: the request reaches Y\'s approver; the sender sees only `pending`', async () => {
    const id = await request();
    const incoming = await call(y.cookie, 'GET', '/api/v1/account/related-payers/incoming');
    expect(incoming.statusCode, incoming.body).toBe(200);
    expect((incoming.json().data as Array<{ id: string; senderOrganizationId: string }>).find((r) => r.id === id)).toMatchObject({
      senderOrganizationId: x.organizationId,
    });
    const sent = await call(x.cookie, 'GET', '/api/v1/account/related-payers/requests');
    const row = (sent.json().data as Array<Record<string, unknown>>).find((r) => r['id'] === id)!;
    expect(row).toMatchObject({ state: 'pending', taxId: y.taxId });
    for (const hidden of ['counterpartyOrganizationId', 'routing', 'operatorReason']) expect(row).not.toHaveProperty(hidden);
  });

  it('US4-2: Y accepts — a link on the buyer\'s terms; a second decision loses with 409', async () => {
    const id = await request();
    const accepted = await call(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const again = await call(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/reject`, {});
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().error.code).toBe('RELATED_PAYER_REQUEST_DECIDED');
    const links = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${x.organizationId}/related-payers`, cookies: ADMIN });
    expect((links.json().data.asBuyer as Array<{ payerOrganizationId: string; commercialTerms: string; origin: string }>)[0]).toMatchObject({
      payerOrganizationId: y.organizationId,
      commercialTerms: 'buyer',
      origin: 'request',
    });
    const sent = await call(x.cookie, 'GET', '/api/v1/account/related-payers/requests');
    expect((sent.json().data as Array<{ id: string; state: string }>).find((r) => r.id === id)?.state).toBe('active');
  });

  it('US4-3: concurrent decisions — exactly one wins', async () => {
    // A fresh pair: the link above already exists for X → Y.
    const x2 = await makeOrganizationWithAdmin(h.em(), 'Racing buyer');
    const sent = await call(x2.cookie, 'POST', '/api/v1/account/related-payers/requests', { taxId: y.taxId, contactEmail: 'c@example.com' });
    expect(sent.statusCode, sent.body).toBe(202);
    const id = sent.json().data.id as string;
    const [a, b] = await Promise.all([
      call(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`),
      call(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/reject`, { reason: 'No' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it('US4-4: Y rejects with a reason the sender reads; the sender withdraws another', async () => {
    const x3 = await makeOrganizationWithAdmin(h.em(), 'Rejected buyer');
    const send = async () => {
      const res = await call(x3.cookie, 'POST', '/api/v1/account/related-payers/requests', { taxId: y.taxId, contactEmail: 'c@example.com' });
      expect(res.statusCode, res.body).toBe(202);
      return res.json().data.id as string;
    };
    const rejected = await send();
    expect((await call(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${rejected}/reject`, { reason: 'We do not know you' })).statusCode).toBe(200);
    const withdrawn = await send();
    expect((await call(x3.cookie, 'POST', `/api/v1/account/related-payers/requests/${withdrawn}/withdraw`)).statusCode).toBe(200);
    const list = (await call(x3.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<{
      id: string;
      state: string;
      rejectionReason: string | null;
    }>;
    expect(list.find((r) => r.id === rejected)).toMatchObject({ state: 'rejected', rejectionReason: 'We do not know you' });
    expect(list.find((r) => r.id === withdrawn)?.state).toBe('withdrawn');
  });

  it('US4-2 (FR-042): once the outbox drains, Y\'s approver is told by e-mail and in the account; the contact e-mail never', async () => {
    // A buyer not yet linked to Y: X is, since US4-2's acceptance, so Y is no longer eligible for it.
    const x6 = await makeOrganizationWithAdmin(h.em(), 'Notifying buyer');
    const res = await call(x6.cookie, 'POST', '/api/v1/account/related-payers/requests', {
      taxId: y.taxId,
      contactEmail: 'payer-contact@example.com',
    });
    expect(res.statusCode, res.body).toBe(202);
    const id = res.json().data.id as string;
    // Nothing is sent inside the request: the reply does not wait on, or vary with, a message (FR-041).
    expect(mailsOf(id, 'related_payer_request_received')).toHaveLength(0);
    await drainOutbox(h);
    const received = mailsOf(id, 'related_payer_request_received');
    expect(received.map((m) => m.to)).toEqual([y.email]);
    expect(mailer.sent.filter((m) => m.to === 'payer-contact@example.com')).toHaveLength(0);
    const entries = await customerNotificationsOf(h.em(), y.customerAccountId);
    expect(entries.find((e) => e.subject_id === id)).toMatchObject({ kind: 'related_payers.request_received' });
    // At-least-once delivery is deduplicated: a second drain sends nothing more.
    await drainOutbox(h);
    expect(mailsOf(id, 'related_payer_request_received')).toHaveLength(1);
  });

  it('US4-3: on Y\'s decision X\'s requester and payer managers are told, by e-mail and in the account', async () => {
    const x4 = await makeOrganizationWithAdmin(h.em(), 'Told buyer');
    const sent = await call(x4.cookie, 'POST', '/api/v1/account/related-payers/requests', { taxId: y.taxId, contactEmail: 'c@example.com' });
    const id = sent.json().data.id as string;
    expect((await call(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`)).statusCode).toBe(200);
    await drainOutbox(h);
    const decided = mailsOf(id, 'related_payer_request_decided');
    expect(decided.map((m) => m.to)).toEqual([x4.email]);
    const entries = await customerNotificationsOf(h.em(), x4.customerAccountId);
    expect(entries.find((e) => e.subject_id === id)).toMatchObject({ kind: 'related_payers.request_decided' });
  });

  it('US4-8 (FR-045, FR-102): an overdue pending request expires in the sweep, as the system actor', async () => {
    const x5 = await makeOrganizationWithAdmin(h.em(), 'Expiring buyer');
    const sent = await call(x5.cookie, 'POST', '/api/v1/account/related-payers/requests', { taxId: y.taxId, contactEmail: 'c@example.com' });
    const id = sent.json().data.id as string;
    await h.em().getConnection().execute(`update related_payer_requests set expires_at = now() - interval '1 minute' where id = ?`, [id]);
    const expiry = h.container.resolve<{ sweep: () => Promise<{ expiredCount: number }> }>('relatedPayerRequestExpiry');
    expect((await expiry.sweep()).expiredCount).toBeGreaterThanOrEqual(1);
    const list = (await call(x5.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<{ id: string; state: string }>;
    expect(list.find((r) => r.id === id)?.state).toBe('expired');
    // System actor: neither an operator nor a customer is recorded.
    const entries = (await h.em().getConnection().execute(
      `select actor_admin_user_id, actor_customer_account_id from audit_log_entries
        where object_id = ? and action = 'related_payers.request.expire'`,
      [id],
    )) as Array<{ actor_admin_user_id: string | null; actor_customer_account_id: string | null }>;
    expect(entries).toEqual([{ actor_admin_user_id: null, actor_customer_account_id: null }]);
    const incoming = (await call(y.cookie, 'GET', '/api/v1/account/related-payers/incoming')).json().data as Array<{ id: string }>;
    expect(incoming.map((r) => r.id)).not.toContain(id);
  });

  it('FR-119: a customer request cannot carry commercial terms', async () => {
    const res = await call(x.cookie, 'POST', '/api/v1/account/related-payers/requests', {
      taxId: y.taxId,
      contactEmail: 'c@example.com',
      commercialTerms: 'payer',
    });
    expect(res.statusCode).toBe(400);
  });
});
