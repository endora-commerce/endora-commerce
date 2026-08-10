import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PriceList } from '../../../src/modules/price_lists/entities/price-list.entity.js';
import { PriceListProduct } from '../../../src/modules/price_lists/entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../../../src/modules/price_lists/entities/price-list-price-bracket.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';

/**
 * Feature 011 / US1 — Default seed + legacy migration.
 *
 * Verifies:
 *   - FR-001: a single `Default` row exists post-migration with type=base,
 *     status=active, isSystem=true, an empty rule.
 *   - FR-002: the legacy `attributeValues.defaultPrice` is migrated into one
 *     bracket per currency exposed by any sales channel + the platform's
 *     default currency (PLN).
 *   - Idempotency: re-running the migrator is a no-op.
 *   - Default-list protection: status remains `active`, rule remains `{kind:'all'}`.
 */
describe('Feature 011 / US1 — Default price list + legacy migration (T027)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    // The shared test DB's price_lists table is truncated by setupBackendServer
    // between contract-test files; re-seed Default for our isolated tests.
    const migrator = new DefaultPriceListMigrator(() => db.em());
    await migrator.seedDefault();
  });

  it('FR-001: migration 031 seeds exactly one Default row with the documented shape', async () => {
    try {
      const em = db.em();
      const def = await em.findOneOrFail(PriceList, { id: DEFAULT_PRICE_LIST_ID });
      expect(def.isSystem).toBe(true);
      expect(def.type).toBe('base');
      expect(def.status).toBe('active');
      expect(def.applicationRule).toEqual({ kind: 'all' });
      expect(def.name).toBe('Default');

      // No other isSystem rows.
      const allSystem = await em.find(PriceList, { isSystem: true });
      expect(allSystem).toHaveLength(1);
      expect(allSystem[0]?.id).toBe(DEFAULT_PRICE_LIST_ID);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-002 + Q3: legacy attributeValues.defaultPrice migrates into bracket rows per currency', async () => {
    try {
      const em = db.em();
      // Seed a sales channel exposing PLN + EUR.
      const channel = em.create(SalesChannel, {
        code: 'pl_q3_test',
        name: { 'pl-PL': 'Test', 'en-US': 'Test' },
        isPublic: true,
        defaultLanguage: 'pl-PL',
        defaultCurrency: 'PLN',
        languages: ['pl-PL'],
        currencies: ['PLN', 'EUR'],
      });
      // Seed a product carrying the legacy defaultPrice key.
      const product = em.create(Product, {
        sku: 'us1-migration-test-1',
        slug: 'us1-migration-test-1',
        type: 'simple',
        name: { 'en-US': 'US1 migration test product' },
        description: { 'en-US': '' },
        attributeValues: { defaultPrice: 123.45 },
        visibility: 'public',
      });
      await em.persistAndFlush([channel, product]);

      // Run the migration helper.
      const migrator = new DefaultPriceListMigrator(() => em);
      const report = await migrator.run();

      expect(report.productsAssigned).toBeGreaterThanOrEqual(1);
      expect(report.bracketRowsInserted).toBeGreaterThanOrEqual(2);

      // Verify the assignment + bracket rows exist for our product.
      const assignment = await em.findOneOrFail(PriceListProduct, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        productId: product.id,
      });
      expect(assignment.productId).toBe(product.id);

      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        productId: product.id,
      });
      const currencies = brackets.map((b) => b.currencyCode).sort();
      expect(currencies).toContain('PLN');
      expect(currencies).toContain('EUR');
      // Identity copy: same numeric in every currency.
      for (const b of brackets) {
        expect(Number(b.amount)).toBeCloseTo(123.45);
        expect(b.minQuantity).toBe(1);
        expect(b.maxQuantity ?? null).toBeNull();
      }

      // Multi-currency identity copy is reported (Q3 visibility).
      const multi = report.productsWithMultiCurrencyIdentityCopy.find(
        (p) => p.productId === product.id,
      );
      expect(multi).toBeDefined();
      expect(multi?.currencies.sort()).toEqual(expect.arrayContaining(['EUR', 'PLN']));
    } finally {
      await db.rollbackTx();
    }
  });

  it('migration helper is idempotent — re-running yields no new rows', async () => {
    try {
      const em = db.em();
      const channel = em.create(SalesChannel, {
        code: 'pl_idem',
        name: { 'pl-PL': 'Idem', 'en-US': 'Idem' },
        isPublic: true,
        defaultLanguage: 'pl-PL',
        defaultCurrency: 'PLN',
        languages: ['pl-PL'],
        currencies: ['PLN'],
      });
      const product = em.create(Product, {
        sku: 'us1-idem-1',
        slug: 'us1-idem-1',
        type: 'simple',
        name: { 'en-US': 'Idem' },
        description: { 'en-US': '' },
        attributeValues: { defaultPrice: 50.0 },
        visibility: 'public',
      });
      await em.persistAndFlush([channel, product]);

      const migrator = new DefaultPriceListMigrator(() => em);
      const first = await migrator.run();
      expect(first.bracketRowsInserted).toBeGreaterThanOrEqual(1);

      const second = await migrator.run();
      expect(second.bracketRowsInserted).toBe(0);
      expect(second.productsAssigned).toBe(0);

      // Final bracket count for this product is 1 — no duplicates.
      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        productId: product.id,
      });
      expect(brackets).toHaveLength(1);
    } finally {
      await db.rollbackTx();
    }
  });

  it('migration helper accepts the legacy `price` alias when `defaultPrice` is missing', async () => {
    try {
      const em = db.em();
      const channel = em.create(SalesChannel, {
        code: 'pl_alias',
        name: { 'pl-PL': 'A', 'en-US': 'A' },
        isPublic: true,
        defaultLanguage: 'pl-PL',
        defaultCurrency: 'PLN',
        languages: ['pl-PL'],
        currencies: ['PLN'],
      });
      const product = em.create(Product, {
        sku: 'us1-alias-1',
        slug: 'us1-alias-1',
        type: 'simple',
        name: { 'en-US': 'Alias' },
        description: { 'en-US': '' },
        attributeValues: { price: 77.77 },
        visibility: 'public',
      });
      await em.persistAndFlush([channel, product]);

      const migrator = new DefaultPriceListMigrator(() => em);
      await migrator.run();

      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        productId: product.id,
      });
      expect(brackets).toHaveLength(1);
      expect(Number(brackets[0]?.amount)).toBeCloseTo(77.77);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-005 / FR-006: PriceListService refuses to delete the Default row, reject empty rule changes, and reject status moves away from active', async () => {
    try {
      const em = db.em();
      const { PriceListService } = await import(
        '../../../src/modules/price_lists/services/price-list-service.js'
      );
      const svc = new PriceListService(() => em);

      // Delete refused.
      await expect(svc.remove(DEFAULT_PRICE_LIST_ID)).rejects.toMatchObject({
        statusCode: 403,
      });

      // Rule attachment refused.
      await expect(
        svc.assertCanSetApplicationRule(DEFAULT_PRICE_LIST_ID, {
          kind: 'criterion',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });

      // Empty-rule "edit" is allowed (no-op rule stays {kind:'all'}).
      await expect(
        svc.assertCanSetApplicationRule(DEFAULT_PRICE_LIST_ID, { kind: 'all' }),
      ).resolves.toBeUndefined();

      // Status move away from active refused.
      await expect(
        svc.assertCanTransitionStatus(DEFAULT_PRICE_LIST_ID, 'draft'),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        svc.assertCanTransitionStatus(DEFAULT_PRICE_LIST_ID, 'expired'),
      ).rejects.toMatchObject({ statusCode: 403 });

      // Staying active is fine.
      await expect(
        svc.assertCanTransitionStatus(DEFAULT_PRICE_LIST_ID, 'active'),
      ).resolves.toBeUndefined();

      // Non-system list has no protections.
      const free = em.create(PriceList, {
        code: 'free',
        name: 'Free list',
        currency: 'PLN',
        type: 'sale',
        status: 'draft',
      });
      await em.persistAndFlush(free);
      await expect(
        svc.assertCanSetApplicationRule(free.id, { kind: 'criterion' }),
      ).resolves.toBeUndefined();
      await expect(
        svc.assertCanTransitionStatus(free.id, 'draft'),
      ).resolves.toBeUndefined();
    } finally {
      await db.rollbackTx();
    }
  });

  it('skips products with unparseable legacy values (zero rows, reported)', async () => {
    try {
      const em = db.em();
      const channel = em.create(SalesChannel, {
        code: 'pl_skip',
        name: { 'pl-PL': 'S', 'en-US': 'S' },
        isPublic: true,
        defaultLanguage: 'pl-PL',
        defaultCurrency: 'PLN',
        languages: ['pl-PL'],
        currencies: ['PLN'],
      });
      const product = em.create(Product, {
        sku: 'us1-skip-1',
        slug: 'us1-skip-1',
        type: 'simple',
        name: { 'en-US': 'Skip' },
        description: { 'en-US': '' },
        attributeValues: { defaultPrice: 'not a number' },
        visibility: 'public',
      });
      await em.persistAndFlush([channel, product]);

      const migrator = new DefaultPriceListMigrator(() => em);
      const report = await migrator.run();

      const skipped = report.productsSkipped.find((s) => s.productId === product.id);
      expect(skipped).toBeDefined();
      expect(['legacy_price_null', 'legacy_price_invalid']).toContain(skipped?.reason);

      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        productId: product.id,
      });
      expect(brackets).toHaveLength(0);
    } finally {
      await db.rollbackTx();
    }
  });
});
