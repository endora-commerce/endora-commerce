import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../../packages/modules/orders/i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;
const EN = bundle('en');
const PL = bundle('pl');

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface Actor {
  id: string;
  cookie: string;
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * Issue #648 — order placement enforces cart approval.
 *
 * In an Organization that requires cart approval, a member's basket may be
 * ordered only once its administrator has approved it. Until #648 nothing
 * outside `carts` read the approval state: the storefront hid the checkout
 * button, and `POST /api/v1/orders` (which the storefront `/checkout` page's
 * server action calls) placed the basket anyway.
 *
 * Every refusal is checked to have written nothing: no order for the
 * Organization, the basket still active with its lines, and its approval state
 * as it was. The administrator's own basket (self-approval exemption) and an
 * Organization without the policy place as before.
 */
describe('orders — placement refuses a basket that awaits approval (#648)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const ORG_POLICY = randomUUID();
  const ORG_OPEN = randomUUID();
  const MEMBER: Actor = { id: randomUUID(), cookie: `stub-i648-member-${RUN}` };
  const ADMIN: Actor = { id: randomUUID(), cookie: `stub-i648-admin-${RUN}` };
  const OPEN_MEMBER: Actor = { id: randomUUID(), cookie: `stub-i648-open-member-${RUN}` };
  const OPEN_ADMIN: Actor = { id: randomUUID(), cookie: `stub-i648-open-admin-${RUN}` };
  const addressOf = new Map<string, string>();
  /** The stock this file draws on, put back in `afterAll`: the database is shared. */
  let savedStock: Array<{ id: string; on_hand: number; reserved: number }> = [];

  function call(
    actor: Actor,
    method: 'GET' | 'POST',
    url: string,
    payload?: Record<string, unknown>,
    language: 'en' | 'pl' = 'en',
  ) {
    return h.app.inject({
      method,
      url,
      cookies: { b2b_session: actor.cookie },
      headers: {
        ...CHANNEL,
        'accept-language': language,
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const [id, suffix] of [
      [ORG_POLICY, 'A'],
      [ORG_OPEN, 'B'],
    ] as const) {
      em.create(Organization, {
        id,
        name: `Issue 648 Org ${suffix} ${RUN}`,
        taxId: `PL648${suffix}${id.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Akceptacji 8', city: 'Warszawa', postalCode: '00-648', country: 'PL' },
      });
    }
    await em.flush();
    // `specs/170-organization-roles/` — approval is the role's
    // (`carts.order_without_approval`): ORG_POLICY's *Member* role as M2 maps an
    // approval-requiring Organization; ORG_OPEN's keeps every member default.
    await requireCartApprovalForMembers(em, ORG_POLICY);
    const accounts = [
      { ...MEMBER, organizationId: ORG_POLICY, role: 'member' as const, label: 'member' },
      { ...ADMIN, organizationId: ORG_POLICY, role: 'administrator' as const, label: 'admin' },
      { ...OPEN_MEMBER, organizationId: ORG_OPEN, role: 'member' as const, label: 'open-member' },
      { ...OPEN_ADMIN, organizationId: ORG_OPEN, role: 'administrator' as const, label: 'open-admin' },
    ];
    for (const account of accounts) {
      em.create(CustomerAccount, {
        id: account.id,
        organizationId: account.organizationId,
        email: `i648-${account.label}-${RUN}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Issue648',
        lastName: account.label,
        organizationRoleId: await predefinedRoleIdOf(em, account.organizationId, account.role),
        emailVerifiedAt: new Date(),
      });
    }
    await em.flush();
    await addOrganizationChannels(h, ORG_POLICY, ['pl_retail']);
    await addOrganizationChannels(h, ORG_OPEN, ['pl_retail']);
    for (const account of accounts) {
      CUSTOMER_COOKIES[account.cookie] = {
        customerAccountId: account.id,
        organizationId: account.organizationId,
      };
    }
    // One address per Organization, written by its administrator.
    for (const [organizationId, admin] of [
      [ORG_POLICY, ADMIN],
      [ORG_OPEN, OPEN_ADMIN],
    ] as const) {
      const res = await call(admin, 'POST', '/api/v1/organizations/mine/addresses', {
        kind: 'delivery',
        recipientName: 'Issue 648',
        street: 'ul. Odbioru 8',
        city: 'Warszawa',
        postalCode: '00-648',
        country: 'PL',
        isDefault: true,
      });
      expect(res.statusCode, res.body).toBe(201);
      addressOf.set(organizationId, (res.json() as { data: { id: string } }).data.id);
    }

    const connection = h.em().getConnection();
    savedStock = await connection.execute(
      `select "id", "on_hand", "reserved" from "stock_levels" where "product_id" = ?`,
      [SEED_PRODUCT_101_ID],
    );
    await connection.execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
      SEED_PRODUCT_101_ID,
    ]);
  }, 60_000);

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const row of savedStock) {
      await connection.execute(`update "stock_levels" set "on_hand" = ?, "reserved" = ? where "id" = ?`, [
        row.on_hand,
        row.reserved,
        row.id,
      ]);
    }
    for (const actor of [MEMBER, ADMIN, OPEN_MEMBER, OPEN_ADMIN]) delete CUSTOMER_COOKIES[actor.cookie];
    await teardownBackendServer(h);
  });

  async function addLine(actor: Actor): Promise<string> {
    const res = await call(actor, 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(res.statusCode, res.body).toBe(200);
    const read = await call(actor, 'GET', '/api/v1/cart');
    expect(read.statusCode, read.body).toBe(200);
    return (read.json() as { data: { id: string } }).data.id;
  }

  function place(actor: Actor, organizationId: string, language: 'en' | 'pl' = 'en') {
    const addressId = addressOf.get(organizationId)!;
    return call(
      actor,
      'POST',
      '/api/v1/orders',
      {
        deliveryAddressId: addressId,
        billingAddressId: addressId,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      language,
    );
  }

  async function storedCart(cartId: string): Promise<{ status: string; approval_status: string; lines: number }> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select c."status", c."approval_status",
                (select count(*)::int from "cart_items" i where i."cart_id" = c."id") as "lines"
           from "carts" c where c."id" = ?`,
        [cartId],
      )) as Array<{ status: string; approval_status: string; lines: number }>;
    expect(rows, `cart ${cartId} is stored`).toHaveLength(1);
    return rows[0]!;
  }

  async function orderCount(organizationId: string): Promise<number> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as "n" from "orders" where "organization_id" = ?`, [organizationId])) as Array<{
      n: number;
    }>;
    return rows[0]!.n;
  }

  async function expectRefused(
    cartId: string,
    approvalStatus: 'not_required' | 'pending',
    token: 'cart_approval_not_submitted' | 'cart_approval_pending',
  ): Promise<void> {
    const ordersBefore = await orderCount(ORG_POLICY);
    for (const [language, sentences] of [
      ['en', EN],
      ['pl', PL],
    ] as const) {
      const res = await place(MEMBER, ORG_POLICY, language);
      expect(res.statusCode, res.body).toBe(409);
      const { error } = res.json() as ErrorBody;
      expect(error).toMatchObject({
        code: ERROR_CODES.ORDER_CART_APPROVAL_REQUIRED,
        details: { code: token, approvalStatus },
      });
      const sentence = sentences[`errors.ORDER_CART_APPROVAL_REQUIRED.${token}`];
      expect(sentence, `${language} sentence for ${token}`).toBeTruthy();
      expect(error.message).toBe(sentence);
    }
    expect(await orderCount(ORG_POLICY)).toBe(ordersBefore);
    expect(await storedCart(cartId)).toEqual({ status: 'active', approval_status: approvalStatus, lines: 1 });
  }

  it('refuses a member’s basket that was never sent for approval, writing nothing', async () => {
    const cartId = await addLine(MEMBER);
    expect((await storedCart(cartId)).approval_status).toBe('not_required');
    await expectRefused(cartId, 'not_required', 'cart_approval_not_submitted');
  });

  it('refuses a member’s basket that awaits its administrator, writing nothing', async () => {
    const cartId = (
      (await call(MEMBER, 'GET', '/api/v1/cart')).json() as { data: { id: string } }
    ).data.id;
    const submit = await call(MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    await expectRefused(cartId, 'pending', 'cart_approval_pending');
  });

  it('places a member’s basket once the administrator has approved it', async () => {
    const cartId = (
      (await call(MEMBER, 'GET', '/api/v1/cart')).json() as { data: { id: string } }
    ).data.id;
    const approve = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}/approve`, {});
    expect(approve.statusCode, approve.body).toBe(200);

    const res = await place(MEMBER, ORG_POLICY);
    expect(res.statusCode, res.body).toBe(201);
    expect((await storedCart(cartId)).status).toBe('completed');
  });

  it('never places a basket the administrator rejected', async () => {
    const cartId = await addLine(MEMBER);
    const submit = await call(MEMBER, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    const reject = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}/reject`, {
      reason: 'Over budget',
    });
    expect(reject.statusCode, reject.body).toBe(200);

    const ordersBefore = await orderCount(ORG_POLICY);
    const res = await place(MEMBER, ORG_POLICY);
    // A rejected basket leaves `active`, so it is not the basket placement
    // reads; whatever the member holds instead is not an approved one.
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(await orderCount(ORG_POLICY)).toBe(ordersBefore);
    expect(await storedCart(cartId)).toMatchObject({ status: 'rejected', approval_status: 'rejected_by_org_admin' });

    // The member's next basket starts unsubmitted and is refused as such.
    const next = await addLine(MEMBER);
    expect(next).not.toBe(cartId);
    await expectRefused(next, 'not_required', 'cart_approval_not_submitted');
  });

  it('places the administrator’s own basket without approval (self-approval exemption)', async () => {
    const cartId = await addLine(ADMIN);
    expect((await storedCart(cartId)).approval_status).toBe('not_required');
    const res = await place(ADMIN, ORG_POLICY);
    expect(res.statusCode, res.body).toBe(201);
    expect((await storedCart(cartId)).status).toBe('completed');
  });

  it('places a member’s basket in an Organization without the policy', async () => {
    const cartId = await addLine(OPEN_MEMBER);
    const res = await place(OPEN_MEMBER, ORG_OPEN);
    expect(res.statusCode, res.body).toBe(201);
    expect((await storedCart(cartId)).status).toBe('completed');
  });
});
