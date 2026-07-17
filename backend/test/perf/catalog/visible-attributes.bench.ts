import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CatalogQueryService } from '../../../src/modules/catalog/services/catalog-query.service.js';
import { ProductAttribute } from '../../../src/modules/catalog/entities/product-attribute.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { AttributeOption } from '../../../src/modules/catalog/entities/attribute-option.entity.js';
import { AttributeSetAttribute } from '../../../src/modules/catalog/entities/attribute-set-attribute.entity.js';

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
 *
 * Tuning knobs (env):
 *   PERF_ATTR_COUNT    — number of attributes (default 50)
 *   PERF_PRODUCT_COUNT — products per iteration (default 10)
 *   PERF_ITERATIONS    — iteration count (default 100)
 *   PERF_P95_BUDGET_MS — assertion budget (default 80)
 *   PERF_RUN           — set to 'true' to actually run; otherwise the
 *                        suite skips so PR runs aren't blocked by
 *                        perf flake.
 */

const attrCount = Number(process.env['PERF_ATTR_COUNT'] ?? '50');
const productCount = Number(process.env['PERF_PRODUCT_COUNT'] ?? '10');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100');
const p95Budget = Number(process.env['PERF_P95_BUDGET_MS'] ?? '80');
const shouldRun = process.env['PERF_RUN'] === 'true';

const DEFAULT_SET_ID = 'defa0017-0000-4000-8000-000000000000';

describe.skipIf(!shouldRun)('catalog visibleAttributes — p95 latency', () => {
  let h: BackendServerHandle;
  let svc: CatalogQueryService;
  const productSlugs: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new CatalogQueryService(h.em);
    const em = h.em();

    // Seed 50 attributes — mix of value types so every code branch fires.
    const attrs: ProductAttribute[] = [];
    for (let i = 0; i < attrCount; i++) {
      const valueType =
        i % 5 === 0 ? 'enum' : i % 5 === 1 ? 'multiselect' : i % 5 === 2 ? 'number' : i % 5 === 3 ? 'boolean' : 'string';
      const attr = em.create(ProductAttribute, {
        key: `bench_attr_${i}`,
        label: { 'en-US': `Bench ${i}`, 'pl-PL': `Test ${i}` },
        labelDefault: `Bench ${i}`,
        valueType: valueType as ProductAttribute['valueType'],
        isVisibleOnProductPage: true,
      });
      attrs.push(attr);
    }
    await em.persistAndFlush(attrs);

    // Seed option-list rows for select-style attributes.
    for (const a of attrs) {
      if (a.valueType !== 'enum' && a.valueType !== 'multiselect' && a.valueType !== 'select') continue;
      for (const v of ['opt_a', 'opt_b', 'opt_c']) {
        em.create(AttributeOption, {
          attributeId: a.id,
          value: v,
          label: { 'en-US': v.toUpperCase(), 'pl-PL': v.toUpperCase() },
          labelDefault: v.toUpperCase(),
          isDefault: false,
          sortOrder: 0,
        });
      }
    }
    await em.flush();

    // Wire every attribute into the Default set so the position lookup
    // in buildVisibleAttributesProjection has work to do.
    await em.persistAndFlush(
      attrs.map((a, idx) =>
        em.create(AttributeSetAttribute, {
          attributeSetId: DEFAULT_SET_ID,
          productAttributeId: a.id,
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
      em.persist(p);
    }
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it(`p95 of visibleAttributes projection stays under ${p95Budget} ms`, async () => {
    const def = await h.salesChannels.resolver.getSystemDefault();
    if (!def) throw new Error('system-default sales channel missing in test setup');
    const resolvedChannel = {
      id: def.id,
      code: def.code,
      isPublic: def.isPublic,
      defaultCurrency: def.defaultCurrency,
      defaultLanguage: def.defaultLanguage,
    };
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const slug = productSlugs[i % productSlugs.length]!;
      const t0 = performance.now();
      await svc.getProductByIdOrSlug(slug, { resolvedChannel });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    // eslint-disable-next-line no-console
    console.log(`visible-attributes p95 ms = ${p95.toFixed(2)} (samples=${samples.length})`);
    expect(p95).toBeLessThan(p95Budget);
  });
});
