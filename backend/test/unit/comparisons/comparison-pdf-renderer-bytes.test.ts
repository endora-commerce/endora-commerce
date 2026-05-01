import { describe, expect, it } from 'vitest';
import type { ComparisonOwnerView } from '@b2b/contracts';
import { ComparisonPdfRenderer } from '../../../src/modules/comparisons/services/comparison-pdf-renderer.js';
import { AssetByteFetcher } from '../../../src/modules/comparisons/services/asset-byte-fetcher.js';

/**
 * Smoke-test on the byte path: assert the renderer produces a real PDF
 * stream for a tiny fixture. Kept separate from the document-definition
 * tests so a pdfmake regression surfaces here without bloating the
 * faster property-style tests.
 */

class StubAssetFetcher extends AssetByteFetcher {
  override async fetch(): Promise<Buffer> {
    return Buffer.from('stub');
  }
}

const VIEW: ComparisonOwnerView = {
  id: '00000000-0000-4000-8000-000000000111',
  shareToken: 'AAAAAAAAAAAAAAAAAAAAAA',
  displayMode: 'all',
  maxProducts: 4,
  products: [
    {
      id: 'p1',
      sku: 'SKU-1',
      name: { en: 'Widget' },
      slug: 'widget',
      type: 'simple',
      primaryAssetUrl: null,
      price: { amount: 19.99, currency: 'PLN' },
      available: true,
      addedAt: '2026-05-01T12:00:00.000Z',
    },
    {
      id: 'p2',
      sku: 'SKU-2',
      name: { en: 'Other Widget' },
      slug: 'other-widget',
      type: 'simple',
      primaryAssetUrl: null,
      price: { amount: 24.5, currency: 'PLN' },
      available: true,
      addedAt: '2026-05-01T12:00:00.000Z',
    },
  ],
  comparableAttributes: [
    {
      key: 'color',
      label: { en: 'Color' },
      valueType: 'string',
      values: ['red', 'blue'],
      rowClass: 'different',
    },
  ],
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-01T12:00:00.000Z',
};

describe('ComparisonPdfRenderer.render — byte path smoke test', () => {
  it('produces a valid PDF Buffer beginning with %PDF-', async () => {
    const renderer = new ComparisonPdfRenderer();
    const bytes = await renderer.render(VIEW, { fetcher: new StubAssetFetcher() });
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(100);
    // The PDF header magic.
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 15_000);
});
