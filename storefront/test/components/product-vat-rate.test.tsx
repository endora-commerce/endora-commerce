import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { ProductSummary } from '@endora-commerce/contracts';
import { ProductCard } from '../../components/ProductCard';
import { ProductRow } from '../../components/ProductRow';
import { BaseSalePriceBlock } from '../../components/pricing/BaseSalePriceBlock';
import { PdpPriceToggle } from '../../components/pricing/PdpPriceToggle';
import { PriceTag } from '../../components/PriceTag';
import { moduleActionPresence } from '../../lib/module-action-presence';
import { findElement } from './element-tree';

/**
 * Issue #852 — a product's gross price is derived at **that product's** VAT
 * rate, the one the catalogue read answers for the buyer (`vatRate`), and the
 * one the cart and the order apply. The storefront used a flat 23 % on every
 * listing card, list row and product page.
 *
 * Without a rate — an older backend, or a failed resolution — no gross is
 * derived at all: the net is shown, labelled net. A gross at a rate nobody
 * resolved is not a figure.
 */

/** The toggle's `useState`, seeded to the gross side: no DOM here, so no click. */
let toggleMode: 'net' | 'gross' = 'net';
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    // Only the toggle's own state (initial `'net'`) is seeded; every other hook is React's.
    useState: <S,>(initial: S | (() => S)) =>
      initial === 'net' && toggleMode === 'gross' ? [toggleMode, vi.fn()] : actual.useState(initial),
  };
});

const ALL_PRESENT = moduleActionPresence({ isPresent: () => true });

function summary(vatRate?: number | null): ProductSummary {
  return {
    id: '00000000-0000-4000-8000-000000000852',
    sku: 'SKU-852',
    type: 'simple',
    name: 'Reduced-rate widget',
    slug: 'reduced-rate-widget',
    categorySlugs: [],
    primaryAssetUrl: null,
    price: { amount: 100, currency: 'PLN' },
    stockIndicator: null,
    stockLevel: null,
    ...(vatRate !== undefined ? { vatRate } : {}),
  };
}

const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/ /g, ' ');

describe('ProductCard — the product’s own rate', () => {
  it('derives the gross of an 8 % product as net × 1.08', () => {
    const html = plain(
      renderToString(<ProductCard presence={ALL_PRESENT} product={summary(0.08)} locale="pl-PL" salesChannelCode="retail" />),
    );
    expect(html).toContain('brutto 108,00 zł');
    expect(html).not.toContain('123,00');
  });

  it('shows an exempt buyer a gross equal to the net (0 %)', () => {
    const html = plain(
      renderToString(<ProductCard presence={ALL_PRESENT} product={summary(0)} locale="pl-PL" salesChannelCode="retail" />),
    );
    expect(html).toContain('brutto 100,00 zł');
  });

  it('shows the net, labelled net, when the read carries no rate', () => {
    for (const rate of [undefined, null]) {
      const html = plain(
        renderToString(<ProductCard presence={ALL_PRESENT} product={summary(rate)} locale="pl-PL" salesChannelCode="retail" />),
      );
      expect(html).toContain('100,00 zł');
      expect(html).toContain('netto');
      expect(html).not.toContain('brutto');
      expect(html).not.toContain('123,00');
    }
  });

  it('prices the resolved block at the product’s rate', () => {
    const html = plain(
      renderToString(
        <ProductCard
          presence={ALL_PRESENT}
          product={summary(0.08)}
          resolved={{ basePrice: { amount: '100.00', currency: 'PLN' }, salePrice: null, displayMode: 'gross_only' }}
          locale="pl-PL"
          salesChannelCode="retail"
        />,
      ),
    );
    expect(html).toContain('108,00 zł');
    expect(html).not.toContain('123,00');
  });
});

describe('ProductRow — the product’s own rate', () => {
  it('derives the gross of an 8 % product as net × 1.08', () => {
    const html = plain(renderToString(<ProductRow presence={ALL_PRESENT} product={summary(0.08)} locale="pl-PL" />));
    expect(html).toContain('brutto 108,00 zł');
    expect(html).not.toContain('123,00');
  });

  it('shows the net, labelled net, when the read carries no rate', () => {
    const html = plain(renderToString(<ProductRow presence={ALL_PRESENT} product={summary()} locale="pl-PL" />));
    expect(html).toContain('100,00 zł');
    expect(html).toContain('netto');
    expect(html).not.toContain('brutto');
  });
});

describe('the deprecated `vatRate` prop (issue #852)', () => {
  it('still overrides the product’s rate on the card', () => {
    const html = plain(
      renderToString(
        <ProductCard presence={ALL_PRESENT} product={summary(0.23)} vatRate={0.05} locale="pl-PL" salesChannelCode="retail" />,
      ),
    );
    expect(html).toContain('brutto 105,00 zł');
    expect(html).not.toContain('123,00');
  });

  it('still overrides the product’s rate on the row', () => {
    const html = plain(renderToString(<ProductRow presence={ALL_PRESENT} product={summary()} vatRate={0.05} locale="pl-PL" />));
    expect(html).toContain('brutto 105,00 zł');
  });
});

describe('BaseSalePriceBlock — no flat default', () => {
  it('derives the gross at the rate it is given', () => {
    const html = plain(
      renderToString(
        <BaseSalePriceBlock basePrice={{ amount: '100.00', currency: 'PLN' }} displayMode="gross_only" vatRate={0.08} locale="pl-PL" />,
      ),
    );
    expect(html).toContain('108,00 zł');
    expect(html).toContain('brutto');
  });

  it('shows the net, labelled net, under gross_only when it is given no rate', () => {
    const html = plain(
      renderToString(<BaseSalePriceBlock basePrice={{ amount: '100.00', currency: 'PLN' }} displayMode="gross_only" locale="pl-PL" />),
    );
    expect(html).toContain('100,00 zł');
    expect(html).toContain('netto');
    expect(html).not.toContain('brutto');
    expect(html).not.toContain('123,00');
  });

  it('shows the net alone under both when it is given no rate', () => {
    const html = plain(
      renderToString(
        <BaseSalePriceBlock basePrice={{ amount: '100.00', currency: 'PLN' }} displayMode="both" vatRate={null} locale="pl-PL" />,
      ),
    );
    expect(html).toContain('netto');
    expect(html).not.toContain('brutto');
  });
});

describe('PriceTag — the product page price', () => {
  it('derives the gross at the rate it is given', () => {
    const html = plain(
      renderToString(
        <PriceTag
          resolved={{ basePrice: { amount: '100.00', currency: 'PLN' }, salePrice: null, displayMode: 'gross_only' }}
          vatRate={0.08}
          locale="pl-PL"
          quoteRequests
        />,
      ),
    );
    expect(html).toContain('108,00 zł');
  });
});

describe('PdpPriceToggle — the gross side', () => {
  it('derives the gross of an 8 % product as net × 1.08', () => {
    toggleMode = 'gross';
    const tree = PdpPriceToggle({
      basePrice: { amount: '100.00', currency: 'PLN' },
      locale: 'pl-PL',
      vatRate: 0.08,
    });
    const block = findElement(tree, (el) => el.type === BaseSalePriceBlock);
    const html = plain(renderToString(block as ReactElement));
    expect(html).toContain('108,00 zł');
    expect(html).not.toContain('123,00');
    toggleMode = 'net';
  });
});
