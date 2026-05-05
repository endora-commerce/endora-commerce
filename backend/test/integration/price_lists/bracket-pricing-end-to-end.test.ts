import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { PriceListProduct } from '../../../src/modules/price_lists/entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../../../src/modules/price_lists/entities/price-list-price-bracket.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { DefaultPriceListMigrator } from '../../../src/modules/price_lists/services/default-price-list-migration.js';

/**
 * Feature 011 / US3 — Per-currency multi-bracket pricing (T044).
 *
 * Verifies:
 *   - FR-014: assign + bracket persists per (list, product, currency).
 *   - FR-015: overlap rejection inside a single (list, product, currency).
 *   - FR-016: inclusive interval semantics on integer quantities.
 *   - FR-017: removing a product cascades the bracket rows.
 *   - FR-018: currencies map per-list (independent series per currency).
 *   - FR-019: copy-currency-brackets is a per-currency duplication helper.
 */
describe('Feature 011 / US3 — multi-bracket pricing (T044)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    const migrator = new DefaultPriceListMigrator(() => db.em());
    await migrator.seedDefault();
  });

  async function makeProduct(em = db.em(), suffix = '1'): Promise<Product> {
    const p = em.create(Product, {
      sku: `us3-${suffix}`,
      slug: `us3-${suffix}`,
      type: 'simple',
      name: { 'en-US': `US3 product ${suffix}` },
      description: { 'en-US': '' },
      attributeValues: {},
      visibility: 'public',
    });
    await em.persistAndFlush(p);
    return p;
  }

  it('FR-014: addProduct creates a single (priceListId, productId) row idempotently', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'add');
      const list = await svc.create({ name: 'Add Test', type: 'base' });

      await svc.addProduct(list.id, product.id);
      await svc.addProduct(list.id, product.id); // idempotent

      const rows = await em.find(PriceListProduct, { priceListId: list.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.productId).toBe(product.id);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-014 + FR-018: replaceBrackets persists multi-currency multi-bracket rows', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'replace');
      const list = await svc.create({ name: 'Replace Test', type: 'sale' });

      await svc.addProduct(list.id, product.id);
      await svc.replaceBrackets(list.id, product.id, {
        PLN: [
          { minQuantity: 1, maxQuantity: 9, amount: '100.0000' },
          { minQuantity: 10, maxQuantity: 99, amount: '90.0000' },
          { minQuantity: 100, maxQuantity: null, amount: '80.0000' },
        ],
        EUR: [{ minQuantity: 1, maxQuantity: null, amount: '24.0000' }],
      });

      const rows = await em.find(PriceListPriceBracket, {
        priceListId: list.id,
        productId: product.id,
      });
      const byCurrency = rows.reduce<Record<string, PriceListPriceBracket[]>>((acc, r) => {
        (acc[r.currencyCode] ??= []).push(r);
        return acc;
      }, {});
      expect(byCurrency['PLN']).toHaveLength(3);
      expect(byCurrency['EUR']).toHaveLength(1);

      // Sorted ascending — confirm coverage.
      const pln = (byCurrency['PLN'] ?? []).sort((a, b) => a.minQuantity - b.minQuantity);
      expect(pln.map((r) => [r.minQuantity, r.maxQuantity ?? null, Number(r.amount)])).toEqual([
        [1, 9, 100],
        [10, 99, 90],
        [100, null, 80],
      ]);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-015: overlapping brackets are refused with a structured error', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'overlap');
      const list = await svc.create({ name: 'Overlap Test', type: 'sale' });

      await svc.addProduct(list.id, product.id);
      await expect(
        svc.replaceBrackets(list.id, product.id, {
          PLN: [
            { minQuantity: 1, maxQuantity: 10, amount: '100' },
            { minQuantity: 5, maxQuantity: 20, amount: '90' },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-015: minQuantity < 1 and maxQuantity < minQuantity are refused', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'invalid');
      const list = await svc.create({ name: 'Invalid Bracket', type: 'sale' });
      await svc.addProduct(list.id, product.id);

      await expect(
        svc.replaceBrackets(list.id, product.id, {
          PLN: [{ minQuantity: 0, maxQuantity: null, amount: '10' }],
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        svc.replaceBrackets(list.id, product.id, {
          PLN: [{ minQuantity: 10, maxQuantity: 5, amount: '10' }],
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-017: removing a product cascades the bracket rows', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'cascade');
      const list = await svc.create({ name: 'Cascade Test', type: 'sale' });

      await svc.addProduct(list.id, product.id);
      await svc.replaceBrackets(list.id, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: '50' }],
      });

      await svc.removeProduct(list.id, product.id);

      const products = await em.find(PriceListProduct, { priceListId: list.id });
      expect(products).toHaveLength(0);

      // FK CASCADE deletes brackets when the assignment row is removed.
      // Clear the EM cache so we read from the DB.
      em.clear();
      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: list.id,
        productId: product.id,
      });
      expect(brackets).toHaveLength(0);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-014: replaceProducts performs add+remove in one call (delta semantics)', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const a = await makeProduct(em, 'a');
      const b = await makeProduct(em, 'b');
      const c = await makeProduct(em, 'c');
      const list = await svc.create({ name: 'Replace Test', type: 'sale' });

      const first = await svc.replaceProducts(list.id, [a.id, b.id]);
      expect(first.added).toBe(2);
      expect(first.removed).toBe(0);

      const second = await svc.replaceProducts(list.id, [b.id, c.id]);
      expect(second.added).toBe(1); // c
      expect(second.removed).toBe(1); // a
      expect(second.unchanged).toBe(1); // b

      const rows = await em.find(PriceListProduct, { priceListId: list.id });
      expect(rows.map((r) => r.productId).sort()).toEqual([b.id, c.id].sort());
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-019: copyCurrencyBrackets duplicates one currency series into others', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'copy');
      const list = await svc.create({ name: 'Copy Test', type: 'sale' });

      await svc.addProduct(list.id, product.id);
      await svc.replaceBrackets(list.id, product.id, {
        PLN: [
          { minQuantity: 1, maxQuantity: 9, amount: '100' },
          { minQuantity: 10, maxQuantity: null, amount: '90' },
        ],
      });

      const result = await svc.copyCurrencyBrackets(list.id, product.id, 'PLN', ['EUR', 'CZK']);
      expect(result.added).toBe(4); // 2 brackets × 2 currencies

      em.clear();
      const rows = await em.find(PriceListPriceBracket, {
        priceListId: list.id,
        productId: product.id,
      });
      expect(rows).toHaveLength(6); // PLN(2) + EUR(2) + CZK(2)
      const eur = rows.filter((r) => r.currencyCode === 'EUR').sort((a, b) => a.minQuantity - b.minQuantity);
      expect(eur).toHaveLength(2);
      expect(Number(eur[0]?.amount)).toBe(100);
      expect(Number(eur[1]?.amount)).toBe(90);
    } finally {
      await db.rollbackTx();
    }
  });

  it('replaceBrackets is bracket-set-replacement, not append: missing currencies are cleared', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'replace2');
      const list = await svc.create({ name: 'Replace Set', type: 'sale' });

      await svc.addProduct(list.id, product.id);
      await svc.replaceBrackets(list.id, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
        EUR: [{ minQuantity: 1, maxQuantity: null, amount: '24' }],
      });

      // Replace with only PLN — EUR should be cleared.
      await svc.replaceBrackets(list.id, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: '95' }],
      });

      em.clear();
      const rows = await em.find(PriceListPriceBracket, {
        priceListId: list.id,
        productId: product.id,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.currencyCode).toBe('PLN');
      expect(Number(rows[0]?.amount)).toBe(95);
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses bracket writes for products not assigned to the list', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'unassigned');
      const list = await svc.create({ name: 'Unassigned Test', type: 'sale' });

      await expect(
        svc.replaceBrackets(list.id, product.id, {
          PLN: [{ minQuantity: 1, maxQuantity: null, amount: '50' }],
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses currency-copy when source currency has no brackets', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em);
      const product = await makeProduct(em, 'copy-empty');
      const list = await svc.create({ name: 'Copy Empty', type: 'sale' });

      await svc.addProduct(list.id, product.id);
      await expect(svc.copyCurrencyBrackets(list.id, product.id, 'PLN', ['EUR'])).rejects.toMatchObject({
        statusCode: 404,
      });
    } finally {
      await db.rollbackTx();
    }
  });
});
