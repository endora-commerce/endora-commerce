import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AUDIT_ERASED_MARKER, type AuditReferenceLabel, type AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import type { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { RecentActivityService } from './recent-activity-service.js';
import type { RecentActivityCatalog } from './recent-activity-catalog.js';
import type { RecentActivityVisibility } from './recent-activity-visibility.js';

/**
 * Issue #844 — the dashboard card takes a row's target name out of its audit
 * snapshot, and an anonymised subject's snapshots hold the stored marker
 * `[erased]` where the names used to be. The card must read the marker as
 * *absent*: the name falls back to the owner's live label, or to the id, and
 * the compact summary leaves the erased key out — never "[erased]" on the home
 * screen.
 */

const ERASED = AUDIT_ERASED_MARKER;
const PRODUCT = '00000000-0000-4000-8000-000000000001';
const WAREHOUSE = '00000000-0000-4000-8000-000000000002';
const BULK = '00000000-0000-4000-8000-000000000003';
const STOCK = `${PRODUCT}:${WAREHOUSE}`;

function entry(partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, 'action' | 'objectType' | 'objectId'>): AuditLogEntry {
  return {
    id: `${partial.objectId}-row`,
    actedAt: new Date('2026-11-07T10:00:00.000Z'),
    actorAdminUserId: null,
    impersonatedCustomerAccountId: null,
    actorCustomerAccountId: null,
    stateBefore: null,
    stateAfter: null,
    ...partial,
  } as AuditLogEntry;
}

function service(rows: AuditLogEntry[], live: Record<string, AuditReferenceLabel>): RecentActivityService {
  const em = { find: async () => rows } as unknown as EntityManager;
  const catalog = {
    descriptorFor: (action: string) => ({
      action,
      moduleId: 'catalog',
      moduleName: 'Catalog',
      icon: 'package',
      labelKey: `recentActivity.${action}`,
    }),
  } as unknown as RecentActivityCatalog;
  const visibility = {
    visibleActions: async () => rows.map((r) => r.action),
  } as unknown as RecentActivityVisibility;
  const references: AuditReferenceRegistryPort = {
    register: () => undefined,
    owners: () => [],
    resolve: async (_type, ids) => new Map(ids.filter((id) => live[id]).map((id) => [id, live[id]!])),
  };
  return new RecentActivityService(() => em, catalog, visibility, async () => [], references);
}

describe('recent activity — an erased snapshot value (issue #844)', () => {
  it('names a product by its live label, not by the marker', async () => {
    const svc = service(
      [
        entry({
          action: 'product.update',
          objectType: 'product',
          objectId: PRODUCT,
          stateBefore: { name: { en: ERASED, pl: ERASED }, sku: ERASED },
          stateAfter: { name: ERASED, sku: ERASED },
        }),
      ],
      { [PRODUCT]: { id: PRODUCT, label: 'Live product', url: `/catalog/products/${PRODUCT}` } },
    );
    const [item] = (await svc.list()).data;
    expect(item!.targetDisplayName).toBe('Live product');
  });

  it('falls back to the id when there is no live label either', async () => {
    const svc = service(
      [
        entry({ action: 'warehouse.update', objectType: 'warehouse', objectId: WAREHOUSE, stateAfter: { name: ERASED, code: ERASED } }),
        entry({ action: 'stock.adjust', objectType: 'stock_level', objectId: STOCK, stateAfter: { productSku: ERASED, warehouseCode: ERASED, productId: PRODUCT } }),
      ],
      {},
    );
    const items = (await svc.list()).data;
    expect(items.map((i) => i.targetDisplayName)).toEqual([WAREHOUSE, STOCK]);
  });

  it('leaves an erased key out of the compact summary', async () => {
    const svc = service(
      [
        entry({
          action: 'product.bulk_update',
          objectType: 'bulk_operation',
          objectId: BULK,
          stateAfter: { fileName: ERASED, rowsProcessed: 4 },
        }),
      ],
      {},
    );
    const [item] = (await svc.list()).data;
    expect(item!.summary).toEqual({ rowsProcessed: 4 });
    expect(item!.targetDisplayName).toBe(BULK);
    expect(JSON.stringify(item)).not.toContain(ERASED);
  });

  it('keeps a snapshot name that is not the marker, as before', async () => {
    const svc = service(
      [entry({ action: 'warehouse.update', objectType: 'warehouse', objectId: WAREHOUSE, stateAfter: { name: '[erased] by hand' } })],
      {},
    );
    const [item] = (await svc.list()).data;
    expect(item!.targetDisplayName).toBe('[erased] by hand');
  });
});
