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
  | 'product.variants.heading'
  | 'product.variants.sku'
  | 'product.variants.priceOverride'
  | 'product.variants.stockLevel'
  | 'product.variants.outOfStock'
  | 'product.variants.selectThisVariant'
  | 'product.links.related'
  | 'product.links.upSell'
  | 'product.links.crossSell'
  | 'product.links.seeAll'
  | 'product.bundle.addToCart'
  | 'product.bundle.requiredSlot'
  | 'product.grouped.addBundleToCart'
  | 'product.virtual.buyAndDownload'
  | 'product.virtual.digitalDelivery'
  | 'search.placeholder'
  | 'search.unavailable'
  | 'search.seeAllResults'
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
    'product.variants.heading': 'Variants',
    'product.variants.sku': 'SKU',
    'product.variants.priceOverride': 'Price',
    'product.variants.stockLevel': 'In stock',
    'product.variants.outOfStock': 'Out of stock',
    'product.variants.selectThisVariant': 'Currently selected',
    'product.links.related': 'Related products',
    'product.links.upSell': 'You might also like',
    'product.links.crossSell': 'You may also need',
    'product.links.seeAll': 'See all',
    'product.bundle.addToCart': 'Add bundle to cart',
    'product.bundle.requiredSlot': 'required',
    'product.grouped.addBundleToCart': 'Add bundle to cart',
    'product.virtual.buyAndDownload': 'Buy and download',
    'product.virtual.digitalDelivery': 'Digital delivery — instant access after purchase',
    'search.placeholder': 'Search products…',
    'search.unavailable': 'Search is temporarily unavailable.',
    'search.seeAllResults': 'See all results',
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
    'product.variants.heading': 'Warianty',
    'product.variants.sku': 'Kod',
    'product.variants.priceOverride': 'Cena',
    'product.variants.stockLevel': 'Dostepne',
    'product.variants.outOfStock': 'Niedostepny',
    'product.variants.selectThisVariant': 'Wybrany',
    'product.links.related': 'Powiazane produkty',
    'product.links.upSell': 'Moze Cie zainteresowac',
    'product.links.crossSell': 'Dokup takze',
    'product.links.seeAll': 'Zobacz wszystkie',
    'product.bundle.addToCart': 'Dodaj zestaw do koszyka',
    'product.bundle.requiredSlot': 'wymagane',
    'product.grouped.addBundleToCart': 'Dodaj zestaw do koszyka',
    'product.virtual.buyAndDownload': 'Kup i pobierz',
    'product.virtual.digitalDelivery': 'Dostawa cyfrowa — dostep natychmiast po zakupie',
    'search.placeholder': 'Szukaj produktow...',
    'search.unavailable': 'Wyszukiwarka chwilowo niedostepna.',
    'search.seeAllResults': 'Pokaz wszystkie wyniki',
    'common.searchAction': 'Szukaj',
    'pagination.next': 'Nastepna strona',
  },
};

export function tForLocale(locale: string): (key: MessageKey) => string {
  const dictionary = MESSAGES[locale] ?? MESSAGES['en-US']!;
  return (key) => dictionary[key] ?? MESSAGES['en-US']![key] ?? key;
}
