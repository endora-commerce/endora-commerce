import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderSchema } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  AdminRole,
  AdminUser,
  Organization,
  OrganizationSalesRepAssignment,
  StockLevel,
} from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

interface OrderReply {
  id: string;
  total: string;
  subtotal: string;
  taxTotal: string;
  itemGroups: Array<{ id: string; name: string; position: number }>;
  items: Array<{ productId: string; groupId: string | null; position: number; quantity: number }>;
}

/**
 * Feature 159, US5 — an administrator creates an order with its lines grouped
 * (`specs/159-quote-request-item-groups/contracts/orders-api.md` §1; FR-060 …
 * FR-063, FR-080, FR-081).
 */
describe('159 — POST /api/v1/admin/orders with line groups [contract]', () => {
  const OTHER_REP_ID = randomUUID();
  let h: BackendServerHandle;
  let channelId = '';
  const stamp = Date.now();
  const REP_SESSION = `stub-159-orders-rep-${stamp}`;

  const sql = async <T extends object>(query: string, params: unknown[] = []): Promise<T[]> =>
    h.em().getConnection().execute<T[]>(query, params);

  const create = (
    body: { groups?: unknown; items: unknown[]; [key: string]: unknown },
    cookies: Record<string, string> = ADMIN,
  ) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        ...body,
      },
    });

  const shapeOf = (order: OrderReply) => {
    const names = new Map(order.itemGroups.map((group) => [group.id, group.name]));
    return order.items.map((item) => [item.groupId ? names.get(item.groupId) : '-', item.productId, item.position]);
  };

  /** Order groups carrying `name` — names are unique per case, so parallel files cannot disturb the count. */
  const groupsNamed = async (name: string) =>
    Number(
      (await sql<{ count: string }>(`select count(*)::text as "count" from "order_item_groups" where "name" = ?`, [name]))[0]!
        .count,
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await systemDefaultSalesChannelId(h.em());
    const em = h.em();
    for (const productId of [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID]) {
      if ((await em.count(StockLevel, { productId }, { filters: false })) === 0) {
        em.create(StockLevel, { productId, warehouseId: '00000000-0000-4000-8000-00000000d017', onHand: 100, reserved: 0 });
      }
    }
    await em.flush();
    await em.execute(`update "stock_levels" set "on_hand" = 100000`);
    // A representative holding `orders:write` for another Organization only (FR-080).
    await withSystemScope('159: an orders representative of another organisation', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['orders:read', 'orders:write'];
      if (!role) role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      else role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      await fork.persistAndFlush(role);
      const org = fork.create(Organization, {
        name: `159 orders foreign ${stamp}`,
        taxId: `PL159O${String(stamp).slice(-7)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
      });
      const rep = fork.create(AdminUser, {
        email: `159-orders-rep-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '159',
        lastName: 'Rep',
      });
      await fork.persistAndFlush([org, rep]);
      await fork.persistAndFlush(fork.create(OrganizationSalesRepAssignment, { organizationId: org.id, adminUserId: rep.id }));
      // #305 — the seeded organization is another representative's: an
      // unassigned organization is in every representative's reach.
      await fork.persistAndFlush(fork.create(OrganizationSalesRepAssignment, { organizationId: TEST_ORGANIZATION_ID, adminUserId: OTHER_REP_ID }));
      ADMIN_COOKIES[REP_SESSION] = { adminUserId: rep.id };
    });
  }, 90_000);

  afterAll(async () => {
    await h.em().getConnection().execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [OTHER_REP_ID]);
    delete ADMIN_COOKIES[REP_SESSION];
    await teardownBackendServer(h);
  });

  it('creates the order with its groups, their order, membership and line order; an empty group is not created', async () => {
    const hallA = `Hall A ${randomUUID()}`;
    const unused = `Unused ${randomUUID()}`;
    const res = await create({
      groups: [
        { key: 'g1', name: hallA },
        { key: 'g0', name: unused },
        { key: 'g2', name: 'Hall B' },
      ],
      items: [
        { productId: SEED_PRODUCT_103_ID, quantity: 1, groupKey: 'g1' },
        { productId: SEED_PRODUCT_101_ID, quantity: 2, groupKey: 'g1' },
        { productId: SEED_PRODUCT_102_ID, quantity: 1, groupKey: 'g2' },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const order = (res.json() as { data: OrderReply }).data;
    expect(order.itemGroups.map((group) => [group.name, group.position])).toEqual([
      [hallA, 0],
      ['Hall B', 1],
    ]);
    expect(shapeOf(order)).toEqual([
      [hallA, SEED_PRODUCT_103_ID, 0],
      [hallA, SEED_PRODUCT_101_ID, 1],
      ['Hall B', SEED_PRODUCT_102_ID, 0],
    ]);
    expect(await groupsNamed(unused)).toBe(0);
    expect(disagreements(deepStrict(orderSchema), order)).toEqual([]);

    // Read back by the operator and the customer: the same arrangement (FR-063: read-only, nothing else to do).
    const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${order.id}`, cookies: ADMIN });
    expect(shapeOf((admin.json() as { data: OrderReply }).data)).toEqual(shapeOf(order));
    const mine = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, cookies: CUSTOMER });
    expect(shapeOf((mine.json() as { data: OrderReply }).data)).toEqual(shapeOf(order));
  });

  it('ungrouped lines follow the groups, in request order', async () => {
    const res = await create({
      groups: [{ key: 'g', name: 'Only' }],
      items: [
        { productId: SEED_PRODUCT_102_ID, quantity: 1 },
        { productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'g' },
        { productId: SEED_PRODUCT_103_ID, quantity: 1, groupKey: null },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(shapeOf((res.json() as { data: OrderReply }).data)).toEqual([
      ['Only', SEED_PRODUCT_101_ID, 0],
      ['-', SEED_PRODUCT_102_ID, 0],
      ['-', SEED_PRODUCT_103_ID, 1],
    ]);
  });

  it('totals exactly what the same order created without groups totals', async () => {
    const items = [
      { productId: SEED_PRODUCT_101_ID, quantity: 2 },
      { productId: SEED_PRODUCT_102_ID, quantity: 1 },
    ];
    const plain = await create({ items });
    const grouped = await create({
      groups: [{ key: 'g', name: 'G' }],
      items: items.map((item, index) => ({ ...item, groupKey: index === 0 ? 'g' : null })),
    });
    expect(plain.statusCode, plain.body).toBe(201);
    expect(grouped.statusCode, grouped.body).toBe(201);
    const pick = (res: typeof plain) => {
      const order = (res.json() as { data: OrderReply }).data;
      return { total: order.total, subtotal: order.subtotal, taxTotal: order.taxTotal };
    };
    expect(pick(grouped)).toEqual(pick(plain));
    expect((plain.json() as { data: OrderReply }).data.itemGroups).toEqual([]);
  });

  it('places one product on lines of two groups — each line its own, in its group, at its own quantity (N-31)', async () => {
    const y = `Y ${randomUUID()}`;
    const z = `Z ${randomUUID()}`;
    const res = await create({
      groups: [
        { key: 'y', name: y },
        { key: 'z', name: z },
      ],
      items: [
        { productId: SEED_PRODUCT_101_ID, quantity: 5, groupKey: 'y' },
        { productId: SEED_PRODUCT_102_ID, quantity: 1, groupKey: 'z' },
        { productId: SEED_PRODUCT_101_ID, quantity: 3, groupKey: 'z' },
        { productId: SEED_PRODUCT_101_ID, quantity: 2 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const order = (res.json() as { data: OrderReply }).data;
    expect(shapeOf(order)).toEqual([
      [y, SEED_PRODUCT_101_ID, 0],
      [z, SEED_PRODUCT_102_ID, 0],
      [z, SEED_PRODUCT_101_ID, 1],
      ['-', SEED_PRODUCT_101_ID, 0],
    ]);
    expect(order.items.map((item) => item.quantity)).toEqual([5, 1, 3, 2]);
    expect(disagreements(deepStrict(orderSchema), order)).toEqual([]);
  });

  it('the same layout comes back however often it is created — the basket order is deterministic (N-31)', async () => {
    for (let round = 0; round < 3; round += 1) {
      const res = await create({
        groups: [
          { key: 'y', name: 'Y' },
          { key: 'z', name: 'Z' },
        ],
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 3, groupKey: 'z' },
          { productId: SEED_PRODUCT_101_ID, quantity: 4, groupKey: 'y' },
          { productId: SEED_PRODUCT_101_ID, quantity: 3, groupKey: 'y' },
        ],
      });
      expect(res.statusCode, res.body).toBe(201);
      const order = (res.json() as { data: OrderReply }).data;
      expect(shapeOf(order).map(([section]) => section)).toEqual(['Y', 'Y', 'Z']);
      expect(order.items.map((item) => item.quantity)).toEqual([4, 3, 3]);
    }
  });

  it('a repeated product with no grouping is two lines too — the request is the order (N-31)', async () => {
    const res = await create({
      items: [
        { productId: SEED_PRODUCT_101_ID, quantity: 2 },
        { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const order = (res.json() as { data: OrderReply }).data;
    expect(order.items.map((item) => [item.productId, item.quantity])).toEqual([
      [SEED_PRODUCT_101_ID, 2],
      [SEED_PRODUCT_101_ID, 1],
    ]);
  });

  it('a malformed grouping is a 400 (unknown key, duplicate keys)', async () => {
    const unknownKey = await create({
      groups: [{ key: 'a', name: 'A' }],
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'zzz' }],
    });
    expect(unknownKey.statusCode, unknownKey.body).toBe(400);
    const duplicate = await create({
      groups: [
        { key: 'a', name: 'A' },
        { key: 'a', name: 'B' },
      ],
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'a' }],
    });
    expect(duplicate.statusCode, duplicate.body).toBe(400);
  });

  it('a creation refused at placement writes no group (FR-061)', async () => {
    const name = `Refused ${randomUUID()}`;
    await sql(`update "stock_levels" set "on_hand" = 0 where "product_id" = ?`, [SEED_PRODUCT_103_ID]);
    try {
      const res = await create({
        groups: [{ key: 'g', name }],
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'g' },
          { productId: SEED_PRODUCT_103_ID, quantity: 5, groupKey: 'g' },
        ],
      });
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    } finally {
      await sql(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [SEED_PRODUCT_103_ID]);
    }
    expect(await groupsNamed(name)).toBe(0);
  });

  it('a refused method writes no group either', async () => {
    const name = `No method ${randomUUID()}`;
    const res = await create({
      paymentMethodId: randomUUID(),
      groups: [{ key: 'g', name }],
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'g' }],
    });
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(await groupsNamed(name)).toBe(0);
  });

  it('records the grouping shape on the order.place_on_behalf audit entry (FR-081) — line counts, never a value (D-288)', async () => {
    const res = await create({
      groups: [
        { key: 'a', name: `S470-HALL-A-${stamp}` },
        { key: 'b', name: `S470-HALL-B-${stamp}` },
      ],
      items: [
        { productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'a' },
        { productId: SEED_PRODUCT_102_ID, quantity: 1, groupKey: 'a' },
        { productId: SEED_PRODUCT_103_ID, quantity: 1, groupKey: 'b' },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const order = (res.json() as { data: OrderReply }).data;
    const orderId = order.id;
    const audits = await h
      .em()
      .fork()
      .find(AuditLogEntry, { objectType: 'order', objectId: orderId, action: 'order.place_on_behalf' });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.stateAfter).toMatchObject({ groups: [{ lineCount: 2 }, { lineCount: 1 }] });

    // The platform audit log, as `audit_log:read` reads it: no group name, no
    // amount, no currency and no tenant anchor of the order (#470).
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${orderId}&filter[action]=order.place_on_behalf`,
      cookies: ADMIN,
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = (read.json() as { data: Array<{ stateBefore: unknown; stateAfter: unknown }> }).data;
    expect(rows).toHaveLength(1);
    const recorded = JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter]));
    for (const sentinel of ['S470-HALL', order.total, TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID, '"currency"', '"total"']) {
      expect(recorded, sentinel).not.toContain(sentinel);
    }

    // An ungrouped creation records no `groups` at all.
    const plain = await create({ items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] });
    const plainId = (plain.json() as { data: OrderReply }).data.id;
    const plainAudit = await h
      .em()
      .fork()
      .findOneOrFail(AuditLogEntry, { objectType: 'order', objectId: plainId, action: 'order.place_on_behalf' });
    expect(plainAudit.stateAfter).not.toHaveProperty('groups');
  });

  it('a representative creating for a customer outside their scope is refused as today, and nothing is grouped (FR-080)', async () => {
    const name = `Out of scope ${randomUUID()}`;
    const res = await create(
      { groups: [{ key: 'g', name }], items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'g' }] },
      { b2b_session: REP_SESSION },
    );
    expect(res.statusCode, res.body).toBe(403);
    expect(await groupsNamed(name)).toBe(0);
  });
});
