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
  | 'nav.login'
  | 'catalog.heading'
  | 'catalog.filters'
  | 'catalog.empty'
  | 'catalog.loadMore'
  | 'product.outOfStock'
  | 'product.requestQuote'
  | 'product.addToCart'
  | 'product.details'
  | 'product.inStock'
  | 'product.stockBand.high'
  | 'product.stockBand.medium'
  | 'product.stockBand.low'
  | 'product.notify.cta'
  | 'product.notify.dialogTitle'
  | 'product.notify.emailLabel'
  | 'product.notify.submit'
  | 'product.notify.submitting'
  | 'product.notify.success'
  | 'product.notify.errorGeneric'
  | 'product.notify.cancel'
  | 'product.backorder.hint'
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
  | 'pagination.next'
  | 'product.attributes.tabTitle'
  | 'product.attributes.boolean.yes'
  | 'product.attributes.boolean.no'
  // Feature 036 — Checkout (Kasa). Localized user-facing copy for the
  // Success / Failure pages and the Address / Coupon sections.
  | 'checkout.success.title'
  | 'checkout.success.orderNumberPrefix'
  | 'checkout.success.confirmationSent'
  | 'checkout.success.bankTransferHint'
  | 'checkout.success.pickupHint'
  | 'checkout.success.creditLimitHint'
  | 'checkout.success.viewOrder'
  | 'checkout.success.allOrders'
  | 'checkout.success.continueShopping'
  | 'checkout.failure.title'
  | 'checkout.failure.generic'
  | 'checkout.failure.cartKept'
  | 'checkout.failure.tryAgain'
  | 'checkout.failure.backToCart'
  | 'checkout.coupon.label'
  | 'checkout.coupon.apply'
  | 'checkout.coupon.appliedPrefix'
  | 'checkout.coupon.appliedSuffix'
  | 'checkout.coupon.remove'
  | 'checkout.address.shippingTitle'
  | 'checkout.address.billingTitle'
  | 'checkout.address.useSaved'
  | 'checkout.address.enterNew'
  | 'checkout.address.sameAsShipping'
  | 'checkout.address.recipientName'
  | 'checkout.address.street'
  | 'checkout.address.postalCode'
  | 'checkout.address.city'
  | 'checkout.address.country'
  | 'checkout.address.phone';

