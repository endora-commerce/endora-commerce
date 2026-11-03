import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { organizationRoleListResponseSchema, type OrganizationRoleView } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import {
  seedCartOrganization,
  seedRoleGranting,
  type CartFixtureActor,
  type CartFixtureOrganization,
} from '../../helpers/cart-approval-roles.js';

/**
 * The approval cascade (`specs/170-organization-roles/` WP-04, T069; FR-034;
 * research R-25; `contracts/commands-audit-events.md` §4; US 3.4/3.5).
 *
 * A role **gaining** `carts.order_without_approval` returns its holders'
 * `pending` carts to `not_required` — the effect switching the old policy off
 * had — and a member **moved** to a role holding it likewise. `carts` does it
 * as a subscriber to `organization_role.permissions_changed.v1` and
 * `customer_account.organization_role_changed.v1`, through its own audited
 * transition (`approval_policy_reset`). A role **losing** the code leaves an
 * `approved` cart approved.
 *
 * The cascade is presentation consistency, not a boundary: placement judges
 * the permission itself (#656, R-25), so a `pending` cart whose owner holds the
 * code is placeable even when no event ever reached the subscriber — the last
 * case seeds exactly that state.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('cart approval follows the role (FR-034)', () => {
  let h: BackendServerHandle;
  let org: CartFixtureOrganization;
  let ADMIN: CartFixtureActor;
  let lowRoleId: string;
  let highRoleId: string;
  let addressId: string;
  let savedStock: Array<{ id: string; on_hand: number; reserved: number }> = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    org = await seedCartOrganization(h, {
      label: 'WP-04 approval cascade',
      approvalRequired: true,
      members: {
        ADMIN: 'administrator',
        MEMBER: 'member',
        APPROVED_MEMBER: 'member',
        LOW: { permissions: ['carts.create'] },
        TRUSTED: { permissions: ['carts.create', 'carts.order_without_approval'] },
      },
    });
    ADMIN = org.actors['ADMIN']!;
    lowRoleId = org.actors['LOW']!.roleId!;
    highRoleId = await seedRoleGranting(h.em(), org.organizationId, ['carts.create', 'carts.order_without_approval']);

    const address = await call(ADMIN, 'POST', '/api/v1/organizations/mine/addresses', {
      kind: 'delivery',
      recipientName: 'WP-04',
      street: 'ul. Odbioru 170',
      city: 'Warszawa',
      postalCode: '00-170',
      country: 'PL',
      isDefault: true,
    });
    expect(address.statusCode, address.body).toBe(201);
    addressId = (address.json() as { data: { id: string } }).data.id;

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
    org?.release();
    await teardownBackendServer(h);
  });

  function call(actor: CartFixtureActor, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    return h.app.inject({
      method,
      url,
      cookies: { b2b_session: actor.cookie },
      headers: { ...CHANNEL, ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { payload } : {}),
    });
  }

  async function sql<T>(statement: string, params: unknown[]): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  async function approvalStatus(cartId: string): Promise<string> {
    const [row] = await sql<{ approval_status: string }>(`select "approval_status" from "carts" where "id" = ?`, [cartId]);
    return row!.approval_status;
  }

  async function auditActions(cartId: string): Promise<string[]> {
    const rows = await sql<{ action: string }>(
      `select "action" from "cart_audit_entries" where "cart_id" = ? order by "occurred_at", "id"`,
      [cartId],
    );
    return rows.map((row) => row.action);
  }

  async function pendingCartOf(actor: CartFixtureActor): Promise<string> {
    const add = await call(actor, 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(add.statusCode, add.body).toBe(200);
    const submit = await call(actor, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    const cartId = ((await call(actor, 'GET', '/api/v1/cart')).json() as { data: { id: string } }).data.id;
    expect(await approvalStatus(cartId)).toBe('pending');
    return cartId;
  }

  async function role(kind: 'member'): Promise<OrganizationRoleView> {
    const res = await call(ADMIN, 'GET', '/api/v1/organizations/mine/roles');
    expect(res.statusCode, res.body).toBe(200);
    return organizationRoleListResponseSchema.parse(res.json()).data.find((r) => r.kind === kind)!;
  }

  async function setMemberPermissions(change: (codes: string[]) => string[]): Promise<void> {
    const member = await role('member');
    const res = await call(ADMIN, 'PATCH', `/api/v1/organizations/mine/roles/${member.id}`, {
      expectedVersion: member.version,
      permissions: change([...member.permissions]),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  let approvedCartId: string;

  it('a role gaining carts.order_without_approval returns its holders’ pending carts to not_required, audited', async () => {
    const memberCart = await pendingCartOf(org.actors['MEMBER']!);
    approvedCartId = await pendingCartOf(org.actors['APPROVED_MEMBER']!);
    const approve = await call(ADMIN, 'POST', `/api/v1/organization/carts/${approvedCartId}/approve`, {});
    expect(approve.statusCode, approve.body).toBe(200);
    // A holder of another role is not touched.
    const lowCart = await pendingCartOf(org.actors['LOW']!);

    await setMemberPermissions((codes) => [...codes, 'carts.order_without_approval']);

    await vi.waitFor(async () => expect(await approvalStatus(memberCart)).toBe('not_required'), { timeout: 5_000 });
    expect(await auditActions(memberCart)).toContain('approval_policy_reset');
    expect(await approvalStatus(approvedCartId)).toBe('approved');
    expect(await approvalStatus(lowCart)).toBe('pending');

    const read = (await call(org.actors['MEMBER']!, 'GET', '/api/v1/cart')).json() as {
      data: { approvalStatus: string; primaryCta: string };
    };
    expect(read.data).toMatchObject({ approvalStatus: 'not_required', primaryCta: 'checkout' });
  });

  it('a role losing it leaves an approved cart approved', async () => {
    await setMemberPermissions((codes) => codes.filter((code) => code !== 'carts.order_without_approval'));
    // Give a lost event the chance to do the wrong thing before asserting nothing happened.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await approvalStatus(approvedCartId)).toBe('approved');
  });

  it('a member moved to a role holding it has their pending cart returned to not_required', async () => {
    const lowCart = ((await call(org.actors['LOW']!, 'GET', '/api/v1/cart')).json() as { data: { id: string } }).data.id;
    expect(await approvalStatus(lowCart)).toBe('pending');
    const low = organizationRoleListResponseSchema
      .parse((await call(ADMIN, 'GET', '/api/v1/organizations/mine/roles')).json())
      .data.find((r) => r.id === lowRoleId)!;

    // Deleting the role moves its holder to the replacement — one
    // `customer_account.change_role` child, whose event the subscriber reads.
    const res = await call(ADMIN, 'DELETE', `/api/v1/organizations/mine/roles/${lowRoleId}`, {
      expectedVersion: low.version,
      replacementRoleId: highRoleId,
    });
    expect(res.statusCode, res.body).toBe(200);

    await vi.waitFor(async () => expect(await approvalStatus(lowCart)).toBe('not_required'), { timeout: 5_000 });
    expect(await auditActions(lowCart)).toContain('approval_policy_reset');
  });

  it('a pending cart whose owner holds the code is placeable although no event reset it (R-25)', async () => {
    const trusted = org.actors['TRUSTED']!;
    const add = await call(trusted, 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(add.statusCode, add.body).toBe(200);
    const cartId = ((await call(trusted, 'GET', '/api/v1/cart')).json() as { data: { id: string } }).data.id;
    // The state a lost event leaves behind, written past the subscriber.
    await sql(`update "carts" set "approval_status" = 'pending', "submitted_for_approval_at" = now() where "id" = ?`, [
      cartId,
    ]);

    const res = await call(trusted, 'POST', '/api/v1/orders', {
      deliveryAddressId: addressId,
      billingAddressId: addressId,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
    });
    expect(res.statusCode, res.body).toBe(201);
  });
});
