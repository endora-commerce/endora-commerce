import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { returnFormConfigSchema } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, resetReturnGraph } from '../../integration/returns/helpers.js';
import { allowOffPlatform } from '../../integration/returns/off-platform-fixtures.js';
import { overrideReturnsSetting } from '../../integration/returns/notification-jobs.js';

/**
 * `specs/180-off-platform-complaints/` T072, customer-api.md §C1 (D-1, D-11, D-12,
 * research R-21): what the returns form needs, for the request's channel and language.
 */
describe('GET /api/v1/returns/form-config', () => {
  let h: BackendServerHandle;
  let undo: () => Promise<void>;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    undo = await allowOffPlatform(h);
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/clauses',
      cookies: ADMIN_COOKIE,
      payload: { label: { en: 'Terms', pl: 'Warunki' }, text: { en: 'Text', pl: 'Tekst' }, appliesTo: 'complaint', linkUrl: { pl: 'https://shop.example/pl' } },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/clauses',
      cookies: ADMIN_COOKIE,
      payload: { label: { en: 'Returns' }, text: { en: 'Only returns' }, appliesTo: 'return' },
    });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await undo();
    await teardownBackendServer(h);
  });

  const config = async (qs = '', language = 'en') => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/returns/form-config${qs}`,
      cookies: CUSTOMER_COOKIE,
      headers: { 'x-sales-channel': 'default', 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return returnFormConfigSchema.parse((res.json() as { data: unknown }).data);
  };

  it('answers the channel’s toggles, the limits and the clauses of the kind in the request language', async () => {
    const data = await config('?kind=complaint', 'pl');
    expect(data.offPlatformComplaintsEnabled).toBe(true);
    expect(data.proofOfPurchaseRequired).toBe(false);
    expect(data.attachmentLimits).toEqual({
      maxFileBytes: 10 * 1024 * 1024,
      maxSubmissionBytes: 30 * 1024 * 1024,
      maxFilesPerCase: 10,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    });
    expect(data.clauses).toHaveLength(1);
    expect(data.clauses[0]).toMatchObject({ label: 'Warunki', text: 'Tekst', mode: 'must_accept', linkUrl: 'https://shop.example/pl' });
    expect((await config('?kind=return')).clauses.map((c) => c.label)).toEqual(['Returns']);
    // Without a kind: the complaint's.
    expect((await config()).clauses.map((c) => c.label)).toEqual(['Terms']);
  });

  it('follows the confirmation e-mail’s active flag (D-11)', async () => {
    expect((await config()).confirmationEmailEnabled).toBe(true);
    const knex = h.em().getKnex();
    await knex('transactional_emails').where({ code: 'return_submitted' }).update({ active: false });
    try {
      expect((await config()).confirmationEmailEnabled).toBe(false);
    } finally {
      await knex('transactional_emails').where({ code: 'return_submitted' }).update({ active: true });
    }
  });

  it('answers today in returns.time_zone, not the server’s UTC date (D-12)', async () => {
    const restore = await overrideReturnsSetting(h, 'returns.time_zone', 'Pacific/Kiritimati');
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-13T15:00:00Z') });
    try {
      // 15:00 UTC is 05:00 the next day at UTC+14.
      expect((await config()).today).toBe('2026-11-14');
    } finally {
      vi.useRealTimers();
      await restore();
    }
  });

  it('answers 404 for an order the caller cannot read', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/returns/form-config?orderId=${randomUUID()}`,
      cookies: CUSTOMER_COOKIE,
      headers: { 'x-sales-channel': 'default' },
    });
    expect(res.statusCode).toBe(404);
  });
});
