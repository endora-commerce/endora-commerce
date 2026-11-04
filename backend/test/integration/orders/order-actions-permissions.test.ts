import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { Order, OrderItem, Organization } from '../../helpers/package-entities.js';

/**
 * `specs/170-organization-roles/` WP-16 (T155; FR-030, FR-040, owner ruling of
 * 2026-11-04 after the WP-11 review) — the two buyer actions that build
 * something from a past order are judged by what they build:
 *
 *   - `POST /api/v1/orders/:id/reorder` replaces the active basket, so it
 *     needs `carts.create`;
 *   - `POST /api/v1/orders/:id/clone-to-quote` creates a quote request, so it
 *     needs `quote_requests.create`.
 *
 * The permission is judged **first**, as every composite gate of WP-04, WP-06
 * and WP-14 judges it: a member lacking the code is refused `403
 * ORGANIZATION_PERMISSION_REQUIRED` before the order is read — the same answer
 * for their own order, a colleague's and an id that is no order at all, so the
 * refusal says nothing of the order. The order scope (FR-049) then applies to
 * a member holding the code exactly as before: a colleague's order without
 * `orders.view_organization` is `404 ORDER_NOT_FOUND`.
 *
 * Organization and accounts are this file's own; every role is custom and
 * holds exactly the codes named:
 *
 *   cartsOnly  — `carts.create`;
 *   quotesOnly — `quote_requests.create`;
 *   neither    — nothing.
 *
 * Each places one order of their own.
 */

