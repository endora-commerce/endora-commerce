import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cartFullResponseSchema, orgCartDetailViewResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { CustomerAccount, Organization } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { addOrganizationChannels } from '../../helpers/sales-channel-access.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #650 — the two reads the storefront's approval screens are built on.
 *
 *  1. The Organization administrator's cart detail carries the cart's lines, so
 *     the administrator can see what they are approving.
 *  2. A buyer whose basket was rejected learns it: a rejection closes the basket
 *     (`status = 'rejected'`), so the next cart read is a new active basket and
 *     its own `approvalStatus` can never say `rejected_by_org_admin`. The cart
 *     answer carries `previousRejection` — the rejection of the buyer's last
 *     closed basket on the channel — until the buyer sends a basket again.
 *
 * Both replies are parsed with strict copies of the published schemas, so a
 * key the route answers and the contract does not declare reds this file.
 */

const RETAIL = { 'x-sales-channel': 'pl_retail' };
const VIP = { 'x-sales-channel': 'pl_b2b_vip' };
const REASON = 'Over the quarterly budget';

const strictFull = deepStrict(cartFullResponseSchema);
const strictDetail = deepStrict(orgCartDetailViewResponseSchema);

interface PreviousRejection {
  cartId: string;
  rejectedAt: string;
  reason: string | null;
}

interface CartRead {
  id: string;
  status: string;
  approvalStatus: string;
  itemCount: number;
  previousRejection: PreviousRejection | null;
}

