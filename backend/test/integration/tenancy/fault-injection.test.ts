import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedInvoiceableOrder } from '../invoices/helpers.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import {
  runWithTenantContext,
  runWithoutTenantContext,
  MissingTenantContextError,
} from '../../../src/tenancy/tenant-context.js';
import {
  resolveTenantContext,
  systemTenantContext,
} from '../../../src/tenancy/resolve-tenant-context.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 050 (SC-003) — fault injection: the guard is the data-layer backstop.
 * A NAIVE query with NO explicit org condition is still confined to the ambient
 * tenant — i.e. even if a service forgets its `where` clause, no cross-tenant
 * leak occurs. And with no context at all, the query fails closed.
 */
describe('Tenant guard — fault injection (feature 050 SC-003)', () => {
  let h: BackendServerHandle;
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  let orderAId: string;
  let orderBId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed', async () => {
      const a = await seedInvoiceableOrder(h.em(), { organizationId: orgAId });
      const b = await seedInvoiceableOrder(h.em(), { organizationId: orgBId });
      orderAId = a.orderId;
      orderBId = b.orderId;
    });
  });

  afterAll(async () => teardownBackendServer(h));

  it('a naive find (no explicit org filter) is confined to the single-org context', async () => {
    const ctx = resolveTenantContext({ kind: 'customer', customerAccountId: randomUUID(), organizationId: orgAId });
    const ids = await runWithTenantContext(ctx, async () => {
      // NOTE: no organizationId in the where — the guard must still confine it.
      const rows = await h.em().find(Order, {});
      return rows.map((o) => o.id);
    });
    expect(ids).toContain(orderAId);
    expect(ids).not.toContain(orderBId);
  });

  it('an allowed-set (scoped sales-rep) context confines a naive find to assigned orgs', async () => {
    const ctx = resolveTenantContext(
      { kind: 'admin', adminUserId: randomUUID() },
      { allowAll: false, allowedOrganizationIds: [orgBId] },
    );
    const ids = await runWithTenantContext(ctx, async () => (await h.em().find(Order, {})).map((o) => o.id));
    expect(ids).toContain(orderBId);
    expect(ids).not.toContain(orderAId);
  });

  it('a platform-admin (all) context sees every org on a naive find', async () => {
    const ctx = resolveTenantContext({ kind: 'admin', adminUserId: randomUUID() }, { allowAll: true });
    const ids = await runWithTenantContext(ctx, async () => (await h.em().find(Order, {})).map((o) => o.id));
    expect(ids).toEqual(expect.arrayContaining([orderAId, orderBId]));
  });

  it('system scope sees every org', async () => {
    const ids = await runWithTenantContext(systemTenantContext('report'), async () =>
      (await h.em().find(Order, {})).map((o) => o.id),
    );
    expect(ids).toEqual(expect.arrayContaining([orderAId, orderBId]));
  });

  it('no ambient context fails closed on an org-scoped query', async () => {
    await runWithoutTenantContext(async () => {
      await expect(h.em().find(Order, {})).rejects.toThrow(MissingTenantContextError);
    });
  });
});
