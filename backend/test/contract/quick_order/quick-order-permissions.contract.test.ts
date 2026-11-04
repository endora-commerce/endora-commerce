import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';

/**
 * Quick order by organization permission (`specs/170-organization-roles/`
 * WP-06, T085; `contracts/storefront-api.md` §5; FR-012, FR-030, FR-040, R-26).
 *
 *  - `POST /api/v1/quick-order/import` needs `carts.create` or
 *    `quote_requests.create` (WP-15, OR-10, FR-030b, R-40); a member holding
 *    neither is refused naming `carts.create`.
 *  - `…/build` with `target: cart` needs `carts.create`; with
 *    `target: quote_request` it needs
 *    `quote_requests.create`. The target is in the body, so the build judges
 *    it in its own branch — still before any line is resolved or written.
 *  - `PUT /api/v1/quick-order/preferences` for the Organization scope stays
 *    reserved to the *Administrator* role (FR-012): `403 FORBIDDEN`, never a
 *    permission code, and no custom role can be granted it.
 *  - The operator's on-behalf build is gated by `orders:write` only: the member
 *    it builds for is not judged (R-26).
 *
 * `stub-customer-session` is `TEST_ORGANIZATION_ID`'s administrator.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
const LINE = { productId: SEED_PRODUCT_101_ID, quantity: 1 };

interface Member {
  readonly id: string;
  readonly cookies: Record<string, string>;
}

function refusal(body: string): { code: string; permission: string | undefined } {
  const error = (JSON.parse(body) as { error: { code: string; details?: { permission?: string } } }).error;
  return { code: error.code, permission: error.details?.permission };
}

describe('quick order — organization permission gates', () => {
  let h: BackendServerHandle;
  const cookieNames: string[] = [];
  let cartsOnly: Member;
  let quotesOnly: Member;
  let everything: Member;
  let neither: Member;

  async function member(label: string, permissions: readonly string[]): Promise<Member> {
    const id = randomUUID();
    const em = h.em();
    await em.getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Quick', ?, now(), now())`,
      [id, TEST_ORGANIZATION_ID, `${id.slice(0, 8)}@quick-order-permissions.example`, label],
    );
    await seedMemberWithPermissions(em, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: id,
      permissions,
    });
    // The fixture writes the role with SQL, past the role cache's drop; this
    // process has read the Organization's roles already, so drop its entry.
    (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } })
      .organizationRoleCache.invalidateLocal(TEST_ORGANIZATION_ID);
    const cookie = `stub-quick-order-permissions-${label}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId: TEST_ORGANIZATION_ID };
    cookieNames.push(cookie);
    return { id, cookies: { b2b_session: cookie } };
  }

  async function cartRows(customerAccountId: string): Promise<unknown[]> {
    return (await h.em().getConnection().execute(
      `select c."id", c."updated_at", count(i."id")::int as "lines"
         from "carts" c left join "cart_items" i on i."cart_id" = c."id"
        where c."customer_account_id" = ? group by c."id" order by c."id"`,
      [customerAccountId],
    )) as unknown[];
  }

  async function quoteRequestCount(customerAccountId: string): Promise<number> {
    const [row] = (await h.em().getConnection().execute(
      `select count(*)::int as "n" from "quote_requests" where "customer_account_id" = ?`,
      [customerAccountId],
    )) as Array<{ n: number }>;
    return row!.n;
  }

  function build(who: Member, target: 'cart' | 'quote_request') {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/build',
      cookies: who.cookies,
      payload: { target, items: [LINE] },
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    cartsOnly = await member('carts-only', ['carts.create']);
    quotesOnly = await member('quotes-only', ['quote_requests.create']);
    neither = await member('neither', []);
    // Every grantable code a role can hold here — still not the administrator.
    everything = await member('everything', [
      'carts.create',
      'carts.approve',
      'carts.order_without_approval',
      'quote_requests.create',
      'quick_order.one_click',
      'shopping_lists.create',
      'shopping_lists.convert',
    ]);
  });

  afterAll(async () => {
    for (const cookie of cookieNames) delete CUSTOMER_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  /**
   * The import admits either target's permission (owner ruling OR-10,
   * FR-030b, R-40): `carts.create` **or** `quote_requests.create`, judged after
   * `requireCustomer` and before the file is parsed. A member holding neither
   * is refused naming `carts.create`. The build that follows still judges its
   * own target.
   */
  describe('POST /api/v1/quick-order/import', () => {
    const CSV = 'sku,quantity\nEXAMPLE-SIMPLE-001,1';

    function importAs(who: Member | null, payload: Record<string, unknown> = { csv: CSV }) {
      return h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/import',
        ...(who ? { cookies: who.cookies } : {}),
        payload,
      });
    }

    function recognisedSkus(body: string): string[] {
      return (JSON.parse(body) as { data: { recognized: Array<{ sku: string }> } }).data.recognized.map((r) => r.sku);
    }

    it('serves a member holding quote_requests.create and not carts.create', async () => {
      const res = await importAs(quotesOnly);
      expect(res.statusCode, res.body).toBe(200);
      expect(recognisedSkus(res.body)).toEqual(['EXAMPLE-SIMPLE-001']);
    });

    it('serves a holder of carts.create', async () => {
      const res = await importAs(cartsOnly);
      expect(res.statusCode, res.body).toBe(200);
      expect(recognisedSkus(res.body)).toEqual(['EXAMPLE-SIMPLE-001']);
    });

    it('refuses a member holding neither, naming carts.create, before the file is parsed', async () => {
      const res = await importAs(neither);
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({
        code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
        permission: 'carts.create',
      });
    });

    it('refuses a member holding neither the same way when the file is malformed — 403, not a parse failure', async () => {
      const res = await importAs(neither, {
        file: { filename: 'broken.xlsx', contentBase64: Buffer.from('not a workbook').toString('base64') },
      });
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({
        code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
        permission: 'carts.create',
      });
    });

    it('keeps the target gated: the quote-only importer cannot build a cart', async () => {
      expect((await importAs(quotesOnly)).statusCode).toBe(200);
      const before = await cartRows(quotesOnly.id);
      const res = await build(quotesOnly, 'cart');
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({
        code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
        permission: 'carts.create',
      });
      expect(await cartRows(quotesOnly.id)).toEqual(before);
    });

    it('keeps the target gated: the cart-only importer cannot build a quote request', async () => {
      expect((await importAs(cartsOnly)).statusCode).toBe(200);
      const before = await quoteRequestCount(cartsOnly.id);
      const res = await build(cartsOnly, 'quote_request');
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({
        code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
        permission: 'quote_requests.create',
      });
      expect(await quoteRequestCount(cartsOnly.id)).toBe(before);
    });

    it('still answers 401 to a signed-out caller', async () => {
      const res = await importAs(null);
      expect(res.statusCode, res.body).toBe(401);
    });
  });

  describe('POST /api/v1/quick-order/build', () => {
    it('refuses target cart without carts.create, writing no basket', async () => {
      const before = await cartRows(quotesOnly.id);
      const res = await build(quotesOnly, 'cart');
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({
        code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
        permission: 'carts.create',
      });
      expect(await cartRows(quotesOnly.id)).toEqual(before);
    });

    it('refuses target quote_request without quote_requests.create, writing no quote request', async () => {
      const before = await quoteRequestCount(cartsOnly.id);
      const res = await build(cartsOnly, 'quote_request');
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({
        code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
        permission: 'quote_requests.create',
      });
      expect(await quoteRequestCount(cartsOnly.id)).toBe(before);
    });

    it('builds a cart for a holder of carts.create', async () => {
      const res = await build(cartsOnly, 'cart');
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { target: string } }).data.target).toBe('cart');
    });

    it('builds a quote request for a holder of quote_requests.create', async () => {
      const res = await build(quotesOnly, 'quote_request');
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { target: string } }).data.target).toBe('quote_request');
    });
  });

  describe('POST /api/v1/admin/quick-order/build — the operator on behalf (R-26)', () => {
    it.each(['cart', 'quote_request'] as const)(
      'builds %s for a member who holds neither create permission',
      async (target) => {
        const holdsNothing = await member(`nothing-${target}`, []);
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/quick-order/build',
          cookies: ADMIN_COOKIE,
          payload: {
            target,
            onBehalfOf: { customerAccountId: holdsNothing.id, organizationId: TEST_ORGANIZATION_ID },
            items: [LINE],
          },
        });
        expect(res.statusCode, res.body).toBe(200);
      },
    );
  });

  describe('PUT /api/v1/quick-order/preferences — Organization scope (FR-012)', () => {
    const organizationDefaults = {
      scope: 'organization',
      scopeId: TEST_ORGANIZATION_ID,
      defaultPaymentMethodId: null,
    };

    it('is the administrator’s', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/quick-order/preferences',
        cookies: ORG_ADMIN,
        payload: organizationDefaults,
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('is refused 403 FORBIDDEN to a custom role holding every grantable code — it is reserved, not a permission', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/quick-order/preferences',
        cookies: everything.cookies,
        payload: organizationDefaults,
      });
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body).code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('lets the administrator read the Organization scope and refuses it to anyone else', async () => {
      const url = `/api/v1/quick-order/preferences?scope=organization&scopeId=${TEST_ORGANIZATION_ID}`;
      const admin = await h.app.inject({ method: 'GET', url, cookies: ORG_ADMIN });
      expect(admin.statusCode, admin.body).toBe(200);
      const other = await h.app.inject({ method: 'GET', url, cookies: everything.cookies });
      expect(other.statusCode, other.body).toBe(403);
    });

    it('lets the administrator manage a member’s customer-scope defaults, and not a member another’s', async () => {
      const payload = { scope: 'customer', scopeId: cartsOnly.id, defaultPaymentMethodId: null };
      const admin = await h.app.inject({ method: 'PUT', url: '/api/v1/quick-order/preferences', cookies: ORG_ADMIN, payload });
      expect(admin.statusCode, admin.body).toBe(200);
      const peer = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/quick-order/preferences',
        cookies: everything.cookies,
        payload,
      });
      expect(peer.statusCode, peer.body).toBe(403);
    });
  });
});
