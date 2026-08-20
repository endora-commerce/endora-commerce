import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CatalogQueryService } from '../../../src/modules/catalog/services/catalog-query.service.js';
import type { ProductAttribute } from '../../../src/modules/catalog/entities/product-attribute.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { AttributeSetAttribute } from '../../../src/modules/catalog/entities/attribute-set-attribute.entity.js';
import { createAttributeFixture } from '../../helpers/seed-catalog.js';
import { ANONYMOUS_PRODUCT_AUDIENCE } from '@b2b/contracts';

/**
 * Feature 012 / T067 — `visibleAttributes` projection p95 latency.
 *
 * Spec target — building the per-product `visibleAttributes[]` payload
 * (used by the storefront PDP "Parametry produktu" tab) stays under the
 * catalog-read budget at 50 attributes / 10 visible products.
 *
 * The fixture seeds:
 *   - 50 ProductAttributes, all flagged `isVisibleOnProductPage = true`,
 *     mixing string / enum / select / multiselect / number / boolean
 *     types so the resolver exercises every branch (option lookup,
 *     boolean rendering, scalar coercion, multiselect join).
 *   - 10 Products. Each carries a value for every one of the 50
 *     attributes so each PDP load drives the maximum projection size.
 *   - A `sales_channel_products` row per product. `getProductByIdOrSlug`
 *     narrows through `filterByChannel`, which fails closed to the empty
 *     set (Principle XII) and answers 404 for a product the channel does
 *     not carry — so without membership this harness measures nothing at
 *     all. It has thrown since channel scoping landed, unseen because no
 *     job sets `PERF_RUN` (issue #140).
 *
 * The run asserts the projection it built before it asserts how long that
 * took: every timed read carries a value for every seeded attribute.
 *
 * ## The budget (issue #143, D-65)
 *
 * Measured 2026-08-17 over four runs on a 16-core / 64 GB Linux dev box, load
 * average 1.7-3.6, Postgres 16 on localhost: p95 12.45 / 14.06 / 13.23 /
 * 12.30 ms. Budget = worst observed × 3, rounded up: **45 ms**, down from 80.
 * The multiplier is ×3 rather than D-65's ×2 for the reason stated in
 * `test/perf/catalog-list.bench.ts`: ×2 is regression headroom, the extra
 * ×1.5 covers this box against the 4 vCPU / 8 GB docker runner that enforces
 * the number. Re-base from the first three scheduled `perf:backend` runs.
 *
 * Tuning knobs (env):
 *   PERF_ATTR_COUNT    — number of attributes (default 50)
 *   PERF_PRODUCT_COUNT — products per iteration (default 10)
 *   PERF_ITERATIONS    — iteration count (default 100)
 *   PERF_VISIBLE_ATTRS_P95_MS — assertion budget (default 45, see above)
 *   PERF_RUN           — set to 'true' to actually run; otherwise the
 *                        suite skips so PR runs aren't blocked by
 *                        perf flake.
 */

const attrCount = Number(process.env['PERF_ATTR_COUNT'] ?? '50');
const productCount = Number(process.env['PERF_PRODUCT_COUNT'] ?? '10');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100');
const p95Budget = Number(process.env['PERF_VISIBLE_ATTRS_P95_MS'] ?? '45');
const shouldRun = process.env['PERF_RUN'] === 'true';

const DEFAULT_SET_ID = 'defa0017-0000-4000-8000-000000000000';

