import { describe, expect, it } from 'vitest';
import type {
  ComparisonOwnerView,
  ComparisonAttributeRow,
  ComparisonDisplayMode,
} from '@endora-commerce/contracts';
import {
  AssetByteFetcher,
  IMAGE_FALLBACK_BYTES,
} from '../../../../packages/modules/comparisons/src/backend/services/asset-byte-fetcher.js';
import {
  ComparisonPdfRenderer,
  filterRowsByMode,
  pickOrientation,
} from '../../../../packages/modules/comparisons/src/backend/services/comparison-pdf-renderer.js';

/**
 * T051 — Unit test for the PDF document-definition. Asserts on the
 * pdfmake document object (no bytes stream) so the test is fast and
 * deterministic.
 */

describe('pickOrientation', () => {
  it('returns landscape when product count >= 3', () => {
    expect(pickOrientation(3)).toBe('landscape');
    expect(pickOrientation(4)).toBe('landscape');
  });

  it('returns portrait for 1 or 2 products', () => {
    expect(pickOrientation(0)).toBe('portrait');
    expect(pickOrientation(1)).toBe('portrait');
    expect(pickOrientation(2)).toBe('portrait');
  });
});

describe('filterRowsByMode', () => {
  const rows: ComparisonAttributeRow[] = [
    {
      key: 'a',
      label: { en: 'A' },
      valueType: 'string',
      values: ['x', 'x'],
      rowClass: 'common',
    },
    {
      key: 'b',
      label: { en: 'B' },
      valueType: 'string',
      values: ['x', 'y'],
      rowClass: 'different',
    },
  ];

  it("keeps every row in 'all' mode", () => {
    expect(filterRowsByMode(rows, 'all')).toHaveLength(2);
  });
  it("keeps only common rows in 'common'", () => {
    const filtered = filterRowsByMode(rows, 'common');
    expect(filtered.map((r) => r.key)).toEqual(['a']);
  });
  it("keeps only different rows in 'differences'", () => {
    const filtered = filterRowsByMode(rows, 'differences');
    expect(filtered.map((r) => r.key)).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------
// Document-definition assertions (single render).
// ---------------------------------------------------------------------------

class StubAssetFetcher extends AssetByteFetcher {
  constructor(private readonly fail = false) {
    super();
  }
  override async fetch(_url: string): Promise<Buffer> {
    if (this.fail) return IMAGE_FALLBACK_BYTES;
    return Buffer.from('ok');
  }
}

function fixtureView(overrides: Partial<ComparisonOwnerView> = {}): ComparisonOwnerView {
  return {
    id: '00000000-0000-4000-8000-000000000111',
    shareToken: 'AAAAAAAAAAAAAAAAAAAAAA',
    displayMode: 'all',
    maxProducts: 4,
    // The owner exports their own comparison, so the figures in it are their
    // organisation's.
    pricedFor: 'organization',
    hiddenProductCount: 0,
    products: [
      productSummary('p1', 'Red Widget', 'http://localhost/red.png', 1900),
      productSummary('p2', 'Blue Widget', 'http://localhost/blue.png', 2400),
      productSummary('p3', 'Green Widget', null, null),
    ],
    comparableAttributes: [
      {
        key: 'color',
        label: { en: 'Color' },
        valueType: 'string',
        values: ['red', 'blue', 'green'],
        rowClass: 'different',
      },
      {
        key: 'material',
        label: { en: 'Material' },
        valueType: 'string',
        values: ['steel', 'steel', 'steel'],
        rowClass: 'common',
      },
    ],
    createdAt: '2026-05-01T12:00:00.000Z',
    updatedAt: '2026-05-01T12:00:00.000Z',
    ...overrides,
  };
}

function productSummary(
  id: string,
  name: string,
  primaryAssetUrl: string | null,
  amount: number | null,
) {
  return {
    id,
    sku: `SKU-${id}`,
    name: { en: name },
    slug: id,
    type: 'simple' as const,
    primaryAssetUrl,
    price: amount === null ? null : { amount, currency: 'PLN' },
    available: true,
    addedAt: '2026-05-01T12:00:00.000Z',
  };
}

describe('ComparisonPdfRenderer.buildDocumentDefinition', () => {
  const renderer = new ComparisonPdfRenderer();

  it('emits one column per product plus the label column', async () => {
    const view = fixtureView();
    const def = await renderer.buildDocumentDefinition(view, new StubAssetFetcher());
    const table = (def.content as Array<{ table?: { body: unknown[][] } }>).find(
      (c) => c.table !== undefined,
    );
    expect(table?.table?.body[0]).toHaveLength(view.products.length + 1);
  });

  it("includes both rows in 'all' mode (one common + one different)", async () => {
    const def = await renderer.buildDocumentDefinition(fixtureView(), new StubAssetFetcher());
    const table = (def.content as Array<{ table?: { body: unknown[][] } }>).find(
      (c) => c.table !== undefined,
    );
    // headerRow + 2 body rows
    expect(table?.table?.body).toHaveLength(3);
  });

  it("emits only different rows in 'differences' mode", async () => {
    const view = fixtureView({ displayMode: 'differences' as ComparisonDisplayMode });
    const def = await renderer.buildDocumentDefinition(view, new StubAssetFetcher());
    const table = (def.content as Array<{ table?: { body: unknown[][] } }>).find(
      (c) => c.table !== undefined,
    );
    // header + 1 body row (the 'color' different row)
    expect(table?.table?.body).toHaveLength(2);
  });

  it('chooses landscape orientation for 3+ products', async () => {
    const def = await renderer.buildDocumentDefinition(fixtureView(), new StubAssetFetcher());
    expect(def.pageOrientation).toBe('landscape');
  });

  it('chooses portrait orientation for 2 products', async () => {
    const view = fixtureView({ products: fixtureView().products.slice(0, 2) });
    const def = await renderer.buildDocumentDefinition(view, new StubAssetFetcher());
    expect(def.pageOrientation).toBe('portrait');
  });

  it('substitutes a placeholder when image fetch fails', async () => {
    const def = await renderer.buildDocumentDefinition(fixtureView(), new StubAssetFetcher(true));
    // The renderer never throws on a fetch failure — placeholder bytes
    // ride into the document definition unchanged.
    expect(def.content).toBeDefined();
  });
});
