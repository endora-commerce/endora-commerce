import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import type { CatalogAdminService } from '../../../../packages/modules/catalog/src/backend/services/catalog-admin.service.js';
import { Product } from '../../helpers/package-entities.js';
import { ProductWarehouseLowStockThreshold } from '../../helpers/package-entities.js';
import { Warehouse } from '../../helpers/package-entities.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Product duplication across the two boundaries it used to reach through —
 * issue #185.
 *
 * `duplicateProduct` ran two raw statements after its `CommandBus.run` had
 * returned: an `insert … select` into `inventory`'s
 * `product_warehouse_low_stock_thresholds`, and another into the kernel's
 * `sales_channel_products` bridge. Neither named an import specifier, so the
 * boundary they crossed compiled; neither asked a gate, so the threshold copy
 * proceeded with `inventory` switched off; and neither left an audit row on the
 * owner's side, so a duplicate that joined a product to every one of the
 * source's channels recorded nothing about it.
 *
 * The three cases below are the three halves of that, in the order they were
 * found:
 *
 *  1. the copies still happen, and each is audited by the module that owns the
 *     rows;
 *  2. with `inventory` **deactivated** the duplication still succeeds and
 *     writes nothing into that module's table — this is the case that was red,
 *     because a raw `insert` cannot be switched off;
 *  3. switching it back on restores the copy, because off is non-destructive.
 */
describe('duplicateProduct — the two cross-module copies [real DB]', () => {
  let h: BackendServerHandle;
  let adminService: CatalogAdminService;
  let defaultChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    adminService = (h.container.cradle as unknown as { catalogAdminService: CatalogAdminService })
      .catalogAdminService;
    defaultChannelId = (await h.salesChannels.resolver.getSystemDefault()).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const run = async <T>(what: string, fn: () => Promise<T>): Promise<T> =>
    withSystemScope(`issue #185 test — ${what}`, fn);

  const createWarehouse = async (): Promise<string> => {
    const em = h.em();
    const code = `w185d-${randomUUID().slice(0, 8)}`;
    const warehouse = em.create(Warehouse, { name: code, code, active: true });
    await em.persistAndFlush(warehouse);
    return warehouse.id;
  };

  /** A source product bound to the default channel, with one per-warehouse threshold. */
  const seedSource = async (
    label: string,
  ): Promise<{ productId: string; warehouseId: string }> => {
    const em = h.em();
    const suffix = `${label}-${randomUUID().slice(0, 6)}`;
    const product = em.create(Product, {
      sku: `W185D-${suffix}`,
      slug: `w185d-${suffix.toLowerCase()}`,
      type: 'simple',
      status: 'active',
      name: { en: `W185D ${suffix}` },
      description: { en: 'fixture' },
      visibility: 'public',
      attributeValues: {},
      allowedOrganizationIds: [],
    });
    await em.persistAndFlush(product);

    await h.salesChannels.membershipService.addToChannel(
      defaultChannelId,
      'product',
      product.id,
    );

    const warehouseId = await createWarehouse();
    em.persist(
      em.create(ProductWarehouseLowStockThreshold, {
        productId: product.id,
        warehouseId,
        threshold: 6,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await em.flush();
    return { productId: product.id, warehouseId };
  };

  const thresholdCount = async (productId: string): Promise<number> =>
    h.em().count(ProductWarehouseLowStockThreshold, { productId });

  const channelsOf = async (productId: string): Promise<string[]> => {
    const channels = await h.salesChannels.membershipService.listChannelsForEntity(
      'product',
      productId,
    );
    return channels.map((channel) => channel.id).sort();
  };

  const membershipAuditCount = async (productId: string): Promise<number> =>
    h.em().count(AuditLogEntry, {
      objectType: 'sales_channel_membership',
      objectId: `${defaultChannelId}:product:${productId}`,
    });

  const thresholdCopyAuditCount = async (): Promise<number> =>
    h.em().count(AuditLogEntry, { action: 'inventory.product_thresholds.copy' });

  it('copies both, and each owner audits its own rows', async () => {
    const { productId, warehouseId } = await seedSource('on');
    const copyAuditsBefore = await thresholdCopyAuditCount();

    const dup = await run('duplicate with inventory present', () =>
      adminService.duplicateProduct(productId),
    );

    h.em().clear();
    expect(await channelsOf(dup.id)).toEqual([defaultChannelId]);
    // Principle XIII — the memberships the duplicate gained are recorded by the
    // service that owns the bridge, one row per membership added.
    expect(await membershipAuditCount(dup.id)).toBe(1);

    const rows = await h.em().find(ProductWarehouseLowStockThreshold, { productId: dup.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.warehouseId).toBe(warehouseId);
    expect(rows[0]!.threshold).toBe(6);
    expect(await thresholdCopyAuditCount()).toBe(copyAuditsBefore + 1);
  });

  it('duplicates without touching `inventory`\'s table while that module is deactivated', async () => {
    const { productId } = await seedSource('off');

    const dup = await withModuleOff('inventory', 'deactivated', () =>
      run('duplicate with inventory off', () => adminService.duplicateProduct(productId)),
    );

    h.em().clear();
    // The duplication is a catalog operation and `catalog` is non-deactivatable:
    // an optional module being off may cost the duplicate its alerting profile,
    // never the duplicate itself.
    expect(dup.id).toBeTruthy();
    expect(await thresholdCount(dup.id)).toBe(0);
    // The bridge copy is the kernel's, not `inventory`'s, so it is unaffected.
    expect(await channelsOf(dup.id)).toEqual([defaultChannelId]);
  });

  it('copies again once `inventory` is switched back on', async () => {
    const { productId, warehouseId } = await seedSource('restored');

    const dup = await run('duplicate after restoration', () =>
      adminService.duplicateProduct(productId),
    );

    h.em().clear();
    const rows = await h.em().find(ProductWarehouseLowStockThreshold, { productId: dup.id });
    expect(rows.map((row) => row.warehouseId)).toEqual([warehouseId]);
  });
});
