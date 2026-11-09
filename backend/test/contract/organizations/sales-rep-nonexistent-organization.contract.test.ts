import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, PaymentMethod } from '../../helpers/package-entities.js';
import { createSalesRep } from '../../helpers/price-book-admin.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Issue #305, architect ruling on PR #954 (Q4).
 *
 * A sales representative's reach is a complement — every organization except
 * those governed by somebody else — so an id that names no organization at all
 * is not excluded, and `isOrgInScope` answers yes for it. That is accepted on
 * the condition that the writes taking an organization id still refuse an
 * organization that does not exist. This holds them to it, for a roll-up
 * representative: a price-book audience member and a quick-order default
 * preference naming a random UUID are refused, never answered 2xx. The quick
 * order write answers 404 (its existence check was added for this); the price
 * book already refused a member that does not exist, with its own 400
 * `PRICE_BOOK_AUDIENCE_KIND` naming the member, which is kept.
 */
describe('#305 — a sales representative writing against an organization that does not exist', () => {
  let h: BackendServerHandle;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  let roleId = '';
  let permissionsBefore: string[] = [];
  let paymentId = '';
  const NOWHERE = randomUUID();

  beforeAll(async () => {
    h = await setupBackendServer();
    rep = await createSalesRep(h, { assignedOrganizationIds: [TEST_ORGANIZATION_ID] });
    await withSystemScope('#305: a roll-up representative who writes orders defaults', async () => {
      const em = h.orm.em.fork();
      const role = await em.findOneOrFail(AdminRole, { code: 'sales_representative' });
      roleId = role.id;
      permissionsBefore = [...role.permissions];
      role.permissions = Array.from(new Set([...role.permissions, 'orders:write', 'organizations:rollup']));
      await em.flush();
      paymentId = (await em.findOne(PaymentMethod, { status: 'active' }))!.id;
    });
  }, 60_000);

  afterAll(async () => {
    rep?.release();
    await withSystemScope('#305: restore the sales representative role', async () => {
      const em = h.orm.em.fork();
      const role = await em.findOneOrFail(AdminRole, { id: roleId });
      role.permissions = permissionsBefore;
      await em.flush();
    });
    await teardownBackendServer(h);
  });

  const refusedAsMissing = (res: { statusCode: number; body: string }): void => {
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect([404, 422], res.body).toContain(res.statusCode);
  };

  it('a price book naming it as an audience member', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/price-books',
      cookies: rep.cookies,
      payload: {
        name: `#305 nowhere ${NOWHERE.slice(0, 8)}`,
        type: 'regular',
        currencyCode: 'PLN',
        audience: { kind: 'organizations', memberIds: [NOWHERE] },
      },
    });
    expect(res.statusCode, res.body).toBe(400);
    const error = (res.json() as { error: { code: string; details: Array<{ path: string }> } }).error;
    expect(error.code).toBe('PRICE_BOOK_AUDIENCE_KIND');
    expect(error.details.map((d) => d.path)).toContain('audience.memberIds.0');
  });

  it('a quick-order default preference scoped to it', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/quick-order/preferences',
      cookies: rep.cookies,
      payload: { scope: 'organization', scopeId: NOWHERE, defaultPaymentMethodId: paymentId },
    });
    refusedAsMissing(res);
  });
});
