import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrderAccessService } from '../../../src/modules/orders/services/order-access-service.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';

/**
 * T145 — OrderAccessService scopes Orders by Role:
 *   - Organization Admin: every order in the org
 *   - Regular User: only orders they placed themselves
 */

describe('OrderAccessService.scopedWhere', () => {
  let h: BackendServerHandle;
  let svc: OrderAccessService;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new OrderAccessService(h.em);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns an org-only filter for Organization Admin', async () => {
    const admin = await h.em().findOneOrFail(CustomerAccount, {
      role: 'organization_admin',
    });
    const where = await svc.scopedWhere({
      customerAccountId: admin.id,
      organizationId: admin.organizationId,
    });
    expect(where).toEqual({ organizationId: admin.organizationId });
  });

  it('returns an org+placedBy filter for Regular User', async () => {
    const regular = await h.em().findOneOrFail(CustomerAccount, {
      role: 'regular_user',
    });
    const where = await svc.scopedWhere({
      customerAccountId: regular.id,
      organizationId: regular.organizationId,
    });
    expect(where).toEqual({
      organizationId: regular.organizationId,
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
        organizationId: admin.organizationId,
      },
      { id: 'order-123', status: 'new' },
    );
    expect(where).toEqual({
      id: 'order-123',
      status: 'new',
      organizationId: admin.organizationId,
    });
  });
});
