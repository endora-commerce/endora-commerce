import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedCartOrganization, type CartFixtureOrganization } from '../../helpers/cart-approval-roles.js';

/**
 * `carts`' route gates (`specs/170-organization-roles/` WP-04, T067;
 * `contracts/storefront-api.md` §5; FR-030, FR-040, FR-047, FR-048, SC-003).
 *
 * Every basket mutation and every builder of a basket is judged against
 * `carts.create`: a signed-in member whose role lacks it is refused
 * `403 ORGANIZATION_PERMISSION_REQUIRED` naming the code, before the handler
 * runs; a member holding it reaches the handler as today. `GET /api/v1/cart`
 * is not gated (research R-5): it still lazily creates and returns the basket
 * every page header reads.
 *
 * The restricted role is granted every **other** code these routes are
 * judged by (`shopping_lists.*`, `quote_requests.create`), so the refusal
 * names `carts.create` whichever of those the composition declares.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000f170';
const EN = JSON.parse(
  readFileSync(new URL('../../../../packages/modules/carts/i18n/en.json', import.meta.url), 'utf8'),
) as Record<string, string>;

interface ErrorBody {
  error: { code: string; details?: { permission?: string; permissionLabel?: string } };
}

describe('carts — organization permission gates (170 WP-04)', () => {
  let h: BackendServerHandle;
  let org: CartFixtureOrganization;

  beforeAll(async () => {
    h = await setupBackendServer();
    org = await seedCartOrganization(h, {
      label: 'WP-04 cart gates',
      members: {
        ADMIN: 'administrator',
        MEMBER: 'member',
        RESTRICTED: {
          permissions: ['shopping_lists.create', 'shopping_lists.convert', 'quote_requests.create'],
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    org?.release();
    await teardownBackendServer(h);
  });

  function call(key: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    return h.app.inject({
      method,
      url,
      cookies: { b2b_session: org.actors[key]!.cookie },
      headers: { ...CHANNEL, 'accept-language': 'en', ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { payload } : {}),
    });
  }

  const GATED: ReadonlyArray<readonly [string, 'POST' | 'PATCH' | 'DELETE', string, object | undefined]> = [
    ['add a line', 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    ['change a line', 'PATCH', `/api/v1/cart/items/${UNKNOWN_ID}`, { quantity: 2 }],
    ['remove a line', 'DELETE', `/api/v1/cart/items/${UNKNOWN_ID}`, undefined],
    ['apply a coupon', 'POST', '/api/v1/cart/coupon', { code: 'WP04' }],
    ['clear the coupon', 'DELETE', '/api/v1/cart/coupon', undefined],
    ['build a basket from a quote request', 'POST', `/api/v1/cart/from-quote-request/${UNKNOWN_ID}`, undefined],
    ['build a basket from a shopping list', 'POST', `/api/v1/cart/from-shopping-list/${UNKNOWN_ID}`, undefined],
  ];

  it.each(GATED)('refuses a member without carts.create to %s (403, naming the code)', async (_what, method, url, payload) => {
    const res = await call('RESTRICTED', method, url, payload);
    expect(res.statusCode, res.body).toBe(403);
    const { error } = res.json() as ErrorBody;
    expect(error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
    expect(error.details).toMatchObject({
      permission: 'carts.create',
      permissionLabel: EN['organizationPermissions.carts.create.label'],
    });
  });

  it('refuses before anything is written: the restricted member holds no line', async () => {
    const res = await call('RESTRICTED', 'GET', '/api/v1/cart');
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { items: unknown[] } }).data.items).toEqual([]);
  });

  it('lets a holder of carts.create through every gate to the handler', async () => {
    const add = await call('MEMBER', 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(add.statusCode, add.body).toBe(200);
    const itemId = (add.json() as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;

    const patch = await call('MEMBER', 'PATCH', `/api/v1/cart/items/${itemId}`, { quantity: 2 });
    expect(patch.statusCode, patch.body).toBe(200);

    const coupon = await call('MEMBER', 'POST', '/api/v1/cart/coupon', { code: 'NO-SUCH-CODE-WP04' });
    expect(coupon.statusCode, coupon.body).toBe(422);
    expect((coupon.json() as ErrorBody).error.code).toBe(ERROR_CODES.CART_COUPON_REJECTED);

    const clear = await call('MEMBER', 'DELETE', '/api/v1/cart/coupon');
    expect(clear.statusCode, clear.body).toBe(200);

    const del = await call('MEMBER', 'DELETE', `/api/v1/cart/items/${itemId}`);
    expect(del.statusCode, del.body).toBe(200);

    // The builders reach their handlers, which do not find the source.
    for (const url of [`/api/v1/cart/from-quote-request/${UNKNOWN_ID}`]) {
      const res = await call('MEMBER', 'POST', url);
      expect(res.statusCode, `${url}: ${res.body}`).not.toBe(403);
    }
  });

  it('an administrator holds carts.create', async () => {
    const add = await call('ADMIN', 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(add.statusCode, add.body).toBe(200);
  });

  it('GET /api/v1/cart is not gated: it answers every member, the restricted one included', async () => {
    for (const key of ['RESTRICTED', 'MEMBER', 'ADMIN']) {
      const res = await call(key, 'GET', '/api/v1/cart');
      expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
      const mini = await call(key, 'GET', '/api/v1/cart?view=mini');
      expect(mini.statusCode, `${key} mini: ${mini.body}`).toBe(200);
    }
  });

  // The three gates naming another module's code. `shopping_lists` and
  // `quote_requests` declare those codes in their own work packages (WP-05,
  // WP-06), which run beside this one; a guard naming an undeclared code is a
  // `500` and an `undeclared-check` in the permission inventory, so these land
  // once both have merged (see the WP-04 MR).
  it.todo('POST /api/v1/cart/from-shopping-list/:id is judged by shopping_lists.convert before carts.create');
  it.todo('POST /api/v1/cart/items/:itemId/save-to-shopping-list needs shopping_lists.create');
  it.todo('POST /api/v1/cart/convert-to-quote-request needs quote_requests.create');
});
