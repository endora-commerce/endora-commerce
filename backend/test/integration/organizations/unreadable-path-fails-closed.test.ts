import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { CustomerAccount, Order } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * A stored path the tree cannot read never widens anything.
 *
 * The create hook and the repair migration mean no current writer leaves an
 * organization with an empty or malformed `path`. This file is about the row
 * that gets there anyway — written here in raw SQL, which is exactly how it
 * would arrive — and asserts that every reading of it is the narrow one: a
 * subtree of itself, no ancestors, a tenant scope of one organization for an
 * account with the roll-up capability, and a refused move.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

async function seedOrder(em: EntityManager, orgId: string, customerId: string): Promise<void> {
  const order = em.create(Order, {
    organizationId: orgId,
    placedByCustomerAccountId: customerId,
    salesChannelId: randomUUID(),
    status: 'paid',
    paymentStatus: 'paid',
    deliveryAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'p', name: 'P', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
    subtotal: '10.00',
    taxTotal: '0.00',
    deliveryTotal: '0.00',
    total: '10.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
}

describe('organizations — an unreadable stored path fails closed [real DB]', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;
  const ids = { empty: '', malformed: '', neighbour: '', child: '' };
  const rollupCookie = 'stub-unreadable-path-rollup';

  async function setPath(id: string, path: string): Promise<void> {
    await h.em().getConnection().execute('update "organizations" set "path" = ? where "id" = ?', [
      path,
      id,
    ]);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(() => h.em());
    const em = h.em();

    const empty = await seedAdHocOrganization(em, 'Unreadable Empty');
    const malformed = await seedAdHocOrganization(em, 'Unreadable Malformed');
    const neighbour = await seedAdHocOrganization(em, 'Unreadable Neighbour');
    const child = await seedAdHocOrganization(em, 'Unreadable Neighbour Child');
    Object.assign(ids, {
      empty: empty.id,
      malformed: malformed.id,
      neighbour: neighbour.id,
      child: child.id,
    });
    // A real two-level tree beside them, so "matches everything" has something
    // to match.
    await setPath(child.id, `/${neighbour.id}/${child.id}/`);
    await h
      .em()
      .getConnection()
      .execute('update "organizations" set "parent_id" = ? where "id" = ?', [neighbour.id, child.id]);
    // The two states under test, written the way they would arrive.
    await setPath(empty.id, '');
    await setPath(malformed.id, `${malformed.id}/`);

    const account = em.create(CustomerAccount, {
      organizationId: empty.id,
      email: `unreadable-${randomUUID()}@example.com`,
      passwordHash: 'x',
      firstName: 'Roll',
      lastName: 'Up',
      role: 'organization_admin',
      subtreeRollupEnabled: true,
    });
    await em.persistAndFlush(account);
    for (const orgId of [empty.id, malformed.id, neighbour.id, child.id]) {
      await seedOrder(em, orgId, account.id);
    }
    CUSTOMER_COOKIES[rollupCookie] = { customerAccountId: account.id, organizationId: empty.id };
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[rollupCookie];
    await teardownBackendServer(h);
  });

  it('answers an empty-path organization alone as its subtree', async () => {
    expect(await tree.subtreeIds(ids.empty)).toEqual([ids.empty]);
    expect(await tree.descendantIds(ids.empty)).toEqual([]);
    expect((await tree.subtreeNodes(ids.empty)).map((n) => n.id)).toEqual([ids.empty]);
    expect(await tree.ancestorIds(ids.empty)).toEqual([]);
  });

  it('answers a malformed-path organization alone as its subtree', async () => {
    expect(await tree.subtreeIds(ids.malformed)).toEqual([ids.malformed]);
    expect((await tree.subtreeNodes(ids.malformed)).map((n) => n.id)).toEqual([ids.malformed]);
    expect(await tree.ancestorIds(ids.malformed)).toEqual([]);
  });

  it('leaves a readable tree beside them reading as before', async () => {
    expect(await tree.subtreeIds(ids.neighbour)).toEqual([ids.neighbour, ids.child]);
    expect(await tree.ancestorIds(ids.child)).toEqual([ids.neighbour]);
  });

  it('lists the admin subtree of an empty-path organization as that organization only', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${ids.empty}/subtree`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([
      ids.empty,
    ]);
  });

  it('scopes a roll-up-enabled customer of such an organization to that organization only', async () => {
    // The tenant context is built per request from the authenticated account;
    // the roll-up capability widens it to the organization's subtree. Read back
    // through a tenant-scoped listing, over every organization that holds an
    // order placed by this account.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      cookies: { b2b_session: rollupCookie },
    });
    expect(res.statusCode).toBe(200);
    const seen = new Set(
      (res.json() as { data: Array<{ organizationId: string }> }).data.map((o) => o.organizationId),
    );
    expect(seen).toEqual(new Set([ids.empty]));
  });

  it.each([
    ['moving the unreadable organization under a readable one', 'empty', 'neighbour', 'empty'],
    ['moving a readable organization under the unreadable one', 'neighbour', 'empty', 'empty'],
    ['moving the malformed organization', 'malformed', 'neighbour', 'malformed'],
  ] as const)('refuses %s as 409 path_unreadable, and changes nothing', async (_n, node, parent, culprit) => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${ids[node]}/parent`,
      payload: { parentId: ids[parent] },
      ...ADMIN,
    });
    expect(res.statusCode, res.body).toBe(409);
    const error = (res.json() as { error: { code: string; details: Record<string, unknown> } }).error;
    expect(error.code).toBe('ORGANIZATION_TREE_INVALID');
    expect(error.details).toEqual({ code: 'path_unreadable', organizationId: ids[culprit] });

    // The neighbouring tree is exactly as it was: no prefix rewrite ran.
    expect(await tree.subtreeIds(ids.neighbour)).toEqual([ids.neighbour, ids.child]);
  });

  it('refuses detaching the unreadable organization too', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${ids.empty}/parent`,
      payload: { parentId: null },
      ...ADMIN,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(await tree.subtreeIds(ids.neighbour)).toEqual([ids.neighbour, ids.child]);
  });
});
