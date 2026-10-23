import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import type { ProductSummary, SearchSuggestItem } from '@endora-commerce/contracts';
import { ProductCard } from '../../components/ProductCard';
import { PriceTag } from '../../components/PriceTag';
import { PdpPriceToggle } from '../../components/pricing/PdpPriceToggle';
import { renderSuggestionPrice } from '../../components/SearchAutocomplete';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Feature 161 (US7, FR-026, SC-007) — "list price / your price".
 *
 * Whether the pair is shown is the pricing engine's decision (`listPriceOf`:
 * `pricing.show_list_price` on and the catalogue price above the price charged),
 * and it reaches the storefront as `resolvedPrice.listPrice` (G14) and the
 * suggestion's `listPrice` (G19). These tests hold the rendering side: vectors
 * D1–D4 of `specs/pricing/worked-examples.md` §10.15 as the backend answers
 * them, on the product page, the listing card (catalogue and search listings
 * render the same card) and the typeahead — and nowhere in the basket or the
 * checkout, which show only the price charged.
 */

const en = tForLocale('en-US');
const pl = tForLocale('pl-PL');

const PLN = (amount: string) => ({ amount, currency: 'PLN' });

/** D1–D4 as the backend answers them for Screws 0200 (E3 / U2.1). */
const VECTORS = {
  // D1 — setting off: Acme's 95.00, no list price.
  D1: { charged: '95.00', listPrice: undefined },
  // D2 — setting on, Acme below the catalogue price: list 100.00, yours 95.00.
  D2: { charged: '95.00', listPrice: PLN('100.00') },
  // D3 — setting on, a surcharge puts Acme above the catalogue price: 110.00 alone.
  D3: { charged: '110.00', listPrice: undefined },
  // D4 — setting on, a guest pays the catalogue price: 100.00 alone.
  D4: { charged: '100.00', listPrice: undefined },
  // D5 — setting on, a sale of 80.00 charged to Acme (owner ruling 2026-10-23): the list price
  // 100.00 struck through and the sale labelled "Your price"; Acme's regular 95.00 is not shown.
  D5: { charged: '95.00', sale: '80.00', listPrice: PLN('100.00') },
  // D6 — setting off, the same sale: unchanged — Acme's 95.00 struck through, the sale beside it.
  D6: { charged: '95.00', sale: '80.00', listPrice: undefined },
} as const;

type Vector = { readonly charged: string; readonly sale?: string; readonly listPrice: ReturnType<typeof PLN> | undefined };

function summary(v: Vector): ProductSummary {
  return {
    id: '00000000-0000-4000-8000-000000000200',
    sku: 'SCREW-0200',
    type: 'simple',
    name: 'Screws 0200',
    slug: 'screws-0200',
    categorySlugs: [],
    primaryAssetUrl: null,
    price: { amount: Number(v.sale ?? v.charged), currency: 'PLN' },
    // Feature 160 (FR-025): a charged sale strikes the buyer's own price on the card.
    ...(v.sale ? { compareAtPrice: { amount: Number(v.charged), currency: 'PLN' } } : {}),
    stockIndicator: null,
    stockLevel: null,
    resolvedPrice: {
      basePrice: PLN(v.charged),
      salePrice: v.sale ? PLN(v.sale) : null,
      displayMode: 'net_only',
      ...(v.listPrice ? { listPrice: v.listPrice } : {}),
    },
  };
}

function suggestion(v: Vector): SearchSuggestItem {
  const { resolvedPrice: _resolved, ...rest } = summary(v);
  return {
    ...rest,
    basePrice: PLN(v.charged),
    salePrice: v.sale ? PLN(v.sale) : null,
    priceDisplayMode: 'net_only',
    ...(v.listPrice ? { listPrice: v.listPrice } : {}),
  };
}

/**
 * The amounts the markup strikes through: an `<s>` or `<del>` element, or an element whose
 * class says it is struck (`…--struck`, `line-through`).
 */
function struck(html: string): string[] {
  const out: string[] = [];
  const pattern = /<(s|del|span|div)\b[^>]*>([^<]*)(?=<)/g;
  for (const match of html.matchAll(pattern)) {
    const [whole, tag, inner] = match;
    const isStruck = tag === 's' || tag === 'del' || /--struck|line-through/.test(whole);
    if (isStruck && /\d/.test(inner ?? '')) out.push(text(inner ?? ''));
  }
  return out;
}