describe('cart approval reads for the storefront (issue #650)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const ORG = randomUUID();
  const MEMBER = { id: randomUUID(), cookie: `stub-i650-member-${RUN}` };
  const OTHER_MEMBER = { id: randomUUID(), cookie: `stub-i650-other-${RUN}` };
  const ADMIN = { id: randomUUID(), cookie: `stub-i650-admin-${RUN}` };
  let rejectedCartId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    em.create(Organization, {
      id: ORG,
      name: `Issue 650 Org ${RUN}`,
      taxId: `PL650${ORG.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      requiresCartApproval: true,
      registeredAddress: { street: 'ul. Akceptacji 6', city: 'Warszawa', postalCode: '00-650', country: 'PL' },
    });
    await em.flush();
    const accounts = [
      { ...MEMBER, role: 'regular_user' as const, label: 'member' },
      { ...OTHER_MEMBER, role: 'regular_user' as const, label: 'other' },
      { ...ADMIN, role: 'organization_admin' as const, label: 'admin' },
    ];
    for (const account of accounts) {
      em.create(CustomerAccount, {
        id: account.id,
        organizationId: ORG,
        email: `i650-${account.label}-${RUN}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Issue650',
        lastName: account.label,
        role: account.role,
        emailVerifiedAt: new Date(),
      });
    }
    await em.flush();
    await addOrganizationChannels(h, ORG, ['pl_retail', 'pl_b2b_vip']);
    for (const account of accounts) {
      CUSTOMER_COOKIES[account.cookie] = { customerAccountId: account.id, organizationId: ORG };
    }
  }, 60_000);

  afterAll(async () => {
    for (const actor of [MEMBER, OTHER_MEMBER, ADMIN]) delete CUSTOMER_COOKIES[actor.cookie];
    await teardownBackendServer(h);
  });

  function call(
    actor: { cookie: string },
    method: 'GET' | 'POST',
    url: string,
    payload?: Record<string, unknown>,
    channel: Record<string, string> = RETAIL,
  ) {
    return h.app.inject({
      method,
      url,
      cookies: { b2b_session: actor.cookie },
      headers: { ...channel, ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { payload } : {}),
    });
  }

  async function readCart(actor: { cookie: string }, channel = RETAIL): Promise<CartRead> {
    const res = await call(actor, 'GET', '/api/v1/cart', undefined, channel);
    expect(res.statusCode, res.body).toBe(200);
    expect(disagreements(strictFull, res.json())).toEqual([]);
    return (res.json() as { data: CartRead }).data;
  }

  async function addLine(actor: { cookie: string }, quantity = 1) {
    const res = await call(actor, 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity });
    expect(res.statusCode, res.body).toBe(200);
    return res;
  }

  it('a basket that was never rejected carries no previous rejection', async () => {
    expect((await readCart(MEMBER)).previousRejection).toBeNull();
  });

  it("the administrator's detail of a pending cart carries its lines", async () => {
    await addLine(MEMBER, 3);
    const submit = await call(MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    rejectedCartId = (await readCart(MEMBER)).id;

    const res = await call(ADMIN, 'GET', `/api/v1/organization/carts/${rejectedCartId}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(disagreements(strictDetail, res.json())).toEqual([]);
    const detail = (res.json() as {
      data: {
        approvalStatus: string;
        itemCount: number;
        submittedForApprovalAt: string | null;
        total: { amount: number };
        items: Array<{
          productId: string;
          quantity: number;
          unitPrice: { amount: number; currency: string };
          lineTotal: { amount: number; currency: string };
          displayName: string | null;
          productSku: string | null;
        }>;
      };
    }).data;
    expect(detail.approvalStatus).toBe('pending');
    expect(detail.submittedForApprovalAt).not.toBeNull();
    expect(detail.items).toHaveLength(1);
    const [line] = detail.items;
    expect(line).toMatchObject({ productId: SEED_PRODUCT_101_ID, quantity: 3 });
    expect(line!.displayName).toEqual(expect.any(String));
    expect(line!.lineTotal.amount).toBeCloseTo(line!.unitPrice.amount * 3, 2);
    expect(detail.total.amount).toBeCloseTo(line!.lineTotal.amount, 2);
  });

  it('after a rejection the buyer reads a new basket that carries the rejection and its reason', async () => {
    const reject = await call(ADMIN, 'POST', `/api/v1/organization/carts/${rejectedCartId}/reject`, {
      reason: REASON,
    });
    expect(reject.statusCode, reject.body).toBe(200);

    const cart = await readCart(MEMBER);
    expect(cart.id).not.toBe(rejectedCartId);
    expect(cart).toMatchObject({ status: 'active', approvalStatus: 'not_required', itemCount: 0 });
    expect(cart.previousRejection).toMatchObject({ cartId: rejectedCartId, reason: REASON });
    expect(Number.isNaN(Date.parse(cart.previousRejection!.rejectedAt))).toBe(false);
  });

  it('a mutation answer carries it too, so the reply and the next read agree', async () => {
    const res = await addLine(MEMBER);
    expect(disagreements(strictFull, res.json())).toEqual([]);
    expect((res.json() as { data: CartRead }).data.previousRejection).toMatchObject({ cartId: rejectedCartId });
  });

  it("is the buyer's own: another member of the Organization reads none", async () => {
    expect((await readCart(OTHER_MEMBER)).previousRejection).toBeNull();
  });

  it('is of the channel: the same buyer on another storefront reads none', async () => {
    expect((await readCart(MEMBER, VIP)).previousRejection).toBeNull();
  });

  it('is gone once the buyer sends a basket again', async () => {
    const submit = await call(MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    const cart = await readCart(MEMBER);
    expect(cart.approvalStatus).toBe('pending');
    expect(cart.previousRejection).toBeNull();
  });

  it('is gone once a basket of the buyer on the channel is completed after it', async () => {
    await addLine(OTHER_MEMBER);
    expect((await call(OTHER_MEMBER, 'POST', '/api/v1/cart/submit-for-approval')).statusCode).toBe(200);
    const otherCartId = (await readCart(OTHER_MEMBER)).id;
    const reject = await call(ADMIN, 'POST', `/api/v1/organization/carts/${otherCartId}/reject`, { reason: 'No' });
    expect(reject.statusCode, reject.body).toBe(200);
    expect((await readCart(OTHER_MEMBER)).previousRejection).toMatchObject({ cartId: otherCartId });

    // The new basket, completed: a quote request made from it is an answer to the rejection.
    await addLine(OTHER_MEMBER);
    const convert = await call(OTHER_MEMBER, 'POST', '/api/v1/cart/convert-to-quote-request', {});
    expect(convert.statusCode, convert.body).toBe(200);
    expect((await readCart(OTHER_MEMBER)).previousRejection).toBeNull();
  });
});
