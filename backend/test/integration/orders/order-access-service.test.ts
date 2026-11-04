import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationPermissionPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrderAccessService } from '../../../../packages/modules/orders/src/backend/services/order-access-service.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedMemberWithPermissions, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * T145 — OrderAccessService scopes Orders by who may see them:
 *   - a holder of `orders.view_organization` (the *Administrator* implicitly):
 *     every order in the org;
 *   - anyone else: only orders they placed themselves.
 *
 * `specs/170-organization-roles/` WP-07 (FR-049, OR-5) — the question is the
 * permission, asked of `organizationPermissionPort`; the legacy `role` column
 * is not read, so an account whose role grants the code reaches the
 * Organization whatever that column says, and one whose role does not is
 * pinned to its own orders.
 *
 * Feature 056 (T032) — the org predicate for a holder is not pinned in
 * `scopedWhere`; it is enforced by the always-on tenant filter (feature 050),
 * which resolves to single-org normally and to the org SUBTREE for a roll-up
 * head-office login. So a holder's `scopedWhere` carries no `organizationId`.
 */

describe('OrderAccessService.scopedWhere', () => {
  let h: BackendServerHandle;
  let svc: OrderAccessService;
  let viewerId = '';
  let memberId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new OrderAccessService(
      (h.container.cradle as unknown as { organizationPermissionPort: OrganizationPermissionPort })
        .organizationPermissionPort,
    );
    // Two accounts of this file's own: a Member, and a Member-legacy account
    // whose custom role grants the code.
    const em = h.em();
    const make = (label: string) =>
      em.create(CustomerAccount, {
        organizationId: TEST_ORGANIZATION_ID,
        email: `t145-${label}-${randomUUID()}@example.com`,
        passwordHash: 'x',
        firstName: 'T145',
        lastName: label,
      });
    const viewer = make('viewer');
    const member = make('member');
    await em.persistAndFlush([viewer, member]);
    viewerId = viewer.id;
    memberId = member.id;
    await seedMemberWithPermissions(em, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: viewerId,
      permissions: ['orders.view_organization'],
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('delegates org scoping to the tenant filter for the Administrator (no explicit predicate)', async () => {
    const admin = await h.em().findOneOrFail(CustomerAccount, {
      organizationRoleId: await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator'),
      organizationId: TEST_ORGANIZATION_ID,
    });
    const where = await svc.scopedWhere({
      customerAccountId: admin.id,
      organizationId: admin.organizationId!,
    });
    // Feature 056 — org predicate is enforced by the ambient tenant filter.
    expect(where).toEqual({});
  });

  it('delegates org scoping to the tenant filter for a custom role holding orders.view_organization', async () => {
    const where = await svc.scopedWhere({ customerAccountId: viewerId, organizationId: TEST_ORGANIZATION_ID });
    expect(where).toEqual({});
  });

  it('returns an org+placedBy filter for a Member (no orders.view_organization)', async () => {
    const where = await svc.scopedWhere({ customerAccountId: memberId, organizationId: TEST_ORGANIZATION_ID });
    expect(where).toEqual({
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: memberId,
    });
  });

  it('pins an account whose role cannot be found (the port fails closed)', async () => {
    const stranger = randomUUID();
    const where = await svc.scopedWhere({ customerAccountId: stranger, organizationId: TEST_ORGANIZATION_ID });
    expect(where).toEqual({ organizationId: TEST_ORGANIZATION_ID, placedByCustomerAccountId: stranger });
  });

  it('preserves caller-supplied extra clauses', async () => {
    const admin = await h.em().findOneOrFail(CustomerAccount, {
      organizationRoleId: await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator'),
      organizationId: TEST_ORGANIZATION_ID,
    });
    const where = await svc.scopedWhere(
      {
        customerAccountId: admin.id,
        organizationId: admin.organizationId!,
      },
      { id: 'order-123', status: 'new' },
    );
    // Feature 056 — extra clauses preserved; the org predicate is left to the
    // ambient tenant filter (no explicit `organizationId` for a holder).
    expect(where).toEqual({
      id: 'order-123',
      status: 'new',
    });
  });
});
