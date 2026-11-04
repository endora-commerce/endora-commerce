import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';

/**
 * One-click purchase is a permission (`specs/170-organization-roles/` WP-06,
 * T084; US 4.1–4.3, FR-050; owner rulings OR-1, OR-6, PR-8; issue #653).
 *
 * US 4's three-member matrix, over HTTP, with the operator setting on and the
 * four defaults set for every member, so the only thing that differs between
 * them is the role:
 *
 *  - lacking `quick_order.one_click` → eligibility `permission_required`, and
 *    placement refused `403 ORGANIZATION_PERMISSION_REQUIRED` naming it;
 *  - holding it but lacking `carts.order_without_approval` → eligibility
 *    `cart_approval_required`, placement refused naming that code — the #653
 *    bypass of cart approval, closed;
 *  - lacking both → `permission_required`: `quick_order.one_click` is judged
 *    first (PR-8, `contracts/migration-and-replay.md` §6.1 rows 23–24);
 *  - holding both → eligible, and the order is placed as today.
 *
 * "Before any basket is written" is asserted on the rows: a refused placement
 * leaves the member's `carts` exactly as they were — no working basket created
 * and removed again, no active basket touched.
 */

const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';
const ONE_CLICK = 'quick_order.one_click';
const ORDER_WITHOUT_APPROVAL = 'carts.order_without_approval';

interface Member {
  readonly id: string;
  readonly cookies: Record<string, string>;
}

describe('one-click purchase by organization permission (FR-050, #653)', () => {
  let h: BackendServerHandle;
  const cookieNames: string[] = [];
  let lacksOneClick: Member;
  let lacksApproval: Member;
  let lacksBoth: Member;
  let holdsBoth: Member;

  async function member(label: string, permissions: readonly string[]): Promise<Member> {
    const id = randomUUID();
    const em = h.em();
    await em.getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'One', ?, now(), now())`,
      [id, TEST_ORGANIZATION_ID, `${id.slice(0, 8)}@one-click-permissions.example`, label],
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
    const cookie = `stub-one-click-permissions-${label}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId: TEST_ORGANIZATION_ID };
    cookieNames.push(cookie);
    const cookies = { b2b_session: cookie };
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies,
      payload: {
        scope: 'customer',
        scopeId: id,
        defaultPaymentMethodId: SEED_PAYMENT_METHOD_ID,
        defaultDeliveryMethodId: SEED_DELIVERY_METHOD_ID,
        defaultBillingAddressId: SEED_ADDRESS_BILLING_ID,
        defaultShippingAddressId: SEED_ADDRESS_DELIVERY_ID,
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    return { id, cookies };
  }

  async function cartRows(customerAccountId: string): Promise<unknown[]> {
    return (await h.em().getConnection().execute(
      `select "id", "status", "updated_at" from "carts" where "customer_account_id" = ? order by "id"`,
      [customerAccountId],
    )) as unknown[];
  }

  async function eligibility(who: Member): Promise<{ enabled: boolean; reason: string | null }> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/one-click/eligibility',
      cookies: who.cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { enabled: boolean; reason: string | null } }).data;
  }

  function place(who: Member) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: who.cookies,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channelCode = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).code;
    await h.settings.adminService.setValueForSubset(ONE_CLICK_ENABLED, [channelCode], true, null, {
      actorAdminUserId: null,
    });
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);

    lacksOneClick = await member('lacks-one-click', ['carts.create', ORDER_WITHOUT_APPROVAL]);
    lacksApproval = await member('lacks-approval', ['carts.create', ONE_CLICK]);
    lacksBoth = await member('lacks-both', ['carts.create']);
    holdsBoth = await member('holds-both', ['carts.create', ONE_CLICK, ORDER_WITHOUT_APPROVAL]);
  });

  afterAll(async () => {
    for (const cookie of cookieNames) delete CUSTOMER_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  describe('eligibility', () => {
    it('answers permission_required for a member without quick_order.one_click (US 4.1)', async () => {
      expect(await eligibility(lacksOneClick)).toEqual({ enabled: false, reason: 'permission_required' });
    });

    it('answers cart_approval_required for a holder without carts.order_without_approval (US 4.2, OR-6)', async () => {
      expect(await eligibility(lacksApproval)).toEqual({ enabled: false, reason: 'cart_approval_required' });
    });

    it('answers permission_required for a member lacking both — quick_order.one_click is judged first (PR-8)', async () => {
      expect(await eligibility(lacksBoth)).toEqual({ enabled: false, reason: 'permission_required' });
    });

    it('answers enabled for a holder of both (US 4.3)', async () => {
      expect(await eligibility(holdsBoth)).toEqual({ enabled: true, reason: null });
    });
  });

  describe('placement', () => {
    it.each([
      ['without quick_order.one_click', ONE_CLICK, () => lacksOneClick],
      ['without carts.order_without_approval', ORDER_WITHOUT_APPROVAL, () => lacksApproval],
      ['lacking both', ONE_CLICK, () => lacksBoth],
    ])('refuses a member %s with 403 naming %s, before any basket is written', async (_who, code, who) => {
      const before = await cartRows(who().id);
      const res = await place(who());
      expect(res.statusCode, res.body).toBe(403);
      const error = (res.json() as { error: { code: string; details?: { permission?: string } } }).error;
      expect(error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
      expect(error.details?.permission).toBe(code);
      expect(await cartRows(who().id)).toEqual(before);
    });

    it('places the order as today for a holder of both (US 4.3)', async () => {
      const res = await place(holdsBoth);
      expect(res.statusCode, res.body).toBe(201);
      const orderId = (res.json() as { data: { order: { id: string } } }).data.order.id;
      const [row] = (await h.em().getConnection().execute(
        `select "placed_by_customer_account_id" from "orders" where "id" = ?`,
        [orderId],
      )) as Array<{ placed_by_customer_account_id: string }>;
      expect(row?.placed_by_customer_account_id).toBe(holdsBoth.id);
    });
  });
});