const MESSAGES: Record<string, Record<MessageKey, string>> = {
  'en-US': {
    'nav.home': 'Home',
    'nav.catalog': 'Catalog',
    'nav.search': 'Search',
    'nav.account': 'Account',
    'nav.login': 'Sign in',
    'catalog.heading': 'Catalog',
    'catalog.filters': 'Filters',
    'catalog.empty': 'No products match your filters.',
    'catalog.loadMore': 'Load more',
    'product.outOfStock': 'Out of stock',
    'product.requestQuote': 'Request a quote',
    'product.addToCart': 'Add to cart',
    'product.details': 'Details',
    'product.inStock': 'In stock',
    'product.stockBand.high': 'In stock — plenty',
    'product.stockBand.medium': 'In stock',
    'product.stockBand.low': 'Low stock',
    'product.notify.cta': 'Notify when available',
    'product.notify.dialogTitle': 'Get notified when this product is back in stock',
    'product.notify.emailLabel': 'Email address',
    'product.notify.submit': 'Notify me',
    'product.notify.submitting': 'Subscribing…',
    'product.notify.success': 'You will get an email as soon as this product is back in stock.',
    'product.notify.errorGeneric': 'Could not subscribe — please try again.',
    'product.notify.cancel': 'Cancel',
    'product.backorder.hint': 'Currently out of stock — backorder available, dispatched as soon as the next batch arrives.',
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
    'product.attributes.tabTitle': 'Specifications',
    'product.attributes.boolean.yes': 'Yes',
    'product.attributes.boolean.no': 'No',
    // Feature 036 — Checkout (Kasa).
    'checkout.success.title': 'Thank you — your order is placed',
    'checkout.success.orderNumberPrefix': 'Your order number is ',
    'checkout.success.confirmationSent': 'We have received it and sent a confirmation e-mail.',
    'checkout.success.bankTransferHint':
      'Please pay by bank transfer using the reference on the proforma invoice we have e-mailed you. We will update the order once the payment clears.',
    'checkout.success.pickupHint':
      'You will pay on collection / delivery. No further action is needed now.',
    'checkout.success.creditLimitHint':
      'This order draws on your organization’s credit limit and is now being processed.',
    'checkout.success.viewOrder': 'View order details',
    'checkout.success.allOrders': 'All orders',
    'checkout.success.continueShopping': 'Continue shopping',
    'checkout.failure.title': 'We could not complete your order',
    'checkout.failure.generic':
      'Something went wrong while placing your order. Your cart has been kept, so you can try again.',
    'checkout.failure.cartKept':
      'Your cart is unchanged — nothing was charged and no order was created.',
    'checkout.failure.tryAgain': 'Try again',
    'checkout.failure.backToCart': 'Back to cart',
    'checkout.coupon.label': 'Coupon code (optional)',
    'checkout.coupon.apply': 'Apply',
    'checkout.coupon.appliedPrefix': 'Coupon ',
    'checkout.coupon.appliedSuffix': 'applied — ',
    'checkout.coupon.remove': 'Remove',
    'checkout.address.shippingTitle': 'Shipping address',
    'checkout.address.billingTitle': 'Billing address',
    'checkout.address.useSaved': 'Use a saved address',
    'checkout.address.enterNew': 'Enter a new address',
    'checkout.address.sameAsShipping': 'Billing address same as shipping',
    'checkout.address.recipientName': 'Recipient name',
    'checkout.address.street': 'Street and number',
    'checkout.address.postalCode': 'Postal code',
    'checkout.address.city': 'City',
    'checkout.address.country': 'Country (e.g. PL)',
    'checkout.address.phone': 'Phone (optional)',
  },
  'pl-PL': {
    'nav.home': 'Strona glowna',
    'nav.catalog': 'Katalog',
    'nav.search': 'Wyszukiwanie',
    'nav.account': 'Konto',
    'nav.login': 'Zaloguj się',
    'catalog.heading': 'Katalog',
    'catalog.filters': 'Filtry',
    'catalog.empty': 'Zaden produkt nie pasuje do filtrow.',
    'catalog.loadMore': 'Pokaz wiecej',
    'product.outOfStock': 'Brak w magazynie',
    'product.requestQuote': 'Zapytaj o oferte',
    'product.addToCart': 'Dodaj do koszyka',
    'product.details': 'Szczegóły',
    'product.inStock': 'Dostepny',
    'product.stockBand.high': 'Duzo w magazynie',
    'product.stockBand.medium': 'Sredni stan',
    'product.stockBand.low': 'Malo na stanie',
    'product.notify.cta': 'Powiadom o dostepnosci',
    'product.notify.dialogTitle': 'Powiadomimy Cie, gdy produkt znow bedzie dostepny',
    'product.notify.emailLabel': 'Adres e-mail',
    'product.notify.submit': 'Powiadom mnie',
    'product.notify.submitting': 'Zapisywanie…',
    'product.notify.success': 'Wyslemy e-mail gdy produkt bedzie ponownie dostepny.',
    'product.notify.errorGeneric': 'Nie udalo sie zapisac — sprobuj ponownie.',
    'product.notify.cancel': 'Anuluj',
    'product.backorder.hint': 'Aktualnie brak na stanie — produkt mozna zamowic, wysylka po dotarciu kolejnej dostawy.',
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
    'product.attributes.tabTitle': 'Parametry produktu',
    'product.attributes.boolean.yes': 'Tak',
    'product.attributes.boolean.no': 'Nie',
    // Feature 036 — Kasa.
    'checkout.success.title': 'Dziekujemy — Twoje zamowienie zostalo zlozone',
    'checkout.success.orderNumberPrefix': 'Numer Twojego zamowienia: ',
    'checkout.success.confirmationSent': 'Otrzymalismy je i wyslalismy e-mail z potwierdzeniem.',
    'checkout.success.bankTransferHint':
      'Prosimy o przelew z uzyciem numeru referencyjnego z faktury proforma, ktora wyslalismy e-mailem. Zaktualizujemy zamowienie po zaksiegowaniu wplaty.',
    'checkout.success.pickupHint':
      'Platnosc przy odbiorze. Zadne dalsze czynnosci nie sa obecnie wymagane.',
    'checkout.success.creditLimitHint':
      'Zamowienie zostalo rozliczone z limitu kredytowego Organizacji i jest obecnie przetwarzane.',
    'checkout.success.viewOrder': 'Szczegoly zamowienia',
    'checkout.success.allOrders': 'Wszystkie zamowienia',
    'checkout.success.continueShopping': 'Kontynuuj zakupy',
    'checkout.failure.title': 'Nie udalo sie zlozyc zamowienia',
    'checkout.failure.generic':
      'Cos poszlo nie tak przy skladaniu zamowienia. Twoj koszyk zostal zachowany, mozesz sprobowac ponownie.',
    'checkout.failure.cartKept':
      'Twoj koszyk pozostal bez zmian — nic nie zostalo obciazone, zamowienie nie zostalo utworzone.',
    'checkout.failure.tryAgain': 'Sprobuj ponownie',
    'checkout.failure.backToCart': 'Wroc do koszyka',
    'checkout.coupon.label': 'Kod kuponu (opcjonalnie)',
    'checkout.coupon.apply': 'Zastosuj',
    'checkout.coupon.appliedPrefix': 'Kupon ',
    'checkout.coupon.appliedSuffix': 'zastosowany — ',
    'checkout.coupon.remove': 'Usun',
    'checkout.address.shippingTitle': 'Adres dostawy',
    'checkout.address.billingTitle': 'Adres rozliczeniowy',
    'checkout.address.useSaved': 'Uzyj zapisanego adresu',
    'checkout.address.enterNew': 'Wpisz nowy adres',
    'checkout.address.sameAsShipping': 'Adres rozliczeniowy taki sam jak dostawy',
    'checkout.address.recipientName': 'Imie i nazwisko odbiorcy',
    'checkout.address.street': 'Ulica i numer',
    'checkout.address.postalCode': 'Kod pocztowy',
    'checkout.address.city': 'Miasto',
    'checkout.address.country': 'Kraj (np. PL)',
    'checkout.address.phone': 'Telefon (opcjonalnie)',
  },
};

export function tForLocale(locale: string): (key: MessageKey) => string {
  const dictionary = MESSAGES[locale] ?? MESSAGES['en-US']!;
  return (key) => dictionary[key] ?? MESSAGES['en-US']![key] ?? key;
}
