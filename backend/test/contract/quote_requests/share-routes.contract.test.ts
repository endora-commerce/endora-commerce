import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuoteRequestCreateDefaultsSchema, quoteRequestSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ensureAdminWithRole } from '../../helpers/admin-search-fixtures.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const QR = '/api/v1/admin/quote-requests';
const stamp = Date.now();
const NONE_ID = '00000000-0000-4000-8000-0000001920c1';
const NONE_SESSION = `stub-192-share-none-${stamp}`;

/**
 * `specs/192-quote-request-draft-share/` T021 — the share route's shapes
 * (`contracts/admin-api.md` §1): the `200` reply is the published admin
 * projection and nothing beside it; each refusal answers its status, code and
 * `details`; the gate is `rfqs:handle`, ahead of anything else; the body takes
 * no key.
 */
describe('POST /api/v1/admin/quote-requests/:id/share — shapes', () => {
  let h: BackendServerHandle;

  async function draft(items: Array<Record<string, unknown>> = [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 4 }]) {
    const res = await h.app.inject({
      method: 'POST',
      url: QR,
      cookies: ADMIN,
      payload: { organizationId: TEST_ORGANIZATION_ID, customerAccountId: TEST_CUSTOMER_ID, items },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }
  const share = (id: string, cookies: Record<string, string> = ADMIN, payload?: unknown) =>
    h.app.inject({
      method: 'POST',
      url: `${QR}/${id}/share`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await ensureAdminWithRole(h, NONE_ID, 'quote_share_none', ['orders:read']);
    ADMIN_COOKIES[NONE_SESSION] = { adminUserId: NONE_ID };
  }, 120_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[NONE_SESSION];
    await teardownBackendServer(h);
  });

  it('200: the admin projection, strictly as published, shared', async () => {
    const { id } = await draft();
    const res = await share(id, ADMIN, {});
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: unknown }).data;
    expect(disagreements(deepStrict(quoteRequestSchema), data)).toEqual([]);
    expect(data).toMatchObject({ sharedWithCustomer: true, sharedByAdminUserId: expect.any(String), sharedAt: expect.any(String) });
  });

  it('401 without a session and 403 without rfqs:handle, ahead of the body', async () => {
    const { id } = await draft();
    expect((await share(id, {}, { nonsense: true })).statusCode).toBe(401);
    expect((await share(id, { b2b_session: NONE_SESSION }, { nonsense: true })).statusCode).toBe(403);
  });

  it('a body with any key is refused as a validation failure, and nothing is shared', async () => {
    const { id } = await draft();
    const res = await share(id, ADMIN, { notify: false });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    const detail = await h.app.inject({ method: 'GET', url: `${QR}/${id}`, cookies: ADMIN });
    expect((detail.json() as { data: { sharedWithCustomer: boolean } }).data.sharedWithCustomer).toBe(false);
  });

  it('404 NOT_FOUND for an unknown or malformed id', async () => {
    for (const id of ['00000000-0000-4000-8000-0000001920ff', 'not-a-uuid']) {
      const res = await share(id);
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    }
  });

  it('409 QUOTE_INCOMPLETE with details { code: share, lines: [{ id, position, productName, variantLabel, groupName }] }', async () => {
    const { id } = await draft([{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
    const res = await share(id);
    expect(res.statusCode).toBe(409);
    const { error } = res.json() as { error: { code: string; details: { code: string; lines: Array<Record<string, unknown>> } } };
    expect(error.code).toBe('QUOTE_INCOMPLETE');
    expect(error.details.code).toBe('share');
    expect(error.details.lines).toHaveLength(1);
    expect(Object.keys(error.details.lines[0]!).sort()).toEqual(['groupName', 'id', 'position', 'productName', 'variantLabel']);
  });

  it('409 RFQ_ALREADY_SHARED with no details', async () => {
    const { id } = await draft();
    expect((await share(id)).statusCode).toBe(200);
    const res = await share(id);
    expect(res.statusCode).toBe(409);
    const { error } = res.json() as { error: { code: string; details?: unknown } };
    expect(error.code).toBe('RFQ_ALREADY_SHARED');
    expect(error.details ?? null).toBeNull();
  });

  it('409 VERSION_CONFLICT for a stale If-Match', async () => {
    const { id, version } = await draft();
    const res = await h.app.inject({
      method: 'POST',
      url: `${QR}/${id}/share`,
      cookies: ADMIN,
      headers: { 'if-match': `"${version + 3}"` },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT');
  });
});

/**
 * `specs/192-quote-request-draft-share/` T031 (contracts/admin-api.md §2,
 * research R-12) — what the create screen pre-fills, under `rfqs:handle` rather
 * than `settings:read`; `0` answers `null`.
 */
describe('GET /api/v1/admin/quote-requests/create-defaults — shapes', () => {
  let h: BackendServerHandle;
  const URL = `${QR}/create-defaults`;
  const setDefault = async (days: number) => {
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.DEFAULT_VALIDITY_DAYS, days, null, {
      actorAdminUserId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await ensureAdminWithRole(h, NONE_ID, 'quote_share_none', ['orders:read']);
    ADMIN_COOKIES[NONE_SESSION] = { adminUserId: NONE_ID };
  }, 120_000);

  afterAll(async () => {
    await setDefault(0);
    delete ADMIN_COOKIES[NONE_SESSION];
    await teardownBackendServer(h);
  });

  it('answers the published shape: 0 is null, a number of days is that number', async () => {
    const none = await h.app.inject({ method: 'GET', url: URL, cookies: ADMIN });
    expect(none.statusCode, none.body).toBe(200);
    const body = (none.json() as { data: unknown }).data;
    expect(disagreements(deepStrict(adminQuoteRequestCreateDefaultsSchema), body)).toEqual([]);
    expect(body).toEqual({ validityDays: null });

    await setDefault(30);
    const thirty = await h.app.inject({ method: 'GET', url: URL, cookies: ADMIN });
    expect((thirty.json() as { data: unknown }).data).toEqual({ validityDays: 30 });
  });

  it('401 without a session, 403 without rfqs:handle', async () => {
    expect((await h.app.inject({ method: 'GET', url: URL })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: URL, cookies: { b2b_session: NONE_SESSION } })).statusCode).toBe(403);
  });
});

