import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ReturnCase } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, resetReturnGraph, type SeededOrder } from './helpers.js';
import {
  asMember,
  errorOf,
  makeMember,
  makeOrganization,
  orderPlacedBy,
  releaseMembers,
  submitCase,
  type ReturnsFixtureMember,
} from './organization-fixtures.js';

/**
 * `specs/170-organization-roles/` WP-14, T145 (FR-054, FR-049, OR-11,
 * Q-R1 = A; User Story 9 scenario 5).
 *
 * A return or complaint may be started from any order the member may read
 * under FR-049 — a colleague's needs `orders.view_organization` (or
 * *Administrator*) — and starting one needs `returns.create` as well. The
 * order is judged by `orders`' own `findByIdForCustomer`, so the returnable
 * read and the submission agree with `GET /api/v1/orders/:id`: out of reach is
 * `404 NOT_FOUND` for both. The case is filed in the **starter's** name, so its
 * e-mails go to the starter.
 *
 *   ORG: placer (Member, places the order), holder (custom: `returns.create`
 *        and `orders.view_organization`), admin (Administrator), createOnly
 *        (custom: `returns.create`), viewOnly (custom: `orders.view_organization`).
 */
describe('170 WP-14 — a return started from a colleague’s order (FR-054)', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  const m = {} as Record<'placer' | 'holder' | 'admin' | 'createOnly' | 'viewOnly', ReturnsFixtureMember>;
  let order: SeededOrder;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
    const em = h.em();
    await resetReturnGraph(em);
    const org = await makeOrganization(em, 'WP14 Colleague order');
    m.placer = await makeMember(em, org, 'member', { label: 'Placer' });
    m.holder = await makeMember(em, org, { permissions: ['returns.create', 'orders.view_organization'] }, {
      label: 'Holder',
    });
    m.admin = await makeMember(em, org, 'administrator', { label: 'Admin' });
    m.createOnly = await makeMember(em, org, { permissions: ['returns.create'] }, { label: 'CreateOnly' });
    m.viewOnly = await makeMember(em, org, { permissions: ['orders.view_organization'] }, { label: 'ViewOnly' });
    order = await orderPlacedBy(em, m.placer);
  }, 90_000);

  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  const returnable = (member: ReturnsFixtureMember) =>
    asMember(h, member, 'GET', `/api/v1/orders/${order.orderId}/returnable`);

  for (const key of ['holder', 'admin'] as const) {
    describe(key === 'holder' ? 'returns.create with orders.view_organization' : 'the Administrator', () => {
      it('reads the colleague’s order’s returnable lines (200)', async () => {
        const res = await returnable(m[key]);
        expect(res.statusCode, res.body).toBe(200);
        expect((res.json() as { data: { eligible: boolean } }).data.eligible).toBe(true);
      });

      it('starts a return from it (201), filed in the starter’s name, its e-mail to the starter', async () => {
        const res = await submitCase(h, m[key], order);
        expect(res.statusCode, res.body).toBe(201);
        const created = (res.json() as { data: { id: string; customerAccountId: string } }).data;
        expect(created.customerAccountId).toBe(m[key].id);

        const em = h.em();
        em.clear();
        const row = await em.findOneOrFail(ReturnCase, { id: created.id }, { filters: false });
        expect(row.customerAccountId).toBe(m[key].id);
        expect(row.orderId).toBe(order.orderId);

        const authorized = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/returns/${created.id}/authorize`,
          cookies: ADMIN_COOKIE,
        });
        expect(authorized.statusCode, authorized.body).toBe(200);
        const mail = mailer.sent.find(
          (s) => s.meta?.['kind'] === 'return_authorized' && s.meta?.['returnCaseId'] === created.id,
        );
        expect(mail, 'the authorization e-mail').toBeTruthy();
        expect(mail!.to).toBe(m[key].email);
      });
    });
  }

  describe('returns.create without orders.view_organization', () => {
    it('gets 404 on the colleague’s order’s returnable lines', async () => {
      const res = await returnable(m.createOnly);
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)?.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('gets 404 starting a return from it, nothing written', async () => {
      const em = h.em();
      em.clear();
      const before = await em.count(ReturnCase, { orderId: order.orderId }, { filters: false });
      const res = await submitCase(h, m.createOnly, order);
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)?.code).toBe(ERROR_CODES.NOT_FOUND);
      em.clear();
      expect(await em.count(ReturnCase, { orderId: order.orderId }, { filters: false })).toBe(before);
    });
  });

  describe('orders.view_organization without returns.create', () => {
    it('reads the returnable lines (200): the read needs no returns code', async () => {
      const res = await returnable(m.viewOnly);
      expect(res.statusCode, res.body).toBe(200);
    });

    it('is refused the submission: 403 naming returns.create', async () => {
      const res = await submitCase(h, m.viewOnly, order);
      expect(res.statusCode, res.body).toBe(403);
      expect(errorOf(res)?.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
      expect(errorOf(res)?.details?.permission).toBe('returns.create');
    });
  });

  it('the placer still reads and returns their own order, as before', async () => {
    expect((await returnable(m.placer)).statusCode).toBe(200);
    const res = await submitCase(h, m.placer, order);
    expect(res.statusCode, res.body).toBe(201);
  });
});
