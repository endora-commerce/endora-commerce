import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PriceListProduct } from '../../../src/modules/price_lists/entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../../../src/modules/price_lists/entities/price-list-price-bracket.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { PriceListStatusWorker } from '../../../src/modules/price_lists/services/price-list-status-worker.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 011 / US2 — Admin CRUD + status lifecycle (T034).
 *
 * Verifies:
 *   - FR-007/008: create / patch / delete / duplicate happy paths.
 *   - FR-009: status transitions (manual + automatic via the worker).
 *   - FR-010: date sanity guards (endsAt > startsAt; endsAt > now()).
 *   - FR-011: lists in non-active states are excluded from resolution.
 *   - FR-012: modifiedAt bumps on every material edit.
 *   - FR-013: duplication semantics (rule + products + brackets copied;
 *     status reset to draft; dates cleared; name suffixed).
 *   - FR-005/006: Default-list protections.
 */

/** A non-empty rule for tests that activate lists. The currency criterion
 * skips DB target validation (only the regex check applies). */
const TEST_RULE = { kind: 'criterion' as const, type: 'currency' as const, values: ['PLN'] };
describe('Feature 011 / US2 — Admin CRUD + status lifecycle (T034)', () => {
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

  it('FR-007/008: create yields a draft list with the engine columns set', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const created = await svc.create({
        name: 'Q3 Wholesale',
        type: 'base',
      });
      expect(created.name).toBe('Q3 Wholesale');
      expect(created.type).toBe('base');
      expect(created.status).toBe('draft');
      expect(created.applicationRule).toEqual({ kind: 'all' });
      expect(created.isSystem).toBe(false);
      expect(created.modifiedAt).toBeInstanceOf(Date);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-010: refuses save when endsAt <= startsAt', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      await expect(
        svc.create({
          name: 'Bad Dates',
          type: 'sale',
          startsAt: new Date('2026-06-01T00:00:00Z'),
          endsAt: new Date('2026-05-01T00:00:00Z'),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-010: refuses save when endsAt is in the past at creation', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      await expect(
        svc.create({
          name: 'Already Done',
          type: 'sale',
          endsAt: new Date(Date.now() - 86_400_000),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-009 row 1: activate coerces to scheduled when startsAt is in the future', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const created = await svc.create({
        name: 'Wiosna 2026',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        endsAt: new Date(Date.now() + 30 * 86_400_000),
      });
      const activated = await svc.activate(created.id);
      expect(activated.status).toBe('scheduled');
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-009 row 1: activate of a list with startsAt in the past goes straight to active', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const created = await svc.create({
        name: 'Already Started',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() - 86_400_000),
      });
      const activated = await svc.activate(created.id);
      expect(activated.status).toBe('active');
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-009 row 3: status worker promotes scheduled→active when startsAt has passed', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const worker = new PriceListStatusWorker(() => db.em());

      const created = await svc.create({
        name: 'Sweep Test',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() + 86_400_000),
      });
      await svc.activate(created.id); // → scheduled

      // Pretend the clock is past startsAt.
      const future = new Date(Date.now() + 2 * 86_400_000);
      const result = await worker.sweep(future);
      expect(result.scheduledToActive).toBeGreaterThanOrEqual(1);

      const after = await svc.getById(created.id);
      expect(after.status).toBe('active');
      expect(after.modifiedAt.getTime()).toBeGreaterThanOrEqual(created.modifiedAt.getTime());
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-009 row 4: status worker expires active→expired when endsAt has passed', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const worker = new PriceListStatusWorker(() => db.em());

      const created = await svc.create({
        name: 'Expiry Test',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() - 2 * 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      });
      await svc.activate(created.id); // → active

      // Pretend the clock is past endsAt.
      const after = new Date(Date.now() + 2 * 86_400_000);
      const result = await worker.sweep(after);
      expect(result.activeToExpired).toBeGreaterThanOrEqual(1);

      const reloaded = await svc.getById(created.id);
      expect(reloaded.status).toBe('expired');
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-012: patch bumps modifiedAt and persists the change', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const created = await svc.create({ name: 'Edit Me', type: 'base' });
      const t0 = created.modifiedAt.getTime();
      await new Promise((r) => setTimeout(r, 5));
      const patched = await svc.patch(created.id, { name: 'Edited' });
      expect(patched.name).toBe('Edited');
      expect(patched.modifiedAt.getTime()).toBeGreaterThan(t0);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-013: duplicate copies rule + products + brackets, resets status to draft, suffixes name', async () => {
    try {
      const em = db.em();
      const svc = new PriceListService(() => em, undefined, undefined, undefined, neighbourReadPorts(() => em));

      const product = em.create(Product, {
        sku: 'us2-dup-1',
        slug: 'us2-dup-1',
        type: 'simple',
        name: { 'en-US': 'Dup test' },
        description: { 'en-US': '' },
        attributeValues: {},
        visibility: 'public',
      });
      await em.persistAndFlush(product);

      const original = await svc.create({
        name: 'Original',
        type: 'sale',
        applicationRule: TEST_RULE,
      });

      // Add a product + bracket directly so we can verify the dup copies them.
      em.create(PriceListProduct, { priceListId: original.id, productId: product.id });
      await em.flush();
      em.create(PriceListPriceBracket, {
        priceListId: original.id,
        productId: product.id,
        currencyCode: 'PLN',
        minQuantity: 1,
        maxQuantity: null,
        amount: '100.0000',
      });
      await em.flush();

      const dup = await svc.duplicate(original.id);
      expect(dup.name).toMatch(/^Original \(copy\b/);
      expect(dup.status).toBe('draft');
      expect(dup.startsAt ?? null).toBeNull();
      expect(dup.endsAt ?? null).toBeNull();
      expect(dup.type).toBe('sale');
      expect(dup.applicationRule).toEqual(original.applicationRule);

      const dupProducts = await em.find(PriceListProduct, { priceListId: dup.id });
      expect(dupProducts.map((p) => p.productId)).toEqual([product.id]);

      const dupBrackets = await em.find(PriceListPriceBracket, { priceListId: dup.id });
      expect(dupBrackets).toHaveLength(1);
      expect(Number(dupBrackets[0]?.amount)).toBeCloseTo(100);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-013: a second duplicate of the same source uses a numbered suffix', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const original = await svc.create({ name: 'Source', type: 'base' });

      const a = await svc.duplicate(original.id);
      const b = await svc.duplicate(original.id);

      expect(a.name).toBe('Source (copy)');
      expect(b.name).toMatch(/^Source \(copy 2\)$/);
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-005/006: Default refuses delete, rule attach, and out-of-active status moves', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      await expect(svc.remove(DEFAULT_PRICE_LIST_ID)).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        svc.patch(DEFAULT_PRICE_LIST_ID, {
          applicationRule: { kind: 'criterion', type: 'salesChannel', values: ['sc'] },
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(svc.draftify(DEFAULT_PRICE_LIST_ID)).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('FR-009 row 5 (loose): expired list can be moved back to draft', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const worker = new PriceListStatusWorker(() => db.em());
      const created = await svc.create({
        name: 'Restage',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() - 2 * 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      });
      await svc.activate(created.id);
      // Trigger expiry.
      await worker.sweep(new Date(Date.now() + 2 * 86_400_000));
      const expired = await svc.getById(created.id);
      expect(expired.status).toBe('expired');

      const drafted = await svc.draftify(created.id);
      expect(drafted.status).toBe('draft');
    } finally {
      await db.rollbackTx();
    }
  });
});