describe.skipIf(!shouldRun)('catalog visibleAttributes — p95 latency', () => {
  let h: BackendServerHandle;
  let svc: CatalogQueryService;
  const productSlugs: string[] = [];
  const products: Product[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new CatalogQueryService(
      h.em,
      undefined,
      undefined,
      h.catalogAttributeRead,
      undefined,
      h.assetRead,
      h.salesChannels.membershipService,
    );
    const em = h.em();

    // Seed 50 attributes — mix of value types so every code branch fires.
    // Feature 061 — each fixture creates the definition + extension pair.
    const attrs: Array<{ extension: ProductAttribute; key: string; valueType: string }> = [];
    for (let i = 0; i < attrCount; i++) {
      const valueType =
        i % 5 === 0 ? 'enum' : i % 5 === 1 ? 'multiselect' : i % 5 === 2 ? 'number' : i % 5 === 3 ? 'boolean' : 'string';
      const isSelectStyle = valueType === 'enum' || valueType === 'multiselect';
      const { extension } = await createAttributeFixture(em, {
        key: `bench_attr_${i}`,
        label: { 'en-US': `Bench ${i}`, 'pl-PL': `Test ${i}` },
        labelDefault: `Bench ${i}`,
        valueType: valueType as 'enum' | 'multiselect' | 'number' | 'boolean' | 'string',
        isVisibleOnProductPage: true,
        sortOrder: i,
        ...(isSelectStyle
          ? {
              options: ['opt_a', 'opt_b', 'opt_c'].map((v) => ({
                value: v,
                label: { 'en-US': v.toUpperCase(), 'pl-PL': v.toUpperCase() },
                labelDefault: v.toUpperCase(),
                sortOrder: 0,
              })),
            }
          : {}),
      });
      attrs.push({ extension, key: `bench_attr_${i}`, valueType });
    }

    // Wire every attribute into the Default set so the position lookup
    // in buildVisibleAttributesProjection has work to do.
    await em.persistAndFlush(
      attrs.map((a, idx) =>
        em.create(AttributeSetAttribute, {
          attributeSetId: DEFAULT_SET_ID,
          customFieldDefinitionId: a.extension.customFieldDefinitionId,
          position: idx,
        }),
      ),
    );

    // Seed 10 products carrying values for every attribute.
    for (let i = 0; i < productCount; i++) {
      const values: Record<string, unknown> = {};
      for (const a of attrs) {
        if (a.valueType === 'enum') values[a.key] = 'opt_a';
        else if (a.valueType === 'multiselect') values[a.key] = ['opt_a', 'opt_b'];
        else if (a.valueType === 'number') values[a.key] = 42;
        else if (a.valueType === 'boolean') values[a.key] = true;
        else values[a.key] = 'sample';
      }
      const p = em.create(Product, {
        sku: `BENCH-${i}`,
        slug: `bench-product-${i}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Bench product ${i}` },
        description: { 'en-US': 'Perf bench fixture.' },
        visibility: 'public',
        attributeValues: values,
        attributeSetId: DEFAULT_SET_ID,
      });
      productSlugs.push(p.slug);
      products.push(p);
      em.persist(p);
    }
    await em.flush();

    // Bind the fixture to the channel the timed reads resolve, or every read
    // is a 404 rather than a projection.
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values ` +
        products.map(() => '(?,?)').join(','),
      products.flatMap((p) => [channelId, p.id]),
    );
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it(`p95 of visibleAttributes projection stays under ${p95Budget} ms`, async () => {
    const def = await h.salesChannels.resolver.getSystemDefault();
    const resolvedChannel = {
      id: def.id,
      code: def.code,
      isPublic: def.isPublic,
      defaultCurrency: def.defaultCurrency,
      defaultLanguage: def.defaultLanguage,
    };
    const samples: number[] = [];
    let minProjected = Number.POSITIVE_INFINITY;
    for (let i = 0; i < iterations; i++) {
      const slug = productSlugs[i % productSlugs.length]!;
      const t0 = performance.now();
      const detail = await svc.getProductByIdOrSlug(slug, {
        resolvedChannel,
        audience: ANONYMOUS_PRODUCT_AUDIENCE,
      });
      samples.push(performance.now() - t0);
      minProjected = Math.min(minProjected, detail.visibleAttributes?.length ?? 0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    // eslint-disable-next-line no-console
    console.log(
      `visible-attributes p95 ms = ${p95.toFixed(2)} (samples=${samples.length}, ` +
        `projected=${minProjected}/${attrCount})`,
    );
    // What was measured, before how long it took: the whole projection, on
    // every read. A 404 or an empty tab is cheaper than any budget can catch.
    expect(minProjected).toBe(attrCount);
    expect(p95).toBeLessThan(p95Budget);
  });
});
