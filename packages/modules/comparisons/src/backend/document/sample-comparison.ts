import type { ComparisonDocumentData } from '@endora-commerce/contracts';

/**
 * The fictitious comparison the editor's canvas and *Preview PDF* draw
 * (`contracts/comparison-document.md` §1): three products — one unavailable,
 * one missing a value — common and differing rows, one product hidden from
 * the viewer, prices for an organisation, and a placeholder share address.
 * Names carry English and Polish so a preview in either language reads right.
 */
export function sampleComparisonData(_language: string): ComparisonDocumentData {
  const at = '2026-10-17T09:00:00.000Z';
  const product = (n: number, over: Partial<ComparisonDocumentData['view']['products'][number]> = {}) => ({
    id: `00000000-0000-4000-8000-00000000c0${n}0`,
    sku: `SAMPLE-${n}00`,
    name: `Sample product ${n}`,
    slug: `sample-product-${n}`,
    type: 'simple' as const,
    primaryAssetUrl: null,
    price: { amount: 100 * n + 0.99, currency: 'PLN' },
    available: true,
    addedAt: at,
    ...over,
  });
  return {
    view: {
      id: '00000000-0000-4000-8000-00000000c000',
      shareToken: 'sample0token',
      displayMode: 'all',
      maxProducts: 4,
      products: [product(1), product(2, { available: false }), product(3, { price: null })],
      comparableAttributes: [
        {
          key: 'color',
          label: { 'en-US': 'Colour', 'pl-PL': 'Kolor' },
          valueType: 'string',
          values: ['Black', 'Black', 'Black'],
          rowClass: 'common',
        },
        {
          key: 'weight',
          label: { 'en-US': 'Weight', 'pl-PL': 'Waga' },
          valueType: 'string',
          values: ['1.2 kg', '0.9 kg', null],
          rowClass: 'different',
        },
        {
          key: 'warranty',
          label: { 'en-US': 'Warranty', 'pl-PL': 'Gwarancja' },
          valueType: 'string',
          values: ['24 months', '12 months', '36 months'],
          rowClass: 'different',
        },
      ],
      pricedFor: 'organization',
      hiddenProductCount: 1,
      createdAt: at,
      updatedAt: at,
    },
    channelName: 'Sample store',
    customerName: 'Anna Example',
    organizationName: 'Example Ltd.',
    shareUrl: 'https://shop.example.com/compare/share/sample0token',
    hideEmptyRows: false,
    generatedAt: at,
  };
}
