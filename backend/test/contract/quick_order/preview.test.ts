import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  QUICK_ORDER_PREVIEW_MAX_BYTES,
  QUICK_ORDER_PREVIEW_MAX_LINES,
  QUICK_ORDER_PREVIEW_TTL_SECONDS,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CUSTOMER_COOKIES,
  OTHER_TEST_CUSTOMER_ID,
  OTHER_TEST_ORGANIZATION_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';

/**
 * Issue #809 — the buyer's quick-order preview is kept by `quick_order`, in Redis, one per buyer
 * session and scoped to the buyer's Organization (Principle XI). It replaces the storefront
 * cookie of #805, whose proxy budget held a few dozen lines; the cap is the import's 2 000.
 *
 *  - `GET    /api/v1/quick-order/preview` — `{ data: preview | null }`, never cached;
 *  - `PUT    /api/v1/quick-order/preview` — replaces it; ≤ 2 000 lines, ≤ 2 MiB; starts the TTL;
 *  - `DELETE /api/v1/quick-order/preview` — 204.
 *
 * `stub-customer-session` is `TEST_ORGANIZATION_ID`'s administrator (every create permission).
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const OTHER_ORG_BUYER = { b2b_session: 'stub-customer-session-other-org' };
const URL = '/api/v1/quick-order/preview';
const PRODUCT_ID = '00000000-0000-4000-8000-00000000f001';

function previewOf(recognized: number, rejected = 0) {
  return {
    recognized: Array.from({ length: recognized }, (_, index) => ({
      line: index + 1,
      sku: `SKU-${index}`,
      productId: PRODUCT_ID,
      variantId: null,
      quantity: index + 1,
    })),
    rejected: Array.from({ length: rejected }, (_, index) => ({
      line: recognized + index + 1,
      raw: `NOPE-${index},1`,
      reason: 'product_not_found' as const,
    })),
    summary: { recognizedCount: recognized, rejectedCount: rejected, mergedCount: 0, truncated: false },
  };
}

describe('quick-order preview (issue #809)', () => {
  let h: BackendServerHandle;
  const cookieNames: string[] = [];

  const put = (cookies: Record<string, string> | undefined, payload: unknown) =>
    h.app.inject({ method: 'PUT', url: URL, ...(cookies ? { cookies } : {}), payload: payload as object });
  const get = (cookies?: Record<string, string>) =>
    h.app.inject({ method: 'GET', url: URL, ...(cookies ? { cookies } : {}) });
  const del = (cookies?: Record<string, string>) =>
    h.app.inject({ method: 'DELETE', url: URL, ...(cookies ? { cookies } : {}) });
  const keysOf = (organizationId: string, customerAccountId: string) =>
    h.redis.keys(`b2b:quick_order:preview:${organizationId}:${customerAccountId}:*`);

  beforeAll(async () => {
    h = await setupBackendServer();
    // The other Organization's buyer has to exist to pass the store's access rule.
    await seedOtherTestCustomer(h.em());
  });

  afterEach(async () => {
    await del(BUYER);
    await del(OTHER_ORG_BUYER);
  });

  afterAll(async () => {
    for (const name of cookieNames) delete CUSTOMER_COOKIES[name];
    await teardownBackendServer(h);
  });

  it('answers null before anything was written, and is never cached', async () => {
    const res = await get(BUYER);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: null });
    expect(String(res.headers['cache-control'])).toContain('no-store');
  });

  it('reads back what the same session wrote', async () => {
    const preview = {
      ...previewOf(2, 1),
      recognized: [
        ...previewOf(2).recognized,
        {
          line: 9,
          sku: 'PALLET-1',
          productId: PRODUCT_ID,
          variantId: null,
          quantity: 3,
          notAdded: { kind: 'packaging_unit', minimum: 2, productName: 'Anchor bolt', packagingUnitName: 'Pallet' },
        },
      ],
    };
    const written = await put(BUYER, preview);
    expect(written.statusCode, written.body).toBe(200);
    expect(written.json()).toEqual({ data: preview });

    const read = await get(BUYER);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual({ data: preview });
  });

  it('holds 2 000 lines, and refuses one more with 422 too_many_lines', async () => {
    expect(QUICK_ORDER_PREVIEW_MAX_LINES).toBe(2_000);
    const atCap = await put(BUYER, previewOf(1_500, 500));
    expect(atCap.statusCode, atCap.body).toBe(200);
    expect((await get(BUYER)).json().data.recognized).toHaveLength(1_500);

    const over = await put(BUYER, previewOf(1_500, 501));
    expect(over.statusCode, over.body).toBe(422);
    const error = (over.json() as { error: { code: string; details?: { code?: string; maximum?: number } } }).error;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toMatchObject({ code: 'too_many_lines', maximum: 2_000 });
    // The refused write left the previous preview as it was.
    expect((await get(BUYER)).json().data.recognized).toHaveLength(1_500);
  });

  it('refuses a body over the size cap before reading it', async () => {
    const huge = previewOf(0, 2);
    huge.rejected[0]!.raw = 'x'.repeat(QUICK_ORDER_PREVIEW_MAX_BYTES);
    const res = await put(BUYER, huge);
    expect(res.statusCode, res.body).toBe(413);
    expect((await get(BUYER)).json()).toEqual({ data: null });
  });

  it('refuses a body that is not a preview', async () => {
    const res = await put(BUYER, { recognized: 'nope' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('starts the TTL on PUT, and a GET does not refresh it', async () => {
    await put(BUYER, previewOf(1));
    const [key] = await keysOf(TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID);
    expect(key).toBeDefined();
    const ttl = await h.redis.ttl(key!);
    expect(ttl).toBeGreaterThan(QUICK_ORDER_PREVIEW_TTL_SECONDS - 60);
    expect(ttl).toBeLessThanOrEqual(QUICK_ORDER_PREVIEW_TTL_SECONDS);

    // Shorten it by hand, then read: a read must leave the shortened TTL in place.
    await h.redis.expire(key!, 30);
    await get(BUYER);
    expect(await h.redis.ttl(key!)).toBeLessThanOrEqual(30);

    // A write starts the window again.
    await put(BUYER, previewOf(2));
    expect(await h.redis.ttl(key!)).toBeGreaterThan(QUICK_ORDER_PREVIEW_TTL_SECONDS - 60);
  });

  it('an expired preview reads as none', async () => {
    await put(BUYER, previewOf(1));
    const [key] = await keysOf(TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID);
    await h.redis.del(key!);
    expect((await get(BUYER)).json()).toEqual({ data: null });
  });

  it('keys by organization and buyer, never by the raw session cookie', async () => {
    await put(BUYER, previewOf(1));
    const keys = await keysOf(TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('stub-customer-session');
  });

  it('is not read across tenants: a buyer of another organization sees none, and writes their own', async () => {
    await put(BUYER, previewOf(3));
    const other = await get(OTHER_ORG_BUYER);
    expect(other.statusCode, other.body).toBe(200);
    expect(other.json()).toEqual({ data: null });

    // Deleting from the other tenant does not touch this one.
    expect((await del(OTHER_ORG_BUYER)).statusCode).toBe(204);
    expect((await get(BUYER)).json().data.recognized).toHaveLength(3);
    expect(await keysOf(OTHER_TEST_ORGANIZATION_ID, OTHER_TEST_CUSTOMER_ID)).toHaveLength(0);
  });

  it('is bound to the session: the same buyer signed in elsewhere sees none', async () => {
    const elsewhere = 'stub-quick-order-preview-second-session';
    CUSTOMER_COOKIES[elsewhere] = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
    cookieNames.push(elsewhere);
    await put(BUYER, previewOf(1));
    expect((await get({ b2b_session: elsewhere })).json()).toEqual({ data: null });
  });

  it('DELETE drops it', async () => {
    await put(BUYER, previewOf(1));
    const res = await del(BUYER);
    expect(res.statusCode, res.body).toBe(204);
    expect((await get(BUYER)).json()).toEqual({ data: null });
    expect(await keysOf(TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID)).toHaveLength(0);
  });

  it.each([
    ['GET', () => get()],
    ['PUT', () => put(undefined, previewOf(1))],
    ['DELETE', () => del()],
  ])('%s needs a signed-in buyer', async (_method, run) => {
    const res = await run();
    expect(res.statusCode, res.body).toBe(401);
  });

  it('an admin session is not a buyer session', async () => {
    const res = await get({ b2b_session: 'stub-admin-session' });
    expect(res.statusCode, res.body).toBe(401);
  });

  it('writing needs carts.create or quote_requests.create, like the import; reading and deleting do not', async () => {
    const id = randomUUID();
    const em = h.em();
    await em.getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Preview', 'Neither', now(), now())`,
      [id, TEST_ORGANIZATION_ID, `${id.slice(0, 8)}@quick-order-preview.example`],
    );
    await seedMemberWithPermissions(em, { organizationId: TEST_ORGANIZATION_ID, customerAccountId: id, permissions: [] });
    (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } })
      .organizationRoleCache.invalidateLocal(TEST_ORGANIZATION_ID);
    const cookie = 'stub-quick-order-preview-neither';
    CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId: TEST_ORGANIZATION_ID };
    cookieNames.push(cookie);
    const neither = { b2b_session: cookie };

    const refused = await put(neither, previewOf(1));
    expect(refused.statusCode, refused.body).toBe(403);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
    expect((await get(neither)).statusCode).toBe(200);
    expect((await del(neither)).statusCode).toBe(204);
  });
});