let seq = 0;
async function makeRootOrg(em: EntityManager): Promise<string> {
  seq += 1;
  const org = em.create(Organization, {
    name: `WP16 Org ${seq}`,
    taxId: `PL170WP16${String(seq).padStart(5, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  await bindOrganizationsToFixtureChannelsSql(em, [org.id]);
  org.path = `/${org.id}/`;
  await em.flush();
  return org.id;
}

async function makeAccount(em: EntityManager, organizationId: string, label: string): Promise<string> {
  const id = randomUUID();
  await em.getConnection().execute(
    `insert into "customer_accounts"
       ("id","organization_id","email","password_hash","first_name","last_name","email_verified_at","created_at","updated_at")
     values (?, ?, ?, 'x', 'WP16', ?, now(), now(), now())`,
    [id, organizationId, `wp16-${label}-${id.slice(0, 8)}@example.com`, label],
  );
  return id;
}

async function seedOrderWithLine(
  em: EntityManager,
  organizationId: string,
  placedByCustomerAccountId: string,
  salesChannelId: string,
): Promise<string> {
  const order = em.create(Order, {
    organizationId,
    placedByCustomerAccountId,
    salesChannelId,
    status: 'completed',
    deliveryAddress: { recipientName: 'W', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'W', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
    subtotal: '20.00',
    taxTotal: '0.00',
    deliveryTotal: '0.00',
    total: '20.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  await em.persistAndFlush(
    em.create(OrderItem, {
      orderId: order.id,
      productId: SEED_PRODUCT_101_ID,
      productSnapshot: { sku: 'P101', name: 'Product 101', primaryAssetUrl: null },
      quantity: 2,
      unitPrice: '10.00',
      taxRate: '0.0000',
      lineTotal: '20.00',
    }),
  );
  return order.id;
}

type Refusal = { error?: { code?: string; message?: string; details?: { permission?: string } } };

describe('170 WP-16 — reorder needs carts.create, clone-to-quote needs quote_requests.create', () => {
  let h: BackendServerHandle;
  let organizationId = '';
  const accounts = { cartsOnly: '', quotesOnly: '', neither: '' };
  const orders = { cartsOnly: '', quotesOnly: '', neither: '' };
  const cookie = (key: keyof typeof accounts) => ({ b2b_session: `stub-wp16-${key}` });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await systemDefaultSalesChannelId(em);
    organizationId = await makeRootOrg(em);
    const grants: Record<keyof typeof accounts, string[]> = {
      cartsOnly: ['carts.create'],
      quotesOnly: ['quote_requests.create'],
      neither: [],
    };
    for (const key of Object.keys(accounts) as Array<keyof typeof accounts>) {
      accounts[key] = await makeAccount(em, organizationId, key);
      await seedMemberWithPermissions(em, {
        organizationId,
        customerAccountId: accounts[key],
        permissions: grants[key],
      });
      orders[key] = await seedOrderWithLine(em, organizationId, accounts[key], channel);
      CUSTOMER_COOKIES[`stub-wp16-${key}`] = { customerAccountId: accounts[key], organizationId };
    }
    (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } })
      .organizationRoleCache.invalidateLocal(organizationId);
  }, 90_000);

  afterAll(async () => {
    for (const key of Object.keys(accounts)) delete CUSTOMER_COOKIES[`stub-wp16-${key}`];
    await teardownBackendServer(h);
  });

  function post(key: keyof typeof accounts | null, url: string, language?: 'en' | 'pl') {
    return h.app.inject({
      method: 'POST',
      url,
      ...(key ? { cookies: cookie(key) } : {}),
      ...(language ? { headers: { 'accept-language': language } } : {}),
    });
  }

  /** Every basket of the account with its line count — what a refused reorder must leave alone. */
  async function basketsOf(customerAccountId: string): Promise<Array<{ id: string; status: string; lines: number }>> {
    return (await h
      .em()
      .getConnection()
      .execute(
        `select c."id", c."status", (select count(*)::int from "cart_items" i where i."cart_id" = c."id") as "lines"
           from "carts" c where c."customer_account_id" = ? order by c."id"`,
        [customerAccountId],
      )) as Array<{ id: string; status: string; lines: number }>;
  }

  async function quoteRequestsOf(customerAccountId: string): Promise<number> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as "n" from "quote_requests" where "customer_account_id" = ?`, [
        customerAccountId,
      ])) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  function expectPermissionRefusal(res: { statusCode: number; body: string; json: () => unknown }, code: string) {
    expect(res.statusCode, res.body).toBe(403);
    const { error } = res.json() as Refusal;
    expect(error?.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
    expect(error?.details?.permission).toBe(code);
    return error!;
  }

  describe('POST /api/v1/orders/:id/reorder', () => {
    it('refuses a member without carts.create on their own order, naming carts.create, and leaves the basket alone', async () => {
      // A basket of their own first: the read is ungated and lazily creates it.
      const read = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: cookie('quotesOnly') });
      expect(read.statusCode, read.body).toBe(200);
      const before = await basketsOf(accounts.quotesOnly);
      expect(before.length).toBeGreaterThan(0);

      for (const language of ['en', 'pl'] as const) {
        const res = await post('quotesOnly', `/api/v1/orders/${orders.quotesOnly}/reorder`, language);
        const error = expectPermissionRefusal(res, 'carts.create');
        expect(error.message, `${language} sentence`).toBeTruthy();
      }
      expect(await basketsOf(accounts.quotesOnly)).toEqual(before);
    });

    it('judges the permission before the order: the same 403 for a colleague’s order and for no order at all', async () => {
      expectPermissionRefusal(await post('quotesOnly', `/api/v1/orders/${orders.cartsOnly}/reorder`), 'carts.create');
      expectPermissionRefusal(await post('neither', `/api/v1/orders/${randomUUID()}/reorder`), 'carts.create');
    });

    it('serves a holder of carts.create on their own order', async () => {
      const res = await post('cartsOnly', `/api/v1/orders/${orders.cartsOnly}/reorder`);
      expect(res.statusCode, res.body).toBe(200);
      const baskets = await basketsOf(accounts.cartsOnly);
      expect(baskets.some((b) => b.status === 'active' && b.lines > 0)).toBe(true);
    });

    it('keeps the order scope for a holder: a colleague’s order is 404 ORDER_NOT_FOUND without orders.view_organization', async () => {
      const res = await post('cartsOnly', `/api/v1/orders/${orders.quotesOnly}/reorder`);
      expect(res.statusCode, res.body).toBe(404);
      expect((res.json() as Refusal).error?.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
    });

    it('still answers 401 to a signed-out caller', async () => {
      const res = await post(null, `/api/v1/orders/${orders.cartsOnly}/reorder`);
      expect(res.statusCode, res.body).toBe(401);
    });
  });

  describe('POST /api/v1/orders/:id/clone-to-quote', () => {
    it('refuses a member without quote_requests.create on their own order, naming it, and creates no quote request', async () => {
      const before = await quoteRequestsOf(accounts.cartsOnly);
      for (const language of ['en', 'pl'] as const) {
        const res = await post('cartsOnly', `/api/v1/orders/${orders.cartsOnly}/clone-to-quote`, language);
        const error = expectPermissionRefusal(res, 'quote_requests.create');
        expect(error.message, `${language} sentence`).toBeTruthy();
      }
      expect(await quoteRequestsOf(accounts.cartsOnly)).toBe(before);
    });

    it('judges the permission before the order: the same 403 for a colleague’s order and for no order at all', async () => {
      expectPermissionRefusal(
        await post('cartsOnly', `/api/v1/orders/${orders.quotesOnly}/clone-to-quote`),
        'quote_requests.create',
      );
      expectPermissionRefusal(
        await post('neither', `/api/v1/orders/${randomUUID()}/clone-to-quote`),
        'quote_requests.create',
      );
    });

    it('serves a holder of quote_requests.create on their own order', async () => {
      const before = await quoteRequestsOf(accounts.quotesOnly);
      const res = await post('quotesOnly', `/api/v1/orders/${orders.quotesOnly}/clone-to-quote`);
      expect(res.statusCode, res.body).toBe(200);
      expect(await quoteRequestsOf(accounts.quotesOnly)).toBe(before + 1);
    });

    it('keeps the order scope for a holder: a colleague’s order is 404 ORDER_NOT_FOUND without orders.view_organization', async () => {
      const res = await post('quotesOnly', `/api/v1/orders/${orders.cartsOnly}/clone-to-quote`);
      expect(res.statusCode, res.body).toBe(404);
      expect((res.json() as Refusal).error?.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
    });

    it('still answers 401 to a signed-out caller', async () => {
      const res = await post(null, `/api/v1/orders/${orders.quotesOnly}/clone-to-quote`);
      expect(res.statusCode, res.body).toBe(401);
    });

    /**
     * Off-state (FR-007, Constitution XVII): with `quote_requests` off its code
     * leaves every member's effective set, so the clone is refused before the
     * order is read — by the permission guard, as every other gate naming an
     * absent module's code is (WP-06's cart conversion, WP-15's import) — and
     * nothing is created. Switched back on, the same member is served with
     * nothing re-granted.
     */
    it.each(['deactivated', 'platform-unavailable'] as const satisfies readonly OffStateAxis[])(
      'is unavailable while quote_requests is %s, and served again after',
      async (axis) => {
        const before = await quoteRequestsOf(accounts.quotesOnly);
        await withModuleOff('quote_requests', axis, async () => {
          const res = await post('quotesOnly', `/api/v1/orders/${orders.quotesOnly}/clone-to-quote`);
          expectPermissionRefusal(res, 'quote_requests.create');
        });
        expect(await quoteRequestsOf(accounts.quotesOnly)).toBe(before);
        const back = await post('quotesOnly', `/api/v1/orders/${orders.quotesOnly}/clone-to-quote`);
        expect(back.statusCode, back.body).toBe(200);
        expect(await quoteRequestsOf(accounts.quotesOnly)).toBe(before + 1);
      },
    );
  });
});
