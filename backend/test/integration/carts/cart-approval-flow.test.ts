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
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #619 — the cart-approval flow, end to end over HTTP.
 *
 * Two defects stopped an Organization that requires cart approval from ordering
 * at all:
 *
 *  1. a member's submit answered `pending` and stored nothing, because the
 *     service flushed an entity manager the cart had not been loaded into;
 *  2. the Organization administrator's list, detail, approve and reject read
 *     `Cart` — a `@CustomerScoped` entity — under their own customer context,
 *     so a member's cart was invisible to them and answered 404.
 *
 * Every assertion about a write reads the **stored** row, never only the
 * reply: the reply of defect 1 was the in-memory object, and was right.
 *
 * The fixture owns both Organizations, so the policy it switches on is nobody
 * else's: Org A requires approval and has two members and an administrator;
 * Org B is a foreign Organization with an administrator of its own, who must
 * see none of Org A's carts (Principle XI — 404, never 403).
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface CartRow {
  status: string;
  approval_status: string;
  submitted_for_approval_at: Date | null;
  approved_at: Date | null;
  approved_by_customer_account_id: string | null;
  rejected_at: Date | null;
  rejected_reason: string | null;
}

describe('cart approval, end to end (issue #619)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const MEMBER = { id: randomUUID(), cookie: `stub-i619-member-${RUN}` };
  const OTHER_MEMBER = { id: randomUUID(), cookie: `stub-i619-other-member-${RUN}` };
  const ADMIN_A = { id: randomUUID(), cookie: `stub-i619-admin-a-${RUN}` };
  const ADMIN_B = { id: randomUUID(), cookie: `stub-i619-admin-b-${RUN}` };
  let memberCartId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const [id, suffix] of [
      [ORG_A, 'A'],
      [ORG_B, 'B'],
    ] as const) {
      em.create(Organization, {
        id,
        name: `Issue 619 Org ${suffix} ${RUN}`,
        taxId: `PL619${suffix}${id.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
        status: 'active',
        vatStatus: 'vat_payer',
        requiresCartApproval: true,
        registeredAddress: { street: 'ul. Akceptacji 6', city: 'Warszawa', postalCode: '00-619', country: 'PL' },
      });
    }
    await em.flush();
    const accounts = [
      { ...MEMBER, organizationId: ORG_A, role: 'regular_user' as const, label: 'member' },
      { ...OTHER_MEMBER, organizationId: ORG_A, role: 'regular_user' as const, label: 'other-member' },
      { ...ADMIN_A, organizationId: ORG_A, role: 'organization_admin' as const, label: 'admin-a' },
      { ...ADMIN_B, organizationId: ORG_B, role: 'organization_admin' as const, label: 'admin-b' },
    ];
    for (const account of accounts) {
      em.create(CustomerAccount, {
        id: account.id,
        organizationId: account.organizationId,
        email: `i619-${account.label}-${RUN}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Issue619',
        lastName: account.label,
        role: account.role,
        emailVerifiedAt: new Date(),
      });
    }
    await em.flush();
    await addOrganizationChannels(h, ORG_A, ['pl_retail']);
    await addOrganizationChannels(h, ORG_B, ['pl_retail']);
    for (const account of accounts) {
      CUSTOMER_COOKIES[account.cookie] = {
        customerAccountId: account.id,
        organizationId: account.organizationId,
      };
    }
  }, 60_000);

  afterAll(async () => {
    for (const actor of [MEMBER, OTHER_MEMBER, ADMIN_A, ADMIN_B]) delete CUSTOMER_COOKIES[actor.cookie];
    await teardownBackendServer(h);
  });

  function call(
    actor: { cookie: string },
    method: 'GET' | 'POST',
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

  async function addLine(actor: { cookie: string }): Promise<void> {
    const res = await call(actor, 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function stored(cartId: string): Promise<CartRow> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select "status", "approval_status", "submitted_for_approval_at", "approved_at",
                "approved_by_customer_account_id", "rejected_at", "rejected_reason"
           from "carts" where "id" = ?`,
        [cartId],
      )) as CartRow[];
    expect(rows, `cart ${cartId} is stored`).toHaveLength(1);
    return rows[0]!;
  }

  async function auditActions(cartId: string): Promise<string[]> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select "action" from "cart_audit_entries" where "cart_id" = ? order by "occurred_at", "id"`, [
        cartId,
      ])) as Array<{ action: string }>;
    return rows.map((row) => row.action);
  }

  async function listedIds(actor: { cookie: string }, query = ''): Promise<string[]> {
    const res = await call(actor, 'GET', `/api/v1/organization/carts${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((cart) => cart.id);
  }

  it('a member submits: the cart is stored as pending, audited, and a second submit is refused', async () => {
    await addLine(MEMBER);
    const cartRes = await call(MEMBER, 'GET', '/api/v1/cart');
    expect(cartRes.statusCode, cartRes.body).toBe(200);
    const cart = (cartRes.json() as { data: { id: string; primaryCta: string } }).data;
    memberCartId = cart.id;
    expect(cart.primaryCta).toBe('submit_for_approval');

    const submit = await call(MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    expect((submit.json() as { data: { approvalStatus: string } }).data.approvalStatus).toBe('pending');

    const row = await stored(memberCartId);
    expect(row.approval_status).toBe('pending');
    expect(row.submitted_for_approval_at).not.toBeNull();
    expect(await auditActions(memberCartId)).toContain('approval_submitted');

    const read = (await call(MEMBER, 'GET', '/api/v1/cart')).json() as {
      data: { id: string; approvalStatus: string; primaryCta: string };
    };
    expect(read.data).toMatchObject({ id: memberCartId, approvalStatus: 'pending', primaryCta: 'awaiting_approval' });

    const again = await call(MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(again.statusCode, again.body).toBe(422);
    expect((again.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CART_APPROVAL_ALREADY_SUBMITTED,
    );
  });

  it("the Organization administrator lists and reads the member's pending cart", async () => {
    expect(await listedIds(ADMIN_A, '?approvalStatus=pending')).toContain(memberCartId);

    const detail = await call(ADMIN_A, 'GET', `/api/v1/organization/carts/${memberCartId}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect((detail.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: memberCartId,
      ownerCustomerAccountId: MEMBER.id,
      ownerDisplayName: `i619-member-${RUN}@example.com`,
      approvalStatus: 'pending',
      itemCount: 1,
    });
  });

  it("a foreign Organization's administrator neither sees nor acts on the cart (404)", async () => {
    expect(await listedIds(ADMIN_B)).not.toContain(memberCartId);
    for (const [method, path, payload] of [
      ['GET', '', undefined],
      ['POST', '/approve', {}],
      ['POST', '/reject', { reason: 'Not ours' }],
    ] as const) {
      const res = await call(ADMIN_B, method, `/api/v1/organization/carts/${memberCartId}${path}`, payload);
      expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    }
    expect((await stored(memberCartId)).approval_status).toBe('pending');
  });

  it('a member who is not an administrator is refused (403) and the cart is unchanged', async () => {
    for (const [method, path, payload] of [
      ['GET', '', undefined],
      ['POST', '/approve', {}],
      ['POST', '/reject', { reason: 'Not my call' }],
    ] as const) {
      const res = await call(OTHER_MEMBER, method, `/api/v1/organization/carts/${memberCartId}${path}`, payload);
      expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
    }
    expect((await call(OTHER_MEMBER, 'GET', '/api/v1/organization/carts')).statusCode).toBe(403);
    expect((await stored(memberCartId)).approval_status).toBe('pending');
  });

  it('the administrator approves: the cart is stored approved, and the member may check out', async () => {
    const res = await call(ADMIN_A, 'POST', `/api/v1/organization/carts/${memberCartId}/approve`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Record<string, unknown> }).data).toMatchObject({
      cartId: memberCartId,
      approvalStatus: 'approved',
    });

    const row = await stored(memberCartId);
    expect(row.approval_status).toBe('approved');
    expect(row.approved_at).not.toBeNull();
    expect(row.approved_by_customer_account_id).toBe(ADMIN_A.id);
    expect(await auditActions(memberCartId)).toContain('approval_approved');

    const read = (await call(MEMBER, 'GET', '/api/v1/cart')).json() as {
      data: { id: string; approvalStatus: string; primaryCta: string };
    };
    expect(read.data).toMatchObject({ id: memberCartId, approvalStatus: 'approved', primaryCta: 'checkout' });

    const twice = await call(ADMIN_A, 'POST', `/api/v1/organization/carts/${memberCartId}/approve`, {});
    expect(twice.statusCode, twice.body).toBe(422);
    expect((twice.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CART_APPROVAL_NOT_PENDING);
  });

  it('a member who changes an approved cart sends it back to pending (re-arm), stored', async () => {
    await addLine(MEMBER);
    expect((await stored(memberCartId)).approval_status).toBe('pending');
    expect(await auditActions(memberCartId)).toContain('approval_resubmission_required');
    expect(await listedIds(ADMIN_A, '?approvalStatus=pending')).toContain(memberCartId);
  });

  it('the administrator rejects with a reason: the cart is stored rejected', async () => {
    const res = await call(ADMIN_A, 'POST', `/api/v1/organization/carts/${memberCartId}/reject`, {
      reason: 'Over the quarterly budget',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Record<string, unknown> }).data).toMatchObject({
      cartId: memberCartId,
      status: 'rejected',
      approvalStatus: 'rejected_by_org_admin',
    });

    const row = await stored(memberCartId);
    expect(row.status).toBe('rejected');
    expect(row.approval_status).toBe('rejected_by_org_admin');
    expect(row.rejected_at).not.toBeNull();
    expect(row.rejected_reason).toBe('Over the quarterly budget');
    expect(await auditActions(memberCartId)).toContain('approval_rejected');

    const again = await call(ADMIN_A, 'POST', `/api/v1/organization/carts/${memberCartId}/reject`, {
      reason: 'Still no',
    });
    expect(again.statusCode, again.body).toBe(422);
    expect((again.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CART_APPROVAL_NOT_PENDING);
  });

  it("the administrator's own basket is not sent for approval: it reads checkout", async () => {
    await addLine(ADMIN_A);
    const read = (await call(ADMIN_A, 'GET', '/api/v1/cart')).json() as {
      data: { approvalStatus: string; primaryCta: string };
    };
    expect(read.data).toMatchObject({ approvalStatus: 'not_required', primaryCta: 'checkout' });
  });

  it("switching the policy off returns a member's pending cart to not_required, stored", async () => {
    await addLine(OTHER_MEMBER);
    const submit = await call(OTHER_MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    const cartId = (
      (await call(OTHER_MEMBER, 'GET', '/api/v1/cart')).json() as { data: { id: string } }
    ).data.id;
    expect((await stored(cartId)).approval_status).toBe('pending');

    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/policies/cart-approval',
      cookies: { b2b_session: ADMIN_A.cookie },
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { requiresCartApproval: false },
    });
    expect(res.statusCode, res.body).toBe(200);

    expect((await stored(cartId)).approval_status).toBe('not_required');
    expect(await auditActions(cartId)).toContain('approval_policy_reset');
    const read = (await call(OTHER_MEMBER, 'GET', '/api/v1/cart')).json() as {
      data: { approvalStatus: string; primaryCta: string };
    };
    expect(read.data).toMatchObject({ approvalStatus: 'not_required', primaryCta: 'checkout' });
  });
});
