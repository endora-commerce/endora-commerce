import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const QR = '/api/v1/admin/quote-requests';
const DAY_MS = 86_400_000;

/**
 * `specs/192-quote-request-draft-share/` T028 (US3, FR-030 – FR-034) — one
 * global default validity, snapshotted into each new operator quote as days
 * and turned into a date at the share: the date counts from the share however
 * long the quote waited, `0` (the default, or typed) means no date, a typed
 * number wins, and changing the default moves no quote already created. The
 * refusals after the date are unchanged.
 */
describe('default validity of an operator quote, counted from the share', () => {
  let h: BackendServerHandle;

  const setDefault = async (days: number) => {
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.DEFAULT_VALIDITY_DAYS, days, null, {
      actorAdminUserId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
  };

  async function draft(expiresInDays?: number | null): Promise<{ id: string; shareValidityDays: number | null }> {
    const res = await h.app.inject({
      method: 'POST',
      url: QR,
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 15 }],
        ...(expiresInDays !== undefined ? { expiresInDays } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; shareValidityDays: number | null } }).data;
  }

  async function share(id: string): Promise<{ at: number; expiresAt: string | null }> {
    const at = Date.now();
    const res = await h.app.inject({ method: 'POST', url: `${QR}/${id}/share`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return { at, expiresAt: (res.json() as { data: { expiresAt: string | null } }).data.expiresAt };
  }

  /** Pretend the draft waited `days` before the share. */
  const waited = (id: string, days: number) =>
    h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set "created_at" = now() - (? * interval '1 day') where "id" = ?`, [days, id]);

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterEach(async () => {
    await setDefault(0);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('default 30: the draft carries 30 days, and the date is the share plus 30 however long it waited (US3 #1)', async () => {
    await setDefault(30);
    const quote = await draft();
    expect(quote.shareValidityDays).toBe(30);
    await waited(quote.id, 20);
    const shared = await share(quote.id);
    const expiresAt = Date.parse(shared.expiresAt!);
    expect(expiresAt).toBeGreaterThanOrEqual(shared.at + 30 * DAY_MS - 2000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS + 2000);
  });

  it('default 0 (out of the box): no days, no date (US3 #2)', async () => {
    const quote = await draft();
    expect(quote.shareValidityDays).toBeNull();
    expect((await share(quote.id)).expiresAt).toBeNull();
  });

  it('0 typed on the draft, and null: no date (US3 #3, FR-032)', async () => {
    await setDefault(30);
    for (const typed of [0, null]) {
      const quote = await draft(typed);
      expect(quote.shareValidityDays).toBeNull();
      expect((await share(quote.id)).expiresAt).toBeNull();
    }
  });

  it('7 typed: that quote uses 7, the next one the default (US3 #4)', async () => {
    await setDefault(30);
    const typed = await draft(7);
    const other = await draft();
    expect(typed.shareValidityDays).toBe(7);
    expect(other.shareValidityDays).toBe(30);
    const shared = await share(typed.id);
    expect(Date.parse(shared.expiresAt!)).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS + 2000);
    expect(Date.parse(shared.expiresAt!)).toBeGreaterThanOrEqual(shared.at + 7 * DAY_MS - 2000);
  });

  it('changing the default moves no quote already created (FR-033)', async () => {
    await setDefault(30);
    const quote = await draft();
    await setDefault(5);
    const detail = await h.app.inject({ method: 'GET', url: `${QR}/${quote.id}`, cookies: ADMIN });
    expect((detail.json() as { data: { shareValidityDays: number | null } }).data.shareValidityDays).toBe(30);
    expect((await draft()).shareValidityDays).toBe(5);
  });

  it('past the date: accept answers 410 RFQ_EXPIRED; an accepted one converts to 410 QUOTE_VALIDITY_ENDED (FR-034)', async () => {
    const lapse = async (id: string) =>
      h
        .em()
        .getConnection()
        .execute(`update "quote_requests" set "expires_at" = now() - interval '1 day' where "id" = ?`, [id]);
    const revisionOf = async (id: string) =>
      (
        (await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: CUSTOMER })).json() as {
          data: { currentRevisionNumber: number };
        }
      ).data.currentRevisionNumber;

    const refused = await draft(3);
    await share(refused.id);
    await lapse(refused.id);
    const accept = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${refused.id}/accept-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: await revisionOf(refused.id) },
    });
    expect(accept.statusCode, accept.body).toBe(410);
    expect((accept.json() as { error: { code: string } }).error.code).toBe('RFQ_EXPIRED');

    const accepted = await draft(3);
    await share(accepted.id);
    const ok = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${accepted.id}/accept-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: await revisionOf(accepted.id) },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    await lapse(accepted.id);
    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${accepted.id}/convert-to-order`,
      cookies: CUSTOMER,
      payload: {},
    });
    expect(convert.statusCode, convert.body).toBe(410);
    expect((convert.json() as { error: { code: string } }).error.code).toBe('QUOTE_VALIDITY_ENDED');
  });
});
