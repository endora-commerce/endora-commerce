import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { ProductBuyActions } from '../../components/ProductBuyActions';
import { CompareAddToCartButton } from '../../components/CompareAddToCartButton';
import { AddToRfqButton } from '../../components/rfq/AddToRfqButton';
import type { AddToCartResult } from '../../lib/cartAddState';
import {
  compareAddButtonLabel,
  compareAddFailure,
  productCardActionLabels,
  quoteAddButtonLabel,
} from '../../lib/buyActionLabels';

/**
 * Feature 155, U4 (owner ruling S8 A) — the buy controls this feature changed speak the page's
 * language. Each carried Polish (or English) literals beside catalogue copy, so an English page
 * read "Jednostka", "Ilość" and "Dodaj do zapytania" under an English minimum statement.
 *
 * The suite renders on the server only (issue #355): the idle state is asserted on the markup,
 * the transient states (added, adding, failed) through the pure helpers the components call,
 * and each component is held to calling them.
 */
const noop = (): AddToCartResult => ({ status: 'idle' });

const UNITS = [{ id: 'u1', name: 'Box', baseQuantity: 12, isDefault: false }];

function renderBuy(locale: string): string {
  return renderToString(
    <ProductBuyActions
      productId="p1"
      productSlug="p-slug"
      productName="Product 1"
      showCart
      showQuote
      packagingUnits={UNITS}
      locale={locale}
      addToCartAction={noop}
      addToCartLabel="Add to cart"
    />,
  );
}

const source = (path: string): string => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');

describe('ProductBuyActions — page language', () => {
  it.each([
    ['en-US', 'Packaging unit', 'Quantity', 'Add to quote', 'Single piece', 'pcs'],
    ['pl-PL', 'Jednostka', 'Ilość', 'Dodaj do zapytania', 'Pojedyncza sztuka', 'szt.'],
  ])('%s: unit selector, quantity label, quote button and the unit words', (locale, unit, qty, quote, single, pcs) => {
    const html = renderBuy(locale);
    expect(html).toContain(`aria-label="${unit}"`);
    expect(html).toMatch(new RegExp(`<label[^>]*for="buy-qty-p1"[^>]*>${qty}</label>`));
    expect(html).toContain(`>${quote}</button>`);
    expect(html).toContain(`>${single}</option>`);
    expect(html.replaceAll('<!-- -->', '')).toContain(`Box (12 ${pcs})`);
  });

  it('carries no Polish literal an English page could show', () => {
    const html = renderBuy('en-US');
    for (const literal of ['Jednostka', 'Ilość', 'Dodaj do zapytania', 'szt.']) {
      expect(html).not.toContain(literal);
    }
  });

  it('hands the cart confirmation popup its copy in the page language', () => {
    const buy = source('components/ProductBuyActions.tsx');
    expect(buy).toMatch(/<CartAddedPopup[\s\S]*addedLabel=\{t\('product\.cartPopup\.added'\)\}/);
    expect(buy).toMatch(/goToCartLabel=\{t\('product\.cartPopup\.goToCart'\)\}/);
    expect(buy).toMatch(/continueLabel=\{t\('product\.cartPopup\.continue'\)\}/);
    expect(buy).toMatch(/closeLabel=\{t\('product\.cartPopup\.close'\)\}/);
  });

  it('flashes the quote confirmation through quoteAddButtonLabel', () => {
    expect(source('components/ProductBuyActions.tsx')).toContain('quoteAddButtonLabel(quoteAdded, locale)');
  });
});

describe('quoteAddButtonLabel', () => {
  it('names the action, then confirms it (EN and PL)', () => {
    expect(quoteAddButtonLabel(false, 'en-US')).toBe('Add to quote');
    expect(quoteAddButtonLabel(true, 'en-US')).toBe('Added ✓');
    expect(quoteAddButtonLabel(false, 'pl-PL')).toBe('Dodaj do zapytania');
    expect(quoteAddButtonLabel(true, 'pl-PL')).toBe('Dodano ✓');
  });
});

describe('AddToRfqButton — page language', () => {
  it.each([
    ['en-US', 'Quantity', 'Add to quote'],
    ['pl-PL', 'Ilość', 'Dodaj do zapytania'],
  ])('%s: quantity label and button from the catalogue', (locale, qty, add) => {
    const html = renderToString(
      <AddToRfqButton productId="p1" productSlug="s" productName="P" withQuantity locale={locale} />,
    );
    expect(html).toMatch(new RegExp(`<label[^>]*>${qty}</label>`));
    expect(html).toContain(`>${add}</button>`);
  });

  it('keeps Polish as the default when no locale is passed', () => {
    const html = renderToString(<AddToRfqButton productId="p1" productSlug="s" productName="P" withQuantity />);
    expect(html).toContain('>Dodaj do zapytania</button>');
  });

  it('no longer carries an inline pl/en map', () => {
    const rfq = source('components/rfq/AddToRfqButton.tsx');
    expect(rfq).not.toContain("'Dodaj do zapytania'");
    expect(rfq).not.toContain("'Add to quote'");
    expect(rfq).toContain('quoteAddButtonLabel(added, locale)');
  });
});

