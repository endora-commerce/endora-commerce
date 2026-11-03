import { describe, expect, it } from 'vitest';
import type { CatalogProductRecord } from '@endora-commerce/contracts';
import { productMetaOf } from './cart-line-meta.js';

/**
 * Feature 163 (owner decision S1 = A) — a basket line whose product is no longer
 * available at the basket's (channel, language) keeps its name and SKU, so the
 * buyer can tell which line it is, and loses its slug: the storefront renders no
 * link to a product page that answers 404 here. The line reads `unavailable`
 * from the minimum evaluation, as before.
 */
const rec = (id: string, sku: string, slug: string) =>
  ({ id, sku, slug, name: `Name ${sku}` }) as unknown as CatalogProductRecord;

describe('productMetaOf', () => {
  const records = [rec('p-on', 'ON-1', 'on-1'), rec('p-off', 'OFF-1', 'off-1')];

  it('keeps the slug of an available product', () => {
    const meta = productMetaOf(records, 'en', new Set(['p-on']));
    expect(meta.get('p-on')).toEqual({ name: 'Name ON-1', slug: 'on-1', sku: 'ON-1' });
  });

  it('drops the slug of an unavailable product and keeps its name and SKU', () => {
    const meta = productMetaOf(records, 'en', new Set(['p-on']), new Map([['p-off', 'Effective off']]));
    expect(meta.get('p-off')).toEqual({ name: 'Effective off', slug: null, sku: 'OFF-1' });
  });

  it('T113a: links an available product by its effective key at the basket’s (channel, language)', () => {
    const meta = productMetaOf(records, 'en', new Set(['p-on']), new Map(), new Map([['p-on', 'on-key-de'], ['p-off', 'off-key-de']]));
    expect(meta.get('p-on')?.slug).toBe('on-key-de');
    // Unavailable: no link, whatever its key (S1 = A).
    expect(meta.get('p-off')?.slug).toBeNull();
  });
});
