import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  TEST_CUSTOMER_EMPTY_ID,
  TEST_CUSTOMER_ID,
  TEST_CUSTOMER_RFQ_ID,
} from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { CustomerGroup } from '../../helpers/package-entities.js';

/**
 * Issue #177 — a promotion targeted at a customer group must reach that
 * group's members on the cart, and only them.
 *
 * `carts` built the `CartSnapshot` it hands to the promotion engine with a
 * hard-coded `customerGroupId: null`, on both cart paths — the automatic
 * promotions rendered on every cart read (`computeApplication`) and the coupon
 * a buyer presents (`apply`). The engine's audience filter is
 * `p.customerGroupId && p.customerGroupId !== snapshot.customerGroupId`, so a
 * group-targeted promotion could never match and an operator's audience
 * setting was silently inert.
 *
 * This is a money path, so the assertions below pin **which** promotions change
 * side, and they use three buyers in one Organization to do it: a member of the
 * targeted group, a member of a second group, and a buyer with no group at all.
 * The Organization itself carries no group, so the account's own membership is
 * the only variable.
 */
describe('cart — customer-group targeted promotions (issue #177)', () => {
  let h: BackendServerHandle;
  /** The targeted group. */
  let vipGroupId: string;

  /** In `vipGroupId`. */
  const MEMBER = { b2b_session: 'stub-customer-session' };
  /** In a different group. */
  const OTHER_GROUP = { b2b_session: 'stub-customer-session-rfq' };
  /** In no group at all. */
  const NO_GROUP = { b2b_session: 'stub-empty-draft-customer-session' };
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();

    const em = h.em();
    const vip = em.create(CustomerGroup, { code: 'i177-vip', name: 'VIP (issue 177)' });
    const wholesale = em.create(CustomerGroup, {
      code: 'i177-wholesale',
      name: 'Wholesale (issue 177)',
    });
    await em.persistAndFlush([vip, wholesale]);
    vipGroupId = vip.id;

    const member = await em.findOne(CustomerAccount, { id: TEST_CUSTOMER_ID });
    member!.customerGroupId = vip.id;
    const otherGroup = await em.findOne(CustomerAccount, { id: TEST_CUSTOMER_RFQ_ID });
    otherGroup!.customerGroupId = wholesale.id;
    const noGroup = await em.findOne(CustomerAccount, { id: TEST_CUSTOMER_EMPTY_ID });
    noGroup!.customerGroupId = null;
    await em.persistAndFlush([member!, otherGroup!, noGroup!]);

    for (const cookies of [MEMBER, OTHER_GROUP, NO_GROUP]) {
      const add = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
        cookies,
      });
      expect(add.statusCode).toBe(200);
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const conn = h.em().getConnection();
    await conn.execute('truncate table promotions cascade');
    await conn.execute('update carts set applied_promotion_code = null');
  });

  async function createPromotion(payload: Record<string, unknown>): Promise<void> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload,
    });
    expect(created.statusCode).toBe(201);
  }

  interface CartData {
    subtotal: { amount: number };
    discount: { amount: number } | null;
    appliedPromotions: Array<{ promotionId: string; amount: number }>;
    grandTotal: { amount: number };
  }

  async function readCart(cookies: Record<string, string>): Promise<CartData> {
    const get = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies });
    expect(get.statusCode).toBe(200);
    return (get.json() as { data: CartData }).data;
  }

  /** Ten percent of the cart's own subtotal, rounded the way the engine rounds. */
  function tenPercentOf(cart: CartData): number {
    return Math.round(cart.subtotal.amount * 0.1 * 100) / 100;
  }

  it('applies an automatic group-targeted promotion to a member and to nobody else', async () => {
    await createPromotion({
      name: 'VIP 10% off',
      customerGroupId: vipGroupId,
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: {
        kind: 'condition',
        field: { kind: 'builtin', key: 'cartTotal' },
        op: 'gte',
        values: [1],
      },
    });

    const member = await readCart(MEMBER);
    const expected = tenPercentOf(member);
    expect(expected).toBeGreaterThan(0);
    expect(member.discount?.amount).toBe(expected);
    expect(member.appliedPromotions).toHaveLength(1);
    expect(member.grandTotal.amount).toBe(
      Math.round((member.subtotal.amount - expected) * 100) / 100,
    );

    for (const cookies of [OTHER_GROUP, NO_GROUP]) {
      const outsider = await readCart(cookies);
      expect(outsider.discount).toBeNull();
      expect(outsider.appliedPromotions).toHaveLength(0);
      expect(outsider.grandTotal.amount).toBe(outsider.subtotal.amount);
    }
  });

  it('accepts a group-restricted coupon for a member and refuses it for everyone else', async () => {
    await createPromotion({
      name: 'VIP coupon',
      code: 'I177VIP',
      kind: 'percentage_off',
      value: 10,
      customerGroupId: vipGroupId,
    });

    const accepted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      cookies: MEMBER,
      payload: { code: 'I177VIP' },
    });
    expect(accepted.statusCode).toBe(200);

    const memberCart = await readCart(MEMBER);
    expect(memberCart.discount?.amount).toBe(tenPercentOf(memberCart));

    for (const cookies of [OTHER_GROUP, NO_GROUP]) {
      const refused = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/coupon',
        cookies,
        payload: { code: 'I177VIP' },
      });
      expect(refused.statusCode).toBe(422);
      const details = (refused.json() as { error: { details?: { reason?: string } } }).error
        .details;
      expect(details?.reason).toBe('wrong_customer_group');
      expect((await readCart(cookies)).discount).toBeNull();
    }
  });

  it('stops applying a promotion whose rule excludes the buyer group', async () => {
    await createPromotion({
      name: 'Everyone but VIP',
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: {
        kind: 'condition',
        field: { kind: 'builtin', key: 'customerGroup' },
        op: 'notIn',
        values: [vipGroupId],
      },
    });

    // Before the fix the engine read `customerGroupId: null` for every buyer,
    // and `notIn` is false for a null subject — so this promotion applied to
    // nobody at all. It now applies to the buyer in another group, and still
    // not to the member the operator excluded.
    const member = await readCart(MEMBER);
    expect(member.discount).toBeNull();
    expect(member.appliedPromotions).toHaveLength(0);

    const otherGroup = await readCart(OTHER_GROUP);
    expect(otherGroup.discount?.amount).toBe(tenPercentOf(otherGroup));

    // Unchanged by this fix, and stated so it is not mistaken for one: a buyer
    // with no group is not "not in" a group under the engine's null semantics.
    const noGroup = await readCart(NO_GROUP);
    expect(noGroup.discount).toBeNull();
  });
});
