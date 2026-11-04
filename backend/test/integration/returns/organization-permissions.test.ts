import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { assignOrganizationRole, seedCustomOrganizationRole } from '../../helpers/seed-organization-roles.js';
import { ReturnCase } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, resetReturnGraph, type SeededOrder } from './helpers.js';
import {
  asMember,
  errorOf,
  fileCase,
  makeMember,
  makeOrganization,
  orderPlacedBy,
  releaseMembers,
  submitCase,
  type ReturnsFixtureMember,
} from './organization-fixtures.js';

/**
 * `specs/170-organization-roles/` WP-14, T143 (FR-052, OR-11; User Story 9
 * scenarios 1 and 2).
 *
 * Opening a return or a complaint needs `returns.create`; one code covers both
 * kinds, because they are one form and one route. The refusal is
 * `403 ORGANIZATION_PERMISSION_REQUIRED` naming the code, raised **before**
 * the order is read — so another Organization's order id gets the same `403`,
 * not a `404` that would say something about it. Nothing is written: no case,
 * no audit entry.
 *
 * Everything else stays open to a member who lacks the code: reading which
 * lines of their own order are returnable, their own cases, and the follow-up
 * actions on a case they filed before the role change — which continue a case
 * rather than open one, and which refusing would strand.
 */