/** The visible text of server-rendered markup, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const surfaces: Record<string, (v: Vector, locale: string) => string> = {
  'the listing card': (v, locale) =>
    renderToString(<ProductCard product={summary(v)} locale={locale} salesChannelCode={undefined} />),
  'the home page card (resolved price)': (v, locale) => {
    const p = summary(v);
    return renderToString(
      <ProductCard product={p} resolved={p.resolvedPrice ?? null} locale={locale} salesChannelCode={undefined} />,
    );
  },
  'the product page': (v, locale) =>
    renderToString(
      <PriceTag price={summary(v).price} resolved={summary(v).resolvedPrice ?? null} locale={locale} variant="pdp" />,
    ),
  'the product page net/gross switch': (v, locale) => {
    const r = summary(v).resolvedPrice!;
    return renderToString(
      <PdpPriceToggle
        basePrice={r.basePrice}
        salePrice={r.salePrice}
        listPrice={r.listPrice ?? null}
        locale={locale}
        listPriceLabel={tForLocale(locale)('product.listPrice')}
        yourPriceLabel={tForLocale(locale)('product.yourPrice')}
      />,
    );
  },
  'the typeahead': (v, locale) =>
    renderToString(
      <>
        {renderSuggestionPrice(suggestion(v), locale, {
          requestQuote: tForLocale(locale)('product.requestQuote'),
          listPrice: tForLocale(locale)('product.listPrice'),
          yourPrice: tForLocale(locale)('product.yourPrice'),
        })}
      </>,
    ),
};

describe('list price / your price on the storefront (FR-026, SC-007)', () => {
  for (const [name, render] of Object.entries(surfaces)) {
    describe(name, () => {
      it('D1 — the setting off: 95.00 only', () => {
        const out = text(render(VECTORS.D1, 'en-US'));
        expect(out).toContain('95.00');
        expect(out).not.toContain('100.00');
        expect(out).not.toContain(en('product.listPrice'));
        expect(out).not.toContain(en('product.yourPrice'));
      });

      it('D2 — the setting on and Acme below the catalogue price: list 100.00, your price 95.00', () => {
        const out = text(render(VECTORS.D2, 'en-US'));
        expect(out).toMatch(new RegExp(`${en('product.listPrice')}\\b.*100\\.00`));
        expect(out).toMatch(new RegExp(`${en('product.yourPrice')}\\b.*95\\.00`));
        // The list price comes first, the price charged after it.
        expect(out.indexOf('100.00')).toBeLessThan(out.indexOf('95.00'));
      });

      it('D2 in Polish', () => {
        const out = text(render(VECTORS.D2, 'pl-PL'));
        expect(out).toContain(pl('product.listPrice'));
        expect(out).toContain(pl('product.yourPrice'));
        expect(out).toContain('100,00');
        expect(out).toContain('95,00');
      });

      it('D3 — a surcharge above the catalogue price: 110.00 only', () => {
        const out = text(render(VECTORS.D3, 'en-US'));
        expect(out).toContain('110.00');
        expect(out).not.toContain(en('product.listPrice'));
        expect(out).not.toContain(en('product.yourPrice'));
      });

      it('D5 — a sale with the list price shown: list 100.00 struck through, the sale as “Your price”, no third number', () => {
        const html = render(VECTORS.D5, 'en-US');
        const out = text(html);
        expect(out).toMatch(new RegExp(`${en('product.listPrice')}\\b.*100\\.00`));
        expect(out).toMatch(new RegExp(`${en('product.yourPrice')}\\b.*80\\.00`));
        expect(out).not.toContain('95.00');
        expect(out.indexOf('100.00')).toBeLessThan(out.indexOf('80.00'));
        expect(struck(html)).toEqual([expect.stringContaining('100.00')]);
      });

      it('D6 — a sale with the setting off: unchanged, the buyer’s own price struck through beside the sale', () => {
        const html = render(VECTORS.D6, 'en-US');
        const out = text(html);
        expect(out).toContain('95.00');
        expect(out).toContain('80.00');
        expect(out).not.toContain(en('product.listPrice'));
        expect(struck(html)).toEqual([expect.stringContaining('95.00')]);
      });

      it('D4 — a guest at the catalogue price: 100.00 only', () => {
        const out = text(render(VECTORS.D4, 'en-US'));
        expect(out).toContain('100.00');
        expect(out).not.toContain(en('product.listPrice'));
        expect(out).not.toContain(en('product.yourPrice'));
      });
    });
  }

  it('labels the pair in English and Polish, and differently', () => {
    expect(en('product.listPrice')).toBe('List price');
    expect(en('product.yourPrice')).toBe('Your price');
    expect(pl('product.listPrice')).toBe('Cena katalogowa');
    expect(pl('product.yourPrice')).toBe('Twoja cena');
  });

  it('the product page keeps the list price when a selected variant is priced as itself', () => {
    const page = readFileSync(resolve(import.meta.dirname, '../../app/(catalog)/p/[slug]/page.tsx'), 'utf8');
    expect(page).toMatch(/listPrice:\s*variantResolved\.listPrice/);
    expect(page).toMatch(/<PdpPriceToggle[\s\S]*?listPrice=\{resolved\.listPrice \?\? null\}/);
  });

  it('the header hands the typeahead its pair labels', () => {
    const header = readFileSync(resolve(import.meta.dirname, '../../components/Header.tsx'), 'utf8');
    expect(header).toContain("listPriceLabel={t('product.listPrice')}");
    expect(header).toContain("yourPriceLabel={t('product.yourPrice')}");
  });

  it('never reaches the basket or the checkout, which show only the price charged', () => {
    const root = resolve(import.meta.dirname, '../..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|mjs)$/.test(entry)) files.push(path);
      }
    };
    walk(join(root, 'app/(commerce)'));
    walk(join(root, 'components'));
    walk(join(root, 'lib'));
    const commerce = files.filter((f) => /(cart|basket|checkout|koszyk)/i.test(f.slice(root.length)));
    expect(commerce.length).toBeGreaterThan(0);
    const offenders = commerce.filter((f) => /listPrice|product\.listPrice|product\.yourPrice/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
