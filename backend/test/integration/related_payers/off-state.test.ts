import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationPermissionPort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { predefinedRoleIdOf, seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';
import { ADMIN, makeAddress, makeOrganization, placePaidOrder } from './fixtures.js';

/**
 * `related_payers` off-state — Constitution XVII item 6 (FR-001, FR-004, FR-091, SC-004).
 * The base case; later phases extend the probe list (customer routes, checkout, cart).
 *
 *  * **API rejection** — every operator link route answers `MODULE_DISABLED`;
 *  * **admin absence** — the presence projection, and the harness's permission-catalogue
 *    sweep (the two operator codes leave `/admin-roles` while off);
 *  * **non-editable configuration** — `related_payers.request_ttl_days`, an ordinary
 *    setting; the activation control is the one exception;
 *  * **restoration** — the link written before the flip is there, unchanged, after it;
 *  * the **deactivated-while-platform-available** case is the first axis the harness drives.
 */
describe('related_payers off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  let buyer: string;
  let payer: string;
  let linkId: string;
  /** Phase 3 (T052) — an order billed to `paid.payerId`, and a member of it who may view it. */
  let paid: { payerId: string; orderId: string };
  let viewerId: string;
  let viewerRoleId: string;
  const VIEWER_COOKIE = `stub-rp-off-viewer-${randomUUID().slice(0, 8)}`;
  const VIEWER = { b2b_session: VIEWER_COOKIE };
  /** The payer's Administrator — the permission catalogue is the roles screen's read. */
  const PAYER_ADMIN_COOKIE = `stub-rp-off-payer-admin-${randomUUID().slice(0, 8)}`;
  const BUYER = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    buyer = await makeOrganization(h.em(), 'Buyer X');
    payer = await makeOrganization(h.em(), 'Payer Y');
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${buyer}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: payer },
    });
    expect(created.statusCode, created.body).toBe(201);
    linkId = created.json().data.id;

    paid = await placePaidOrder(h);
    viewerId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
         values (?, ?, ?, 'x', 'Off', 'Payer', now(), now())`,
        [viewerId, paid.payerId, `${viewerId.slice(0, 8)}@related-payers-off-state.example`],
      );
    viewerRoleId = await seedMemberWithPermissions(h.em(), {
      organizationId: paid.payerId,
      customerAccountId: viewerId,
      permissions: ['related_payers.view_paid_orders'],
    });
    (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } })
      .organizationRoleCache.invalidateLocal(paid.payerId);
    CUSTOMER_COOKIES[VIEWER_COOKIE] = { customerAccountId: viewerId, organizationId: paid.payerId };
    const payerAdminId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","created_at","updated_at")
         values (?, ?, ?, 'x', 'Off', 'Admin', ?, now(), now())`,
        [payerAdminId, paid.payerId, `${payerAdminId.slice(0, 8)}@related-payers-off-state.example`, await predefinedRoleIdOf(h.em(), paid.payerId, 'administrator')],
      );
    CUSTOMER_COOKIES[PAYER_ADMIN_COOKIE] = { customerAccountId: payerAdminId, organizationId: paid.payerId };
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[VIEWER_COOKIE];
    delete CUSTOMER_COOKIES[PAYER_ADMIN_COOKIE];
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'related_payers', {
      routes: [
        { url: `/api/v1/admin/organizations/${buyer}/related-payers`, cookies: ADMIN },
        {
          method: 'POST',
          url: `/api/v1/admin/organizations/${buyer}/related-payers`,
          cookies: ADMIN,
          payload: { payerOrganizationId: buyer },
        },
        {
          method: 'POST',
          url: `/api/v1/admin/organizations/${buyer}/related-payers/new-organization`,
          cookies: ADMIN,
          payload: {},
        },
        { method: 'PATCH', url: `/api/v1/admin/related-payers/links/${linkId}`, cookies: ADMIN, payload: {} },
        {
          method: 'POST',
          url: '/api/v1/admin/related-payers/links/00000000-0000-4000-8000-00000000ffff/revoke',
          cookies: ADMIN,
        },
        // Phase 2 (T030) — the checkout payer list goes with the module. Placement naming
        // a payer while off, and placement without one, are in `placement.test.ts`.
        { url: '/api/v1/checkout/payers', cookies: { b2b_session: 'stub-customer-session' } },
        // Phase 5 (T085) — requests: send, list, withdraw, incoming, decide, revoke from either side.
        {
          method: 'POST',
          url: '/api/v1/account/related-payers/requests',
          cookies: VIEWER,
          payload: { taxId: 'PL1234567890', contactEmail: 'off@example.com' },
        },
        { url: '/api/v1/account/related-payers/requests', cookies: VIEWER },
        { method: 'POST', url: '/api/v1/account/related-payers/requests/00000000-0000-4000-8000-00000000fffd/withdraw', cookies: VIEWER },
        { url: '/api/v1/account/related-payers/incoming', cookies: VIEWER },
        { method: 'POST', url: '/api/v1/account/related-payers/incoming/00000000-0000-4000-8000-00000000fffd/accept', cookies: VIEWER },
        { method: 'POST', url: '/api/v1/account/related-payers/incoming/00000000-0000-4000-8000-00000000fffd/reject', cookies: VIEWER, payload: {} },
        { method: 'POST', url: `/api/v1/account/related-payers/${linkId}/revoke`, cookies: VIEWER },
        { method: 'POST', url: `/api/v1/account/payees/${linkId}/revoke`, cookies: VIEWER },
        { url: '/api/v1/account/related-payers', cookies: VIEWER },
        { url: '/api/v1/account/payees', cookies: VIEWER },
        // The operator queue and its decisions.
        { url: '/api/v1/admin/related-payers/requests', cookies: ADMIN },
        { method: 'POST', url: '/api/v1/admin/related-payers/requests/00000000-0000-4000-8000-00000000fffd/approve', cookies: ADMIN },
        {
          method: 'POST',
          url: '/api/v1/admin/related-payers/requests/00000000-0000-4000-8000-00000000fffd/reject',
          cookies: ADMIN,
          payload: { reason: 'off' },
        },
        // Phase 6 — the queue's assign / create / invite actions, the payer's invitations of
        // buyers, and the anonymous lookup the registration form pre-fills from.
        {
          method: 'POST',
          url: '/api/v1/admin/related-payers/requests/00000000-0000-4000-8000-00000000fffd/assign-organization',
          cookies: ADMIN,
          payload: { organizationId: buyer },
        },
        {
          method: 'POST',
          url: '/api/v1/admin/related-payers/requests/00000000-0000-4000-8000-00000000fffd/create-organization',
          cookies: ADMIN,
          payload: {},
        },
        { method: 'POST', url: '/api/v1/admin/related-payers/requests/00000000-0000-4000-8000-00000000fffd/send-invitation', cookies: ADMIN },
        {
          method: 'POST',
          url: '/api/v1/account/payees/invitations',
          cookies: VIEWER,
          payload: { taxId: 'PL1234567890', contactEmail: 'off@example.com' },
        },
        { url: '/api/v1/account/payees/invitations', cookies: VIEWER },
        { method: 'POST', url: '/api/v1/account/payees/invitations/00000000-0000-4000-8000-00000000fffd/withdraw', cookies: VIEWER },
        { url: '/api/v1/related-payers/invitations/off-state-token-0123456789abcdef' },
        // Phase 3 (T052) — *Orders we pay for*, its detail and its invoice download.
        { url: '/api/v1/account/paid-orders', cookies: VIEWER },
        { url: `/api/v1/account/paid-orders/${paid.orderId}`, cookies: VIEWER },
        // FR-002 — the availability read the account navigation asks goes with the module too.
        { url: '/api/v1/related-payers/availability', cookies: VIEWER },
        {
          url: `/api/v1/account/paid-orders/${paid.orderId}/invoices/00000000-0000-4000-8000-00000000fffe/pdf`,
          cookies: VIEWER,
        },
      ],
      adminPresence: { cookies: ADMIN },
      settingWrite: { code: 'related_payers.request_ttl_days', value: 14, cookies: ADMIN },
    });
  });

  it('links survive the switch unchanged (FR-004)', async () => {
    const before = await h.em().getConnection().execute(`select * from related_payer_links where id = ?`, [linkId]);
    await withModuleOff('related_payers', 'deactivated', async () => undefined);
    const after = await h.em().getConnection().execute(`select * from related_payer_links where id = ?`, [linkId]);
    expect(after).toEqual(before);
    const list = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${buyer}/related-payers`, cookies: ADMIN });
    expect(list.json().data.asBuyer.map((l: { id: string }) => l.id)).toEqual([linkId]);
  });

  /**
   * Phase 5 (T085; FR-102) — the expiry sweep stops with the module: an overdue request stays
   * pending while the module is off, and the first tick after reactivation expires it. The tick is
   * driven with the platform's own presence answer, as the consumer is.
   */
  it('the request expiry sweep does not run while off and catches up after (FR-102)', async () => {
    const { effectiveState } = await import('@endora-commerce/platform/kernel');
    // The published artefact, not `src`: the module instance the composed platform already holds
    // (`check:singleton-identity`), so the tick is the one the consumer runs.
    const { runRequestExpirySweepTick } = await import(
      '../../../../packages/modules/related_payers/dist/backend/workers/request-expiry-sweep-worker.js'
    );
    const requester = await makeOrganization(h.em(), 'Expiring off-state buyer');
    const requestId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into related_payer_requests
           (id, organization_id, direction, sender_customer_account_id, tax_id_normalized, contact_email, routing,
            approval_mode, unregistered_mode, state, sales_channel_id, language, expires_at, version, created_at, updated_at)
         select ?, ?, 'buyer_request', ?, 'PL0000000000', 'off@example.com', 'operator', 'admin', 'admin', 'pending',
                id, 'en-US', now() - interval '1 hour', 1, now(), now()
           from sales_channels limit 1`,
        [requestId, requester, randomUUID()],
      );
    const state = async () =>
      ((await h.em().getConnection().execute('select state from related_payer_requests where id = ?', [requestId])) as Array<{
        state: string;
      }>)[0]!.state;
    const expiry = h.container.resolve<Parameters<typeof runRequestExpirySweepTick>[0]['expiry']>('relatedPayerRequestExpiry');
    const tick = () =>
      runRequestExpirySweepTick({
        expiry,
        isPresent: () => effectiveState.isPresent('related_payers'),
        log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
      });
    await withModuleOff('related_payers', 'deactivated', async () => {
      await tick();
      expect(await state()).toBe('pending');
    });
    await tick();
    expect(await state()).toBe('expired');
  });

  /**
   * Phase 3 (T052; FR-001, FR-004, FR-101) — *View orders we pay for* follows presence: off, on
   * either axis, it leaves the payer's permission catalogue and its member's effective set,
   * the stored grant untouched; the buyer's order keeps its payer, which is order data; back
   * on, the payer reads the same order again with nothing re-granted.
   */
  it.each(['deactivated', 'platform-unavailable'] as const satisfies readonly OffStateAxis[])(
    'view_paid_orders leaves while off (%s), the order keeps its payer, and the view comes back',
    async (axis) => {
      const CODE = 'related_payers.view_paid_orders';
      const port = () =>
        (h.container.cradle as unknown as { organizationPermissionPort: OrganizationPermissionPort })
          .organizationPermissionPort;
      const subject = { customerAccountId: viewerId, organizationId: paid.payerId };
      const catalogue = async (): Promise<string[]> => {
        const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/permission-catalogue', cookies: { b2b_session: PAYER_ADMIN_COOKIE } });
        expect(res.statusCode, res.body).toBe(200);
        const groups = (res.json() as { data: { groups: Array<{ permissions: Array<{ code: string }> }> } }).data.groups;
        return groups.flatMap((g) => g.permissions.map((p) => p.code));
      };
      const grants = async (): Promise<string[]> => {
        const [row] = (await h.em().getConnection().execute(`select "permissions" from "organization_roles" where "id" = ?`, [
          viewerRoleId,
        ])) as Array<{ permissions: string[] }>;
        return [...row!.permissions].sort();
      };
      const buyerOrderPayer = async (): Promise<unknown> => {
        const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${paid.orderId}`, cookies: BUYER });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: { payer?: { organizationId: string } | null } }).data.payer?.organizationId;
      };
      const paidOrderStatus = async (): Promise<number> =>
        (await h.app.inject({ method: 'GET', url: `/api/v1/account/paid-orders/${paid.orderId}`, cookies: VIEWER })).statusCode;

      expect(await catalogue()).toContain(CODE);
      expect(await port().can(subject, CODE)).toBe(true);
      expect(await paidOrderStatus()).toBe(200);
      const before = await grants();

      await withModuleOff('related_payers', axis, async () => {
        expect(await catalogue()).not.toContain(CODE);
        expect((await port().effective(subject)).permissions).not.toContain(CODE);
        expect(await port().can(subject, CODE)).toBe(false);
        expect(await grants()).toEqual(before);
        expect(await buyerOrderPayer()).toBe(paid.payerId);
      });

      expect(await grants()).toEqual(before);
      expect(await port().can(subject, CODE)).toBe(true);
      expect(await paidOrderStatus()).toBe(200);
      expect(await buyerOrderPayer()).toBe(paid.payerId);
    },
  );
});

/**
 * Phase 4 (T059; FR-001, FR-116, Principle XVII) — with `related_payers` off, *Buying for* is
 * gone: naming a payer answers 404, a cart that was bought for a payer is priced for the buyer
 * on its next read (and says why), and the catalogue quotes the buyer's own prices.
 */
describe('related_payers off-state — the payer\'s terms on the cart', () => {
  let h: BackendServerHandle;
  const SESSION = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('PUT /cart/buying-for is 404, the cart returns to the buyer, catalogue prices are the buyer\'s', async () => {
    const { SEED_PRODUCT_101_ID } = await import('../../helpers/seed-catalog.js');
    const { seedPriceBookSql } = await import('../../helpers/price-book-sql.js');
    const { TEST_ORGANIZATION_ID: X } = await import('../../helpers/test-actors.js');
    const setting = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: true },
    });
    expect(setting.statusCode, setting.body).toBe(200);
    const payer = await makeOrganization(h.em(), 'Off-state terms payer');
    await makeAddress(h.em(), payer, 'billing');
    await seedPriceBookSql(h.em(), {
      name: 'Off-state — payer',
      audience: { organizations: [payer] },
      rows: [{ productId: SEED_PRODUCT_101_ID, percent: '-30' }],
    });
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${X}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: payer, commercialTerms: 'payer' },
    });
    expect(link.statusCode, link.body).toBe(201);
    const listing = async () =>
      (
        (await h.app.inject({ method: 'GET', url: `/api/v1/catalog/products?ids=${SEED_PRODUCT_101_ID}`, cookies: SESSION })).json() as {
          data: Array<{ price: { amount: number } | null }>;
        }
      ).data[0]?.price?.amount;
    const own = await listing();
    const added = await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: SESSION, payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 } });
    expect(added.statusCode, added.body).toBe(200);
    const set = await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', cookies: SESSION, payload: { payerOrganizationId: payer } });
    expect(set.statusCode, set.body).toBe(200);
    expect(await listing()).not.toBe(own);

    await withModuleOff('related_payers', 'deactivated', async () => {
      const refused = await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', cookies: SESSION, payload: { payerOrganizationId: payer } });
      expect(refused.statusCode, refused.body).toBe(404);
      const read = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
      expect(read.statusCode, read.body).toBe(200);
      const data = read.json().data as { buyingFor: unknown; buyingForReset: { reason: string } | null };
      expect(data.buyingFor).toBeNull();
      expect(data.buyingForReset).toEqual({ reason: 'capability_unavailable' });
      expect(await listing()).toBe(own);
    });
    // Clean up the stub customer's basket for the files after this one.
    await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', cookies: SESSION, payload: { payerOrganizationId: null } });
  });
});
