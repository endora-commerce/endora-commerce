import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '../../../src/events/bus.js';
import { CatalogAdminService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { DefaultChannelReconciler } from '../../../src/kernel/sales-channels/default-channel-reconciler.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T024 — FR-011: an entity created without explicit channel selection
 * is bound to the system-default Sales Channel automatically.
 *
 * The full FR-011 wiring (T027) covers many owning modules; this test
 * exercises the Product create path as the representative case.
 * The remaining wirings (Category, Customer, Promotion, CMS Page,
 * Tax, PaymentMethod, DeliveryMethod, Organization) land alongside
 * US3's admin-UI mounting (T066) and gain their own tests there.
 */
describe('entity create binds to Default when no channels are specified (T024)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  it('Product created with no channel input is bound to the system default', async () => {
    try {
      const em = db.em();
      await new DefaultChannelReconciler(() => em).run();
      const def = await em.findOneOrFail(SalesChannel, { systemDefault: true });

      const eventBus = new EventBus();
      const membership = new SalesChannelMembershipService(() => db.em(), eventBus);
      const catalog = new CatalogAdminService(
        () => db.em(),
        eventBus as never,
        undefined,
        membership,
      );

      const product = await catalog.createProduct({
        sku: 'T024-SKU-A',
        type: 'simple',
        name: { en: 'T024 product' },
        description: { en: 'fixture' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      });

      const channels = await membership.listChannelsForEntity('product', product.id);
      expect(channels.map((c) => c.id)).toEqual([def.id]);
    } finally {
      await db.rollbackTx();
    }
  });

  it('Product creation without the membership service still succeeds (back-compat)', async () => {
    try {
      const em = db.em();
      await new DefaultChannelReconciler(() => em).run();
      const eventBus = new EventBus();
      // No membership service injected — old test fixtures construct the
      // service this way; we must not regress them. The Product simply
      // ships without channel memberships in that case (FR-008's
      // enforcement happens later, when something tries to read it
      // through a channel-scoped query).
      const catalog = new CatalogAdminService(() => db.em(), eventBus as never);

      const product = await catalog.createProduct({
        sku: 'T024-SKU-B',
        type: 'simple',
        name: { en: 'T024 product B' },
        description: { en: 'fixture' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      });
      expect(product.id).toBeDefined();
    } finally {
      await db.rollbackTx();
    }
  });
});
