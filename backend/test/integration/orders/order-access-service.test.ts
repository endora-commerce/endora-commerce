import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrderAccessService } from '../../../src/modules/orders/services/order-access-service.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { ordersNeighbourPorts } from '../../helpers/orders-neighbour-ports.js';

/**
 * T145 — OrderAccessService scopes Orders by Role:
 *   - Organization Admin: every order in the org
 *   - Regular User: only orders they placed themselves
 *
 * Feature 056 (T032) — the Organization Admin org predicate is no longer pinned
 * in `scopedWhere`; it is enforced by the always-on tenant filter (feature 050),
 * which resolves to single-org normally and to the org SUBTREE for a roll-up
 * head-office login. So an Org Admin's `scopedWhere` carries no `organizationId`.
 */

describe('OrderAccessService.scopedWhere', () => {
  let h: BackendServerHandle;
  let svc: OrderAccessService;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new OrderAccessService(ordersNeighbourPorts(h.em).customerAccountRead);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('delegates org scoping to the tenant filter for Organization Admin (no explicit predicate)', async () => {
    const admin = await h.em().findOneOrFail(CustomerAccount, {
      role: 'organization_admin',
    });
    const where = await svc.scopedWhere({
      customerAccountId: admin.id,
      organizationId: admin.organizationId!,
    });
    // Feature 056 — org predicate is enforced by the ambient tenant filter.
    expect(where).toEqual({});
  });

  it('returns an org+placedBy filter for Regular User', async () => {
    const regular = await h.em().findOneOrFail(CustomerAccount, {
      role: 'regular_user',
    });
    const where = await svc.scopedWhere({
      customerAccountId: regular.id,
      organizationId: regular.organizationId!,
    });
    expect(where).toEqual({
      organizationId: regular.organizationId!,
      placedByCustomerAccountId: regular.id,
    });
  });

  it('preserves caller-supplied extra clauses', async () => {
    const admin = await h.em().findOneOrFail(CustomerAccount, {
      role: 'organization_admin',
    });
    const where = await svc.scopedWhere(
      {
        customerAccountId: admin.id,
        organizationId: admin.organizationId!,
      },
      { id: 'order-123', status: 'new' },
    );
    // Feature 056 — extra clauses preserved; the org predicate is left to the
    // ambient tenant filter (no explicit `organizationId` for an Org Admin).
    expect(where).toEqual({
      id: 'order-123',
      status: 'new',
    });
  });
});