describe('CompareAddToCartButton — page language', () => {
  it.each([
    ['en-US', 'Add to cart'],
    ['pl-PL', 'Dodaj do koszyka'],
  ])('%s: the idle button', (locale, label) => {
    const html = renderToString(<CompareAddToCartButton productId="p2" locale={locale} />);
    expect(html).toContain(`>${label}</button>`);
  });

  it('words the busy and done states through compareAddButtonLabel', () => {
    expect(compareAddButtonLabel('idle', 'en-US')).toBe('Add to cart');
    expect(compareAddButtonLabel('busy', 'en-US')).toBe('Adding…');
    expect(compareAddButtonLabel('done', 'en-US')).toBe('✓ Added');
    expect(compareAddButtonLabel('busy', 'pl-PL')).toBe('Dodawanie…');
    expect(compareAddButtonLabel('done', 'pl-PL')).toBe('✓ Dodano');
  });

  it("keeps the backend's sentence, else words the failure in the page language", () => {
    expect(compareAddFailure('Only 2 left in stock.', 'pl-PL')).toBe('Only 2 left in stock.');
    expect(compareAddFailure(null, 'en-US')).toBe('Could not add the product to the cart.');
    expect(compareAddFailure(undefined, 'pl-PL')).toBe('Nie udało się dodać produktu do koszyka.');
  });

  it('calls both helpers and carries none of the old literals', () => {
    const compare = source('components/CompareAddToCartButton.tsx');
    expect(compare).toContain('compareAddButtonLabel(');
    expect(compare).toContain('compareAddFailure(');
    for (const literal of ['Dodaj do koszyka', '✓ Dodano', 'Dodawanie…', 'Could not add to cart.']) {
      expect(compare).not.toContain(literal);
    }
  });
});

describe('ProductCardActions — page language', () => {
  const idle = {
    cartState: 'idle',
    listState: 'idle',
    quoteState: 'idle',
    inList: false,
    addToCartLabel: null,
  } as const;

  it('words every tooltip and accessible name in English', () => {
    expect(productCardActionLabels({ ...idle, locale: 'en-US' })).toEqual({
      list: 'Add to shopping list',
      quote: 'Add to quote',
      quoteName: 'Add to quote',
      cart: 'Add to cart',
      cartName: 'Add to cart',
    });
    const en = (over: Partial<Parameters<typeof productCardActionLabels>[0]>) =>
      productCardActionLabels({ ...idle, locale: 'en-US', ...over });
    expect(en({ inList: true }).list).toBe('Remove from shopping list');
    expect(en({ listState: 'error' }).list).toBe('Could not change the list');
    expect(en({ cartState: 'done' }).cart).toBe('Added to cart');
    expect(en({ cartState: 'error' }).cart).toBe('Could not add');
    expect(en({ quoteState: 'done' }).quote).toBe('Added to quote');
  });

  it('words every tooltip and accessible name in Polish', () => {
    const pl = (over: Partial<Parameters<typeof productCardActionLabels>[0]>) =>
      productCardActionLabels({ ...idle, locale: 'pl-PL', ...over });
    expect(pl({})).toEqual({
      list: 'Dodaj do listy zakupów',
      quote: 'Dodaj do zapytania',
      quoteName: 'Dodaj do zapytania',
      cart: 'Dodaj do koszyka',
      cartName: 'Dodaj do koszyka',
    });
    expect(pl({ inList: true }).list).toBe('Usuń z listy zakupów');
    expect(pl({ listState: 'error' }).list).toBe('Nie udało się zmienić listy');
    expect(pl({ cartState: 'done' }).cart).toBe('Dodano do koszyka');
    expect(pl({ cartState: 'error' }).cart).toBe('Nie udało się dodać');
    expect(pl({ quoteState: 'done' }).quote).toBe('Dodano do zapytania');
  });

  it("keeps the minimum label as the cart's name and idle tooltip", () => {
    const labels = productCardActionLabels({ ...idle, locale: 'en-US', addToCartLabel: 'Add 10 pcs to cart' });
    expect(labels.cart).toBe('Add 10 pcs to cart');
    expect(labels.cartName).toBe('Add 10 pcs to cart');
  });

  it('is what the card renders, in the locale the server card hands it', () => {
    const actions = source('components/ProductCardActions.tsx');
    expect(actions).toContain('productCardActionLabels({');
    for (const literal of [
      'Dodaj do koszyka',
      'Dodano do koszyka',
      'Nie udało się dodać',
      'Dodaj do zapytania',
      'Dodano do zapytania',
      'Dodaj do listy zakupów',
      'Usuń z listy zakupów',
      'Nie udało się zmienić listy',
    ]) {
      expect(actions).not.toContain(literal);
    }
    expect(source('components/ProductCard.tsx')).toMatch(/<ProductCardActions[\s\S]*?locale=\{locale\}/);
  });
});