const bundle = (language: 'en' | 'pl') =>
  JSON.parse(
    readFileSync(new URL(`../../../../packages/modules/returns/i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;
const LABEL_KEY = 'organizationPermissions.returns.create.label';

describe('170 WP-14 — opening a return or complaint needs returns.create (FR-052)', () => {
  let h: BackendServerHandle;
  let orgId = '';
  let foreignOrgId = '';
  const m = {} as Record<'member' | 'admin' | 'restricted' | 'changed', ReturnsFixtureMember>;
  const orders = {} as Record<'member' | 'admin' | 'restricted' | 'changed' | 'foreign', SeededOrder>;
  let restrictiveRoleId = '';
  let changedCaseId = '';
  let deliveryMethodId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await resetReturnGraph(em);
    orgId = await makeOrganization(em, 'WP14 Gate');
    foreignOrgId = await makeOrganization(em, 'WP14 Gate Foreign');

    // Holds every other code a buyer is judged by here, so a refusal can only
    // name `returns.create`.
    const others = ['orders.view_organization', 'returns.view_organization'];
    restrictiveRoleId = await seedCustomOrganizationRole(em, { organizationId: orgId, permissions: others });

    m.member = await makeMember(em, orgId, 'member', { label: 'Member' });
    m.admin = await makeMember(em, orgId, 'administrator', { label: 'Admin' });
    m.restricted = await makeMember(em, orgId, { permissions: others }, { label: 'Restricted' });
    // Files a case as *Member*, then loses the code.
    m.changed = await makeMember(em, orgId, 'member', { label: 'Changed' });
    const foreigner = await makeMember(em, foreignOrgId, 'member', { label: 'Foreigner' });

    orders.member = await orderPlacedBy(em, m.member);
    orders.admin = await orderPlacedBy(em, m.admin);
    orders.restricted = await orderPlacedBy(em, m.restricted);
    orders.changed = await orderPlacedBy(em, m.changed);
    orders.foreign = await orderPlacedBy(em, foreigner);

    changedCaseId = await fileCase(h, m.changed, orders.changed);
    await assignOrganizationRole(em, m.changed.id, restrictiveRoleId);

    const method = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/delivery-methods',
      cookies: ADMIN_COOKIE,
      payload: { deliveryMethodId: randomUUID(), returnCost: 5, currency: 'PLN' },
    });
    expect(method.statusCode, method.body).toBe(201);
    deliveryMethodId = (method.json() as { data: { id: string } }).data.id;
  }, 90_000);

  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  async function casesOfOrder(orderId: string): Promise<number> {
    const em = h.em();
    em.clear();
    return em.count(ReturnCase, { orderId }, { filters: false });
  }

  async function createAuditsOfOrder(orderId: string): Promise<number> {
    const em = h.em();
    em.clear();
    const entries = await em.find(AuditLogEntry, { action: 'return_case.create' }, { filters: false });
    return entries.filter((e) => (e.stateAfter as { orderId?: string } | null)?.orderId === orderId).length;
  }

  describe('a member whose role lacks returns.create', () => {
    it.each(['return', 'complaint'] as const)(
      'is refused a %s on their own order: 403 naming the code, nothing written',
      async (kind) => {
        for (const language of ['en', 'pl'] as const) {
          const res = await submitCase(h, m.restricted, orders.restricted, { kind, language });
          expect(res.statusCode, res.body).toBe(403);
          const error = errorOf(res);
          expect(error?.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
          expect(bundle(language)[LABEL_KEY]).toBeTruthy();
          expect(error?.details).toMatchObject({
            permission: 'returns.create',
            permissionLabel: bundle(language)[LABEL_KEY],
          });
        }
        expect(await casesOfOrder(orders.restricted.orderId)).toBe(0);
        expect(await createAuditsOfOrder(orders.restricted.orderId)).toBe(0);
      },
    );

    it('is refused before the order is read: another Organization’s order gets the same 403', async () => {
      const res = await submitCase(h, m.restricted, orders.foreign);
      expect(res.statusCode, res.body).toBe(403);
      expect(errorOf(res)?.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
      expect(errorOf(res)?.details?.permission).toBe('returns.create');
      expect(await casesOfOrder(orders.foreign.orderId)).toBe(0);
    });

    it('still reads which lines of their own order are returnable', async () => {
      const res = await asMember(h, m.restricted, 'GET', `/api/v1/orders/${orders.restricted.orderId}/returnable`);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { eligible: boolean } }).data.eligible).toBe(true);
    });

    it('still lists and reads the case they filed before the role change', async () => {
      const list = await asMember(h, m.changed, 'GET', '/api/v1/returns');
      expect(list.statusCode, list.body).toBe(200);
      expect((list.json() as { data: Array<{ id: string }> }).data.map((c) => c.id)).toContain(changedCaseId);
      const one = await asMember(h, m.changed, 'GET', `/api/v1/returns/${changedCaseId}`);
      expect(one.statusCode, one.body).toBe(200);
    });

    it('still comments, attaches, chooses the delivery method and cancels on that case', async () => {
      const comment = await asMember(h, m.changed, 'POST', `/api/v1/returns/${changedCaseId}/comments`, {
        body: 'Still mine to follow up',
      });
      expect(comment.statusCode, comment.body).toBe(201);

      const attachment = await asMember(h, m.changed, 'POST', `/api/v1/returns/${changedCaseId}/attachments`, {
        assetId: '00000000-0000-4000-8000-0000000170f1',
      });
      expect(attachment.statusCode, attachment.body).toBe(201);

      const delivery = await asMember(h, m.changed, 'POST', `/api/v1/returns/${changedCaseId}/select-delivery-method`, {
        returnDeliveryMethodId: deliveryMethodId,
      });
      expect(delivery.statusCode, delivery.body).toBe(200);

      const cancel = await asMember(h, m.changed, 'POST', `/api/v1/returns/${changedCaseId}/cancel`);
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect((cancel.json() as { data: { statusCode: string } }).data.statusCode).toBe('cancelled');
    });
  });

  describe('Member (the implicit member default) and Administrator', () => {
    it.each(['member', 'admin'] as const)('%s still opens a return and a complaint on their own order (201)', async (key) => {
      const ret = await submitCase(h, m[key], orders[key], { kind: 'return' });
      expect(ret.statusCode, ret.body).toBe(201);
      const complaint = await submitCase(h, m[key], orders[key], { kind: 'complaint' });
      expect(complaint.statusCode, complaint.body).toBe(201);
    });

    it('past the gate, another Organization’s order is still 404 for the administrator', async () => {
      const res = await submitCase(h, m.admin, orders.foreign);
      expect(res.statusCode, res.body).toBe(404);
    });
  });

  it('a signed-out caller is 401', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      payload: {
        orderId: orders.member.orderId,
        kind: 'return',
        lines: [{ orderItemId: orders.member.itemIds[0], quantity: 1, reasonId: randomUUID() }],
      },
    });
    expect(res.statusCode, res.body).toBe(401);
  });
});
