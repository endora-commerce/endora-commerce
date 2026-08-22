import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { DEFAULT_WAREHOUSE_ID } from '../../../src/modules/inventory/entities/warehouse.entity.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * The audit-log reference registry, on a composed platform (feature 075, D-87
 * drain).
 *
 * `RecentActivityService` used to turn an `objectId` into a name with five raw
 * SQL statements naming `admin_users`, `products`, `warehouses`, `price_lists`,
 * `customer_accounts` and `organizations` — six tables belonging to five other
 * modules, invisible to the import-level boundary check because SQL names no
 * specifier. The direction is inverted: each owner pushes a resolver for its own
 * object type from its own contribution boot hook.
 *
 * The unit test beside this one pins the registry's policy over a fake
 * predicate. What it cannot see is whether the four boot hooks actually ran —
 * a contribution that nobody registers degrades to "the row has no live label",
 * which is a perfectly plausible-looking answer and would go unnoticed. That is
 * what the first assertion here is for.
 *
 * **The off-state case is `inventory`, and only `inventory`.** Of the four
 * contributors it is the one whose manifest declares no
 * `activation.nonDeactivatable`, so it is the one an operator can switch off;
 * `catalog`, `price_lists` and `customer_accounts` are locked, and an off-state
 * assertion over one of them would be asserting a state the platform refuses to
 * enter. That asymmetry is also the reason this seam is a contribution rather
 * than four read ports: `audit_logs` is itself non-deactivatable, so a
 * `dependencies` entry from it onto `inventory` would have made `inventory`
 * undeactivatable in order to render a warehouse name on a dashboard card.
 */
describe('audit reference registry — contributions on a composed platform', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.auditLogService.record({
      actorAdminUserId: '00000000-0000-4000-8000-0000000000b1',
      action: 'warehouse.update',
      objectType: 'warehouse',
      objectId: DEFAULT_WAREHOUSE_ID,
      // No `name` in the snapshot: the live label is the only thing that can
      // answer, which is what makes the off-state assertion below observable.
      stateAfter: { active: true },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function registry(): AuditReferenceRegistryPort {
    return (
      h.container.cradle as unknown as { auditReferenceRegistry: AuditReferenceRegistryPort }
    ).auditReferenceRegistry;
  }

  async function warehouseRow(): Promise<{
    targetDisplayName: string;
    targetUrl: string | null;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ targetId: string; targetDisplayName: string; targetUrl: string | null }>;
    };
    const row = body.data.find((r) => r.targetId === DEFAULT_WAREHOUSE_ID);
    expect(row).toBeDefined();
    return row!;
  }

  it('has every owner registered by its own boot hook', () => {
    expect([...registry().owners()].sort()).toEqual([
      'catalog',
      'customer_accounts',
      'inventory',
      'price_lists',
    ]);
  });

  it('resolves the warehouse label and the owner-supplied deep link', async () => {
    const row = await warehouseRow();
    expect(row.targetDisplayName).not.toBe(DEFAULT_WAREHOUSE_ID);
    // The route is `inventory`'s own, supplied on the descriptor rather than
    // spelled into `audit_logs`' switch statement.
    expect(row.targetUrl).toBe(`/warehouses/${DEFAULT_WAREHOUSE_ID}`);
  });

  it('drops a deactivated contributor label and link, and keeps the audit row', async () => {
    const off = await withModuleOff('inventory', 'deactivated', () => warehouseRow());
    // Skipped, not honoured: the deep link points at an admin screen a module
    // that is off does not contribute, and reading a switched-off module's
    // tables on its behalf is the thing Constitution XVII forbids.
    expect(off.targetUrl).toBeNull();
    // The record outlives the label. The row is still on the card — with the
    // raw id, because this entry's snapshot carries no name of its own.
    expect(off.targetDisplayName).toBe(DEFAULT_WAREHOUSE_ID);
  });

  it('restores the label and the link when the contributor comes back', async () => {
    const row = await warehouseRow();
    expect(row.targetUrl).toBe(`/warehouses/${DEFAULT_WAREHOUSE_ID}`);
    expect(row.targetDisplayName).not.toBe(DEFAULT_WAREHOUSE_ID);
  });
});
