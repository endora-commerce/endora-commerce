import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foldAdminName } from '@endora-commerce/contracts';
import { Product } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CatalogProductReadService } from '../../../../packages/modules/catalog/src/backend/services/catalog-product-read.service.js';
import { pickName } from '../../../../packages/modules/price_lists/src/backend/services/price-book-reads.js';

/**
 * Feature 161, G15 redesign (`research.md` R14) — the grid shows a product line's
 * label through `price_lists`' `pickName` and orders it by `catalog`'s stored
 * key. The two must agree, or the grid's order would not follow its labels:
 *
 * - for every fixture read back from the database, `pickName(name, L, sku)`
 *   equals `catalog_admin_display_name(name, sku, L)`;
 * - the TypeScript fold `price_lists` orders its attribute and category lines
 *   by (`foldAdminName`) equals the SQL fold the key is built with.
 */
describe('admin name rule — the grid label and the catalogue key agree (161 G15)', () => {
  let h: BackendServerHandle;
  const stamp = randomUUID().slice(0, 6).toUpperCase();
  const ids: string[] = [];
  const NAMES: Array<Record<string, string>> = [
    { 'en-US': 'Zebra screw', 'en-GB': 'Apple screw' },
    { 'pl-PL': 'Łącznik śrubowy' },
    {},
    { 'en-US': '' },
    { 'pl-PL': 'Żaba ąę', 'en-US': 'FROG Leg' },
    { de: 'Dübel', 'en-Latn': 'Plug' },
    { pl: 'Śruba', 'pl-PL': 'Wkręt' },
    { 'EN-us': 'Odd case tag' },
  ];
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
        description: { 'en-US': '' },
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

  it('pickName equals catalog_admin_display_name for every fixture and admin language', async () => {
    const read = await new CatalogProductReadService(h.em).findByIds(ids);
    expect(read).toHaveLength(NAMES.length);
    for (const product of read) {
      for (const lang of ['en', 'pl']) {
        const [row] = (await h
          .em()
          .getConnection()
          .execute(`select catalog_admin_display_name(name, sku, ?) as shown from products where id = ?`, [lang, product.id])) as Array<{
          shown: string;
        }>;
        expect(pickName(product.name, lang, product.sku), `${JSON.stringify(product.name)} in ${lang}`).toBe(row!.shown);
      }
    }
  });

  it('the TypeScript fold equals the SQL fold', async () => {
    for (const text of FOLDS) {
      const [row] = (await h.em().getConnection().execute(`select catalog_admin_name_key(jsonb_build_object('en', ?::text), 'x', 'en') as key`, [text])) as Array<{
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
      const [row] = (await h.em().getConnection().execute(`select catalog_admin_name_key(jsonb_build_object('en', ?::text), 'x', 'en') as key`, [text])) as Array<{
        key: string;
      }>;
      expect(foldAdminName(text), `TypeScript fold of ${text}`).toBe(folded);
      expect(row!.key, `SQL fold of ${text}`).toBe(folded);
    }
  });
});
