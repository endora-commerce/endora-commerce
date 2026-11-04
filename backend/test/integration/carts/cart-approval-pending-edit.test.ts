import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount, Organization } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { addOrganizationChannels } from '../../helpers/sales-channel-access.js';
import { requireCartApprovalForMembers } from '../../helpers/cart-approval-roles.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Issue #649 — a cart awaiting approval that its member changes goes back to
 * where it was before it was submitted, over HTTP.
 *
 * Owner ruling (2026-11-03, option b): every content change the `approved`
 * re-arm reacts to — a line added, a quantity changed, a line removed, a
 * coupon applied or removed — returns a `pending` cart to `not_required`, the
 * one state a submit starts from, so the administrator only ever approves what
 * the buyer submitted. The transition is audited, the cart leaves the
 * administrator's pending list, approve and reject answer
 * `CART_APPROVAL_NOT_PENDING`, and the buyer is offered the submit again.
 *
 * Every assertion about a write reads the **stored** row, as in
 * `cart-approval-flow.test.ts`.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface CartRow {
  approval_status: string;
  submitted_for_approval_at: Date | null;
  applied_promotion_code: string | null;
}

interface AuditRow {
  action: string;
  actor_type: string;
  actor_id: string | null;
  from_state: string | null;
  to_state: string | null;
}

interface CartPayload {
  id: string;
  approvalStatus: string;
  primaryCta: string;
  items: Array<{ id: string; productId: string; quantity: number }>;
}

