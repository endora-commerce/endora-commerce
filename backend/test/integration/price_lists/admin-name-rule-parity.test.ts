import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foldAdminName } from '@endora-commerce/contracts';
import { Product } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CatalogProductReadService } from '../../../../packages/modules/catalog/src/backend/services/catalog-product-read.service.js';

/**
 * Feature 161, G15 redesign, on feature 170's model — the grid shows a product line's label as the
 * Global name (else the SKU, FR-031) and orders it by `catalog`'s stored key. The two must agree,
 * or the grid's order would not follow its labels:
 *
 * - for every fixture read back from the database, the folded label equals
 *   `catalog_admin_name_key(name, sku)`;
 * - the TypeScript fold `price_lists` orders its attribute and category lines
 *   by (`foldAdminName`) equals the SQL fold the key is built with.
 */
describe('admin name rule — the grid label and the catalogue key agree (161 G15, 170)', () => {
  let h: BackendServerHandle;
  const stamp = randomUUID().slice(0, 6).toUpperCase();
  const ids: string[] = [];
  const NAMES: string[] = ['Apple screw', 'Łącznik śrubowy', '', 'Żaba ąę', 'Dübel'];
  const FOLDS = ['Łódź', 'ŻÓŁW', 'Straße', 'Ærø', 'đak', 'café', 'ǅemal', 'Ąę Ćń Óś Źż', 'plain ASCII 0123'];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const products = NAMES.map((name, i) =>
      em.create(Product, {
        sku: `G15P-${i}-${stamp}`,
        slug: `g15p-${i}-${stamp.toLowerCase()}`,
        type: 'simple',
        status: 'active',
        name,
        description: '',
        visibility: 'public',
        attributeValues: {},
      }),
    );
    await em.persistAndFlush(products);
    ids.push(...products.map((p) => p.id));
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('the folded label equals the stored key for every fixture', async () => {
    const read = await new CatalogProductReadService(h.em).findByIds(ids);
    expect(read).toHaveLength(NAMES.length);
    for (const product of read) {
      const [row] = (await h
        .em()
        .getConnection()
        .execute(`select catalog_admin_name_key(name, sku) as key from products where id = ?`, [product.id])) as Array<{
        key: string;
      }>;
      expect(foldAdminName(product.name || product.sku), product.name).toBe(row!.key);
    }
  });

  it('the TypeScript fold equals the SQL fold', async () => {
    for (const text of FOLDS) {
      const [row] = (await h.em().getConnection().execute(`select catalog_admin_name_key(?::text, 'x') as key`, [text])) as Array<{
        key: string;
      }>;
      expect(foldAdminName(text), text).toBe(row!.key);
    }
  });

  it('folds ł and Ł to l, which NFKD leaves alone, in both folds (R14: Łącznik sorts with L)', async () => {
    // Equality alone would pass two folds that were wrong the same way: `ł`
    // has no canonical or compatibility decomposition, so a fold that only
    // decomposed and stripped marks would keep it, and `Łącznik` would sort
    // after `Z`. So the expected value is written down, for each fold.
    const EXPECTED: ReadonlyArray<readonly [string, string]> = [
      ['Łącznik', 'lacznik'],
      ['ŁÓDŹ', 'lodz'],
      ['żółw', 'zolw'],
    ];
    for (const [text, folded] of EXPECTED) {
      const [row] = (await h.em().getConnection().execute(`select catalog_admin_name_key(?::text, 'x') as key`, [text])) as Array<{
        key: string;
      }>;
      expect(foldAdminName(text), `TypeScript fold of ${text}`).toBe(folded);
      expect(row!.key, `SQL fold of ${text}`).toBe(folded);
    }
  });
});
