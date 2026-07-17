import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ProductLinkService } from '../../../src/modules/catalog/services/product-link.service.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

/**
 * Feature 052 (US4) — PDP related/cross/up-sell products are always
 * channel-filtered (FR-006).
 *
 * `listForStorefront` must confine targets to a resolved sales channel even
 * when no `x-sales-channel` header is present: with no explicit channel it
 * falls back to the system-default channel and filters against it, never
 * returning the full unfiltered target set.
 *
 * Products are created directly via the EM (not the catalog create path) so
 * they do NOT auto-bind to the default channel — the test controls channel
 * membership explicitly.
 */
describe('ProductLinkService.listForStorefront — channel filter (feature 052 US4)', () => {
  let h: BackendServerHandle;
  let svc: ProductLinkService;
  let channelACode: string;
  let channelAId: string;
  let defaultChannelId: string;
  let counter = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new ProductLinkService(() => h.em());

    const def = await h.salesChannels.resolver.getSystemDefault();
    if (!def) throw new Error('system-default sales channel missing in test setup');
    defaultChannelId = def.id;

    const em = h.em();
    const channelA = em.create(SalesChannel, {
      code: 'f052-cross-sell-a',
      name: { en: 'Feature 052 Cross-sell Channel A' },
      defaultLanguage: 'en-US',
      defaultCurrency: 'PLN',
      languages: ['en-US'],
      currencies: ['PLN'],
      isPublic: false,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush(channelA);
    channelACode = channelA.code;
    channelAId = channelA.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function makeProduct(): Promise<Product> {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const em = h.em();
    const product = em.create(Product, {
      sku: `F052-${suffix}`,
      slug: `f052-${suffix}`,
      type: 'simple',
      status: 'active',
      name: { en: `F052 ${suffix}` },
      description: { en: 'fixture' },
      visibility: 'public',
      attributeValues: {},
      allowedOrganizationIds: [],
    });
    await em.persistAndFlush(product);
    return product;
  }

  /** Create source S with a cross-sell link to a fresh target T. */
  async function linked(): Promise<{ sourceId: string; targetId: string }> {
    const source = await makeProduct();
    const target = await makeProduct();
    await svc.bulkCreate(source.id, [{ targetProductId: target.id, kind: 'cross_sell' }]);
    return { sourceId: source.id, targetId: target.id };
  }

  it('hides a target that is not in the resolved (default) channel when no header is present', async () => {
    const { sourceId, targetId } = await linked();
    // T is a member of channel A only — NOT of the system default.
    await h.salesChannels.membershipService.addToChannel(channelAId, 'product', targetId);

    const result = await svc.listForStorefront(sourceId, {});
    const ids = result.map((r) => r.product.id);
    expect(ids).not.toContain(targetId);
  });

  it('shows the target when its channel is explicitly requested (header-present unchanged)', async () => {
    const { sourceId, targetId } = await linked();
    await h.salesChannels.membershipService.addToChannel(channelAId, 'product', targetId);

    const result = await svc.listForStorefront(sourceId, { salesChannelCode: channelACode });
    const ids = result.map((r) => r.product.id);
    expect(ids).toContain(targetId);
  });

  it('shows a target that is a member of the system-default channel when no header is present', async () => {
    const { sourceId, targetId } = await linked();
    await h.salesChannels.membershipService.addToChannel(defaultChannelId, 'product', targetId);

    const result = await svc.listForStorefront(sourceId, {});
    const ids = result.map((r) => r.product.id);
    expect(ids).toContain(targetId);
  });
});