describe('an edit to a pending cart returns it to its pre-submission state (issue #649)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const ORG = randomUUID();
  const MEMBER = { id: randomUUID(), cookie: `stub-i649-member-${RUN}` };
  const ADMIN = { id: randomUUID(), cookie: `stub-i649-admin-${RUN}` };
  const COUPON = `I649${RUN.toUpperCase()}`;
  const ADMIN_STAFF = { b2b_session: 'stub-admin-session' };
  let cartId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    em.create(Organization, {
      id: ORG,
      name: `Issue 649 Org ${RUN}`,
      taxId: `PL649${ORG.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Akceptacji 7', city: 'Warszawa', postalCode: '00-649', country: 'PL' },
    });
    await em.flush();
    // `specs/170-organization-roles/` WP-04 — approval is the role's: the
    // *Member* role as M2 maps an approval-requiring Organization.
    await requireCartApprovalForMembers(em, ORG);
    const accounts = [
      { ...MEMBER, role: 'member' as const, label: 'member' },
      { ...ADMIN, role: 'administrator' as const, label: 'admin' },
    ];
    for (const account of accounts) {
      em.create(CustomerAccount, {
        id: account.id,
        organizationId: ORG,
        email: `i649-${account.label}-${RUN}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Issue649',
        lastName: account.label,
        organizationRoleId: await predefinedRoleIdOf(em, ORG, account.role),
        emailVerifiedAt: new Date(),
      });
    }
    await em.flush();
    await addOrganizationChannels(h, ORG, ['pl_retail']);
    for (const account of accounts) {
      CUSTOMER_COOKIES[account.cookie] = { customerAccountId: account.id, organizationId: ORG };
    }

    const promotion = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: ADMIN_STAFF,
      payload: { name: `Issue 649 coupon ${RUN}`, code: COUPON, kind: 'percentage_off', value: 5 },
    });
    expect(promotion.statusCode, promotion.body).toBe(201);
  }, 60_000);

  afterAll(async () => {
    for (const actor of [MEMBER, ADMIN]) delete CUSTOMER_COOKIES[actor.cookie];
    await teardownBackendServer(h);
  });

  function call(
    actor: { cookie: string },
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return h.app.inject({
      method,
      url,
      cookies: { b2b_session: actor.cookie },
      headers: { ...CHANNEL, ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { payload } : {}),
    });
  }

  async function readCart(): Promise<CartPayload> {
    const res = await call(MEMBER, 'GET', '/api/v1/cart');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: CartPayload }).data;
  }

  async function addLine(productId: string, quantity = 1): Promise<void> {
    const res = await call(MEMBER, 'POST', '/api/v1/cart/items', { productId, quantity });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function stored(): Promise<CartRow> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select "approval_status", "submitted_for_approval_at", "applied_promotion_code"
           from "carts" where "id" = ?`,
        [cartId],
      )) as CartRow[];
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function withdrawals(): Promise<AuditRow[]> {
    return (await h
      .em()
      .getConnection()
      .execute(
        `select "action", "actor_type", "actor_id", "from_state", "to_state"
           from "cart_audit_entries"
          where "cart_id" = ? and "action" = 'approval_resubmission_required' and "from_state" = 'pending'
          order by "occurred_at", "id"`,
        [cartId],
      )) as AuditRow[];
  }

  async function pendingIds(): Promise<string[]> {
    const res = await call(ADMIN, 'GET', '/api/v1/organization/carts?approvalStatus=pending');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((cart) => cart.id);
  }

  async function submit(): Promise<void> {
    const res = await call(MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(res.statusCode, res.body).toBe(200);
    expect((await stored()).approval_status).toBe('pending');
    expect(await pendingIds()).toContain(cartId);
  }

  /** What every edit of a pending cart must leave behind. */
  async function expectWithdrawn(previousWithdrawals: number): Promise<void> {
    const row = await stored();
    expect(row.approval_status).toBe('not_required');
    expect(row.submitted_for_approval_at).toBeNull();

    const audit = await withdrawals();
    expect(audit).toHaveLength(previousWithdrawals + 1);
    expect(audit.at(-1)).toMatchObject({
      actor_type: 'customer',
      actor_id: MEMBER.id,
      from_state: 'pending',
      to_state: 'not_required',
    });

    expect(await pendingIds()).not.toContain(cartId);
    expect(await readCart()).toMatchObject({
      id: cartId,
      approvalStatus: 'not_required',
      primaryCta: 'submit_for_approval',
    });

    for (const [path, payload] of [
      ['/approve', {}],
      ['/reject', { reason: 'Changed after submit' }],
    ] as const) {
      const res = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}${path}`, payload);
      expect(res.statusCode, `${path}: ${res.body}`).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CART_APPROVAL_NOT_PENDING);
    }
    expect((await stored()).approval_status).toBe('not_required');
  }

  it('the fixture basket holds two lines and is offered the submit', async () => {
    await addLine(SEED_PRODUCT_101_ID);
    await addLine(SEED_PRODUCT_102_ID);
    const cart = await readCart();
    cartId = cart.id;
    expect(cart.items).toHaveLength(2);
    expect(cart.primaryCta).toBe('submit_for_approval');
  });

  it('adding a line', async () => {
    await submit();
    await addLine(SEED_PRODUCT_101_ID);
    await expectWithdrawn(0);
  });

  it('changing a quantity', async () => {
    await submit();
    const line = (await readCart()).items.find((item) => item.productId === SEED_PRODUCT_101_ID)!;
    const res = await call(MEMBER, 'PATCH', `/api/v1/cart/items/${line.id}`, { quantity: line.quantity + 1 });
    expect(res.statusCode, res.body).toBe(200);
    await expectWithdrawn(1);
  });

  it('removing a line', async () => {
    await submit();
    const line = (await readCart()).items.find((item) => item.productId === SEED_PRODUCT_102_ID)!;
    const res = await call(MEMBER, 'DELETE', `/api/v1/cart/items/${line.id}`);
    expect(res.statusCode, res.body).toBe(200);
    await expectWithdrawn(2);
  });

  it('applying a coupon', async () => {
    await submit();
    const res = await call(MEMBER, 'POST', '/api/v1/cart/coupon', { code: COUPON });
    expect(res.statusCode, res.body).toBe(200);
    expect((await stored()).applied_promotion_code).toBe(COUPON);
    await expectWithdrawn(3);
  });

  it('removing a coupon', async () => {
    await submit();
    const res = await call(MEMBER, 'DELETE', '/api/v1/cart/coupon');
    expect(res.statusCode, res.body).toBe(200);
    expect((await stored()).applied_promotion_code).toBeNull();
    await expectWithdrawn(4);
  });

  it('an approved cart re-armed by an edit is withdrawn by the next edit', async () => {
    await submit();
    const approve = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}/approve`, {});
    expect(approve.statusCode, approve.body).toBe(200);

    await addLine(SEED_PRODUCT_102_ID);
    expect((await stored()).approval_status).toBe('pending');
    expect(await pendingIds()).toContain(cartId);

    await addLine(SEED_PRODUCT_102_ID);
    await expectWithdrawn(5);
  });

  it('submitted again, the cart is approved', async () => {
    await submit();
    const res = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}/approve`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { approvalStatus: string } }).data.approvalStatus).toBe('approved');
    expect((await stored()).approval_status).toBe('approved');
    expect(await readCart()).toMatchObject({ approvalStatus: 'approved', primaryCta: 'checkout' });
  });
});
