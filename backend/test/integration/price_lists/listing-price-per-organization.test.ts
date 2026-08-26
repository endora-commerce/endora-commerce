import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import { PricingCache } from '../../../../packages/modules/price_lists/src/backend/services/pricing-cache.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * A listing price resolved for a buyer is cached **per buyer**.
 *
 * `resolveListingPrices` took no organisation until the comparison started
 * naming one, so the listing path had never exercised the organisation
 * component of the resolver's cache key. A cache that ignored it would hand
 * the first buyer's negotiated price to the next caller on the same channel —
 * a worse disclosure than the one the viewer-priced comparison exists to
 * prevent — and nothing above this level could see it happen.
 *
 * The cache is live here on purpose: the composed server runs it with
 * `ttlMs: 0` in the test harness, so every suite above this one proves the
 * resolution and none of them proves the key.
 */
describe('listing prices are cached per organisation', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    await new DefaultPriceListMigrator(() => em).seedDefault();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('does not serve one organisation the price it resolved for another', async () => {
    const stamp = Math.floor(performance.now());
    const channel = em.create(SalesChannel, {
      code: `listing-org-${stamp}`,
      name: { 'pl-PL': 'T', 'en-US': 'T' },
      isPublic: true,
      defaultLanguage: 'pl-PL',
      defaultCurrency: 'PLN',
      languages: ['pl-PL'],
      currencies: ['PLN'],
    });
    const product = em.create(Product, {
      sku: `listing-org-prod-${stamp}`,
      slug: `listing-org-prod-${stamp}`,
      type: 'simple',
      name: { 'en-US': 'Listing product' },
      description: { 'en-US': '' },
      attributeValues: {},
      visibility: 'public',
    });
    const orgs = ['a', 'b'].map((suffix, index) =>
      em.create(Organization, {
        name: `Listing Org ${suffix}${stamp}`,
        taxId: `PL${String(stamp).padStart(8, '0').slice(-8)}${index}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: {
          street: 'ul. Testowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'PL',
        },
      }),
    );
    await em.persistAndFlush([channel, product, ...orgs]);

    const svc = new PriceListService(() => em, undefined, undefined, undefined, neighbourReadPorts(() => em));
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '33.0000' }],
    });
    const amounts = ['11.0000', '22.0000'];
    for (const [index, org] of orgs.entries()) {
      const list = await svc.create({
        name: `Negotiated ${index}`,
        type: 'base',
        applicationRule: { kind: 'criterion', type: 'organization', values: [org.id] },
      });
      await svc.addProduct(list.id, product.id);
      await svc.replaceBrackets(list.id, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: amounts[index]! }],
      });
      await svc.activate(list.id);
    }

    const cache = new PricingCache<Awaited<ReturnType<PricingService['resolveEngine']>>>();
    const pricing = new PricingService(() => em, cache, undefined, neighbourReadPorts(() => em));

    const priceFor = async (organization: { id: string } | null): Promise<string | undefined> => {
      const resolved = await pricing.resolveListingPrices({
        products: [product],
        context: { salesChannel: channel, ...(organization ? { organization } : {}) },
      });
      const entry = resolved.get(product.id);
      return entry?.source === 'none' ? undefined : entry?.amount;
    };

    expect(Number(await priceFor({ id: orgs[0]!.id }))).toBe(11);
    // Same product, same channel, same currency, same quantity — only the
    // buyer differs. A key without the organisation answers 11 here.
    expect(Number(await priceFor({ id: orgs[1]!.id }))).toBe(22);
    // And the first buyer still gets their own on the second read.
    expect(Number(await priceFor({ id: orgs[0]!.id }))).toBe(11);
    // The anonymous listing keeps the channel's answer, which is neither.
    expect(Number(await priceFor(null))).toBe(33);
  });
});
