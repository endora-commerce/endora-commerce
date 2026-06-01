import { describe, expect, it } from 'vitest';
import { parseCsvRows } from './import-rows.js';
import {
  QuickOrderImportPipeline,
  type ProductLike,
  type QuickOrderCatalogLookup,
  type VariantBySku,
} from './import-pipeline.js';
import type { VariantLike } from './variant-resolver.js';

/** In-memory catalog stub — no DB. */
function lookupOf(opts: {
  products?: ProductLike[];
  variantsBySku?: VariantBySku[];
  variantsByParent?: Array<VariantLike & { parentProductId: string }>;
}): QuickOrderCatalogLookup {
  const products = opts.products ?? [];
  const variantsBySku = opts.variantsBySku ?? [];
  const variantsByParent = opts.variantsByParent ?? [];
  return {
    findProductsBySku: async (skus) => products.filter((p) => skus.includes(p.sku)),
    findVariantsBySku: async (skus) => variantsBySku.filter((v) => skus.includes(v.sku)),
    findVariantsByParent: async (ids) =>
      variantsByParent.filter((v) => ids.includes(v.parentProductId)),
  };
}

const ACTIVE = (id: string, sku: string): ProductLike => ({ id, sku, status: 'active', deletedAt: null });

describe('QuickOrderImportPipeline', () => {
  it('recognizes valid rows and rejects unknown / archived / bad-qty / missing-sku rows', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        products: [ACTIVE('p1', 'ABC'), { id: 'p2', sku: 'OLD', status: 'archived', deletedAt: null }],
      }),
    );
    const csv = ['sku,quantity', 'ABC,2', 'NOPE,1', 'OLD,1', 'ABC,0', ',3'].join('\n');
    const result = await pipeline.run(parseCsvRows(csv), { maxRows: 100 });

    expect(result.recognized).toHaveLength(1);
    expect(result.recognized[0]).toMatchObject({ productId: 'p1', variantId: null, quantity: 2 });
    const reasons = result.rejected.map((r) => r.reason).sort();
    expect(reasons).toEqual(['product_archived', 'product_not_found', 'quantity_invalid', 'sku_missing']);
  });

  it('rejects every data row as malformed when the header is unusable', async () => {
    const pipeline = new QuickOrderImportPipeline(lookupOf({}));
    const result = await pipeline.run(parseCsvRows('foo,bar\n1,2\n3,4'));
    expect(result.recognized).toHaveLength(0);
    expect(result.rejected.map((r) => r.reason)).toEqual(['malformed_row', 'malformed_row']);
  });

  it('resolves a variant from attribute columns', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        products: [ACTIVE('p1', 'TS')],
        variantsByParent: [
          { id: 'v1', sku: 'TS-RED', parentProductId: 'p1', variantAttributeValues: { color: 'Red' } },
          { id: 'v2', sku: 'TS-BLUE', parentProductId: 'p1', variantAttributeValues: { color: 'Blue' } },
        ],
      }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity,color\nTS,1,Blue'), { maxRows: 100 });
    expect(result.recognized[0]).toMatchObject({
      productId: 'p1',
      variantId: 'v2',
      resolvedVariantSku: 'TS-BLUE',
    });
  });

  it('rejects ambiguous and unresolvable variant rows', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        products: [ACTIVE('p1', 'TS')],
        variantsByParent: [
          { id: 'v1', sku: 'TS-RED-S', parentProductId: 'p1', variantAttributeValues: { color: 'Red', size: 'S' } },
          { id: 'v2', sku: 'TS-RED-L', parentProductId: 'p1', variantAttributeValues: { color: 'Red', size: 'L' } },
        ],
      }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity,color\nTS,1,Red\nTS,1,Green'), {
      maxRows: 100,
    });
    expect(result.recognized).toHaveLength(0);
    expect(result.rejected.map((r) => r.reason).sort()).toEqual([
      'variant_ambiguous',
      'variant_not_resolved',
    ]);
  });

  it('resolves a row whose SKU is itself a variant SKU', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        variantsBySku: [{ id: 'v9', sku: 'TS-RED-L', parentProductId: 'p1' }],
        products: [],
      }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity\nTS-RED-L,4'), { maxRows: 100 });
    expect(result.recognized[0]).toMatchObject({
      productId: 'p1',
      variantId: 'v9',
      resolvedVariantSku: 'TS-RED-L',
      quantity: 4,
    });
  });

  it('merges duplicate SKUs summing quantity', async () => {
    const pipeline = new QuickOrderImportPipeline(lookupOf({ products: [ACTIVE('p1', 'ABC')] }));
    const result = await pipeline.run(parseCsvRows('sku,quantity\nABC,2\nABC,3'), { maxRows: 100 });
    expect(result.recognized).toHaveLength(1);
    expect(result.recognized[0]).toMatchObject({ quantity: 5, mergedFromLines: [3] });
    expect(result.summary.mergedCount).toBe(1);
  });

  it('caps rows and reports overflow as row_limit_exceeded', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({ products: [ACTIVE('p1', 'A'), ACTIVE('p2', 'B'), ACTIVE('p3', 'C')] }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity\nA,1\nB,1\nC,1'), { maxRows: 2 });
    expect(result.summary.truncated).toBe(true);
    expect(result.rejected.map((r) => r.reason)).toEqual(['row_limit_exceeded']);
    expect(result.recognized).toHaveLength(2);
  });
});
