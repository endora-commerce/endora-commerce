import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ADMIN, customerNotificationsOf, drainOutbox, makeOrganizationWithAdmin, setSetting } from './fixtures.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/182-related-payers/` RP-20 (owner, 2026-11-19) — the Phase 5 follow-ups:
 * (a) the daily limit's "today" starts at midnight in the default store's time zone, not UTC;
 * (c) an expired request tells its requester, by e-mail and in the account, from the outbox, and a
 * withdrawn one tells nobody; (d) the payer's list of the buyers it pays for names each buyer's tax ID.
 */
describe('related_payers — RP-20 follow-ups', () => {
  let h: BackendServerHandle;
  let y: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  const mailer = new InMemoryMailer();
  const mailsAbout = (requestId: string) => mailer.sent.filter((m) => m.meta?.['requestId'] === requestId);

  const call = (cookie: Record<string, string>, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: cookie, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const send = (from: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>, taxId = y.taxId) =>
    call(from.cookie, 'POST', '/api/v1/account/related-payers/requests', { taxId, contactEmail: 'rp20@example.com' });

  /** A request row of `organizationId` dated `createdAt`, as if sent then (the count reads `created_at`). */
  async function sentAt(sender: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>, createdAt: Date): Promise<void> {
    const res = await send(sender);
    expect(res.statusCode, res.body).toBe(202);
    await withSystemScope('test: date a payer request', () =>
      h.em().getConnection().execute(`update related_payer_requests set created_at = ? where id = ?`, [createdAt, res.json().data.id]),
    );
  }

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await setSetting(h, 'related_payers.enabled', true);
    y = await makeOrganizationWithAdmin(h.em(), 'RP-20 payer');
  }, 120_000);

  afterEach(async () => {
    await setSetting(h, 'related_payers.daily_request_limit', 10);
    await setSetting(h, 'related_payers.time_zone', 'Europe/Warsaw');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('RP-20 (a): the day of the daily limit starts at midnight in the store time zone, not UTC', async () => {
    // A zone whose midnight is not UTC's at this instant, and a request dated one minute on the
    // other side of it: the store's day and UTC's day disagree about whether it was sent "today".
    const now = new Date();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const hour = now.getUTCHours();
    const minute = 60_000;
    const scenario =
      hour >= 11
        ? // UTC−11: its day began at 11:00 UTC today. 10:59 UTC is yesterday there, today in UTC.
          { zone: 'Pacific/Pago_Pago', at: new Date(utcMidnight + 11 * 3_600_000 - minute), countsToday: false }
        : hour < 10
          ? // UTC+14: its day began at 10:00 UTC yesterday. 10:01 UTC yesterday is today there.
            { zone: 'Pacific/Kiritimati', at: new Date(utcMidnight - 10 * 3_600_000 + minute), countsToday: true }
          : // UTC+14 between 10:00 and 11:00 UTC: its day began at 10:00 UTC today; 09:59 is yesterday there.
            { zone: 'Pacific/Kiritimati', at: new Date(utcMidnight + 10 * 3_600_000 - minute), countsToday: false };
    await setSetting(h, 'related_payers.time_zone', scenario.zone);
    const sender = await makeOrganizationWithAdmin(h.em(), 'RP-20 limited buyer');
    await sentAt(sender, scenario.at);
    await setSetting(h, 'related_payers.daily_request_limit', 1);
    const next = await send(sender);
    if (scenario.countsToday) {
      expect(next.statusCode, next.body).toBe(429);
      expect(next.json().error.code).toBe('RELATED_PAYER_REQUEST_LIMIT');
    } else {
      expect(next.statusCode, next.body).toBe(202);
    }
  });

  it('RP-20 (a): the time zone must be one the runtime knows', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.time_zone/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: 'Mars/Olympus_Mons' },
    });
    expect(res.statusCode, res.body).toBe(422);
  });

  it('RP-20 (c): an expired request tells its requester by e-mail and in the account, after commit', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'RP-20 expiring buyer');
    const res = await send(x);
    const id = res.json().data.id as string;
    await drainOutbox(h);
    await h.em().getConnection().execute(`update related_payer_requests set expires_at = now() - interval '1 minute' where id = ?`, [id]);
    const expiry = h.container.resolve<{ sweep: () => Promise<{ expiredCount: number }> }>('relatedPayerRequestExpiry');
    expect((await expiry.sweep()).expiredCount).toBeGreaterThanOrEqual(1);
    // Nothing is sent inside the sweep's Command: the outbox delivers it.
    expect(mailsAbout(id).filter((m) => m.meta?.['kind'] === 'related_payer_request_expired')).toHaveLength(0);
    await drainOutbox(h);
    const expired = mailsAbout(id).filter((m) => m.meta?.['kind'] === 'related_payer_request_expired');
    expect(expired.map((m) => m.to)).toEqual([x.email]);
    const entries = await customerNotificationsOf(h.em(), x.customerAccountId);
    expect(entries.find((e) => e.subject_id === id)).toMatchObject({ kind: 'related_payers.request_expired' });
    // Y — who was asked — is not told of the expiry.
    expect(expired.map((m) => m.to)).not.toContain(y.email);
  });

  it('RP-20 (c): a withdrawn request tells nobody', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'RP-20 withdrawing buyer');
    const id = (await send(x)).json().data.id as string;
    await drainOutbox(h);
    const before = mailsAbout(id).length;
    const withdrawn = await call(x.cookie, 'POST', `/api/v1/account/related-payers/requests/${id}/withdraw`);
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    await drainOutbox(h);
    expect(mailsAbout(id)).toHaveLength(before);
    const told = [
      ...(await customerNotificationsOf(h.em(), x.customerAccountId)),
      ...(await customerNotificationsOf(h.em(), y.customerAccountId)),
    ].filter((e) => e.subject_id === id && e.kind !== 'related_payers.request_received');
    expect(told).toEqual([]);
  });

  it('RP-20 (d): the payer\'s list of buyers names each buyer\'s tax ID', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'RP-20 paid-for buyer');
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${x.organizationId}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: y.organizationId },
    });
    expect(link.statusCode, link.body).toBe(201);
    const payees = await call(y.cookie, 'GET', '/api/v1/account/payees');
    expect(payees.statusCode, payees.body).toBe(200);
    const row = (payees.json().data as Array<{ organizationId: string; taxId: string | null }>).find(
      (l) => l.organizationId === x.organizationId,
    );
    expect(row?.taxId).toBe(x.taxId);
    // The admin shape names both, for either list.
    const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${y.organizationId}/related-payers`, cookies: ADMIN });
    expect((admin.json().data.asPayer as Array<{ buyerTaxId: string | null }>)[0]?.buyerTaxId).toBe(x.taxId);
  });
});
