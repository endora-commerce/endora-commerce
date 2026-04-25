/**
 * Tiny in-tree message catalogue. The reference theme uses this for
 * navigation labels, button captions, and other chrome that is *not*
 * editorial content (CMS pages cover editorial).
 *
 * Themes typically override `components/*` rather than message keys; if
 * a theme wants its own copy, it can replace this file or extend the
 * record.
 */

export type SupportedLocale = string;

type MessageKey =
  | 'nav.home'
  | 'nav.catalog'
  | 'nav.search'
  | 'nav.account'
  | 'catalog.heading'
  | 'catalog.filters'
  | 'catalog.empty'
  | 'catalog.loadMore'
  | 'product.outOfStock'
  | 'product.requestQuote'
  | 'product.addToCart'
  | 'product.inStock'
  | 'search.placeholder'
  | 'common.searchAction'
  | 'pagination.next';

const MESSAGES: Record<string, Record<MessageKey, string>> = {
  'en-US': {
    'nav.home': 'Home',
    'nav.catalog': 'Catalog',
    'nav.search': 'Search',
    'nav.account': 'Account',
    'catalog.heading': 'Catalog',
    'catalog.filters': 'Filters',
    'catalog.empty': 'No products match your filters.',
    'catalog.loadMore': 'Load more',
    'product.outOfStock': 'Out of stock',
    'product.requestQuote': 'Request a quote',
    'product.addToCart': 'Add to cart',
    'product.inStock': 'In stock',
    'search.placeholder': 'Search products…',
    'common.searchAction': 'Search',
    'pagination.next': 'Next page',
  },
  'pl-PL': {
    'nav.home': 'Strona glowna',
    'nav.catalog': 'Katalog',
    'nav.search': 'Wyszukiwanie',
    'nav.account': 'Konto',
    'catalog.heading': 'Katalog',
    'catalog.filters': 'Filtry',
    'catalog.empty': 'Zaden produkt nie pasuje do filtrow.',
    'catalog.loadMore': 'Pokaz wiecej',
    'product.outOfStock': 'Brak w magazynie',
    'product.requestQuote': 'Zapytaj o oferte',
    'product.addToCart': 'Dodaj do koszyka',
    'product.inStock': 'Dostepny',
    'search.placeholder': 'Szukaj produktow...',
    'common.searchAction': 'Szukaj',
    'pagination.next': 'Nastepna strona',
  },
};

export function tForLocale(locale: string): (key: MessageKey) => string {
  const dictionary = MESSAGES[locale] ?? MESSAGES['en-US']!;
  return (key) => dictionary[key] ?? MESSAGES['en-US']![key] ?? key;
}
