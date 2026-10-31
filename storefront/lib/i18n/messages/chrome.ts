import { defineMessages } from './define';

/**
 * The `chrome` namespace (issue #85): the home page, header, footer,
 * not-found, offline, PWA, analytics and consent, the dictionary pickers,
 * mobile overlays — and anything that fits no other area.
 *
 * Keys are `chrome.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`chrome.footer.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 *
 * The home page, header and footer are the reference theme's built-in
 * "Industria" demo shop: their figures (the SKU count, the 14:00 cut-off, the
 * demo bearing's parameters) are demo content, written once in the component
 * and formatted for the reader's locale there; only the words are here.
 */
export const chrome = defineMessages({
  'en-US': {
    // Shared by more than one chrome screen.
    'chrome.shared.browseCatalog': 'Browse the catalog',
    'chrome.shared.creditLimit': 'Credit limit',
    'chrome.shared.vatInvoice': 'VAT invoice',
    /** "{count} products" under a department; one form per `Intl.PluralRules` category. */
    'chrome.shared.productCount.one': '{count} product',
    'chrome.shared.productCount.few': '{count} products',
    'chrome.shared.productCount.many': '{count} products',
    'chrome.shared.productCount.other': '{count} products',
    /** The demo shop's departments, by slug, shown while the catalogue has no tree. */
    'chrome.shared.category.fasteners': 'Fasteners',
    'chrome.shared.category.tools': 'Tools',
    'chrome.shared.category.electronics': 'Electronics',
    'chrome.shared.category.safety': 'Safety',
    'chrome.shared.category.screws': 'Screws',
    'chrome.shared.category.bolts': 'Bolts',

    'chrome.layout.title': 'B2B Platform',
    'chrome.layout.description':
      'A B2B commerce platform supporting Quote Requests and direct purchase for business customers.',

    'chrome.home.mobile.all': 'All',
    'chrome.home.mobile.shipsToday': 'Ships today',
    'chrome.home.hero.badge': '{skus} SKUs · {makers} manufacturers · ships today',
    'chrome.home.hero.titleLine1': 'Industrial components',
    /** `{emphasis}` is `chrome.home.hero.titleEmphasis`, rendered highlighted. */
    'chrome.home.hero.titleLine2': 'available {emphasis}.',
    'chrome.home.hero.titleEmphasis': 'off the shelf',
    'chrome.home.hero.intro':
      'A B2B wholesaler for maintenance teams, automation integrators and production departments. Net prices, a credit limit, datasheets, 3.1 certificates — all in one place.',
    'chrome.home.hero.quickOrderCsv': 'Quick Order from CSV',
    'chrome.home.stats.items': 'Items in stock',
    'chrome.home.stats.manufacturers': 'Manufacturers',
    'chrome.home.stats.cutoff': 'Shipping cut-off',
    'chrome.home.stats.availability': 'In-stock availability',
    'chrome.home.demo.sku': 'SKU {sku} · {brand}',
    'chrome.home.demo.stock': 'in stock · {count} pcs · {warehouse}',
    'chrome.home.demo.loadRating': 'Dynamic load rating',
    'chrome.home.demo.speed': '{value} rpm',
    'chrome.home.demo.datasheet': 'Datasheet',
    'chrome.home.demo.certificate': '3.1 certificate',
    'chrome.home.demo.model': '3D STEP model',
    'chrome.home.categories.eyebrow': '01 / Product range',
    'chrome.home.categories.heading': 'Six key departments',
    'chrome.home.categories.intro':
      "The category tree follows the manufacturers' catalogs, so you will quickly find what you are looking for.",
    'chrome.home.categories.seeAll': 'See all',
    'chrome.home.features.shipping.heading': 'Same-day shipping',
    'chrome.home.features.shipping.body':
      'Cut-off at {time}. {share} of items in stock at the central warehouse in Warsaw-Okęcie.',
    'chrome.home.features.credit.body':
      'From {min} to {max}. Invoices with deferred payment terms of 14/30/60 days.',
    'chrome.home.features.datasheets.heading': 'Datasheets and CAD',
    'chrome.home.features.datasheets.body':
      'Every product comes with a PDF datasheet, a 3D STEP/DXF model and a RoHS declaration.',
    'chrome.home.features.erp.heading': 'ERP integration',
    'chrome.home.features.erp.body': 'REST API, webhooks, CSV/EDI export. Quick Order for 200+ lines.',
    'chrome.home.bestsellers.eyebrow': '02 / Bestsellers',
    'chrome.home.bestsellers.heading': 'Most ordered this week',
    'chrome.home.bestsellers.intro': 'Ready to ship, proven in maintenance.',
    'chrome.home.bestsellers.seeAll': 'All bestsellers',

    'chrome.header.shipsTodayBy': 'Ships today if you order by {time}',
    'chrome.header.taxId': 'Tax ID',
    'chrome.header.support': 'B2B support',
    'chrome.header.currency': 'Currency:',
    'chrome.header.tagline': 'B2B · Industrial components',
    'chrome.header.taglineCompact': 'B2B components',
    'chrome.header.shoppingList': 'Shopping list',
    'chrome.header.quoteRequest': 'Quote request',
    /** No plural forms needed: "items: {count}" reads correctly for every count. */
    'chrome.header.quoteRequestItems': 'Quote request · items: {count}',
    'chrome.header.compare': 'Compare products',
    'chrome.header.cartItems': 'Cart · items: {count}',

    'chrome.footer.about':
      'A B2B wholesaler of industrial components. Bearings, drives, automation, electrical, pneumatics and tools. Same-day shipping, invoices with deferred payment terms and full technical documentation.',
    'chrome.footer.shop': 'Shop',
    'chrome.footer.account': 'B2B account',
    'chrome.footer.myAccount': 'My account',
    'chrome.footer.orders': 'Orders',
    'chrome.footer.invoices': 'Invoices',
    'chrome.footer.quoteRequests': 'RFQ — quote requests',
    'chrome.footer.shoppingLists': 'Shopping lists',
    'chrome.footer.support': 'Support',
    'chrome.footer.support.contact': 'Contact',
    'chrome.footer.support.returns': 'Returns and complaints',
    'chrome.footer.support.delivery': 'Delivery and payment',
    'chrome.footer.support.certificates': 'Certificates and compliance',
    'chrome.footer.support.help': 'Help center',
    'chrome.footer.newsletter.heading': 'Technical newsletter',
    'chrome.footer.newsletter.intro': 'Catalog news, price promotions and availability reports.',
    'chrome.footer.newsletter.placeholder': 'name@company.com',
    'chrome.footer.newsletter.submit': 'Subscribe',
    'chrome.footer.legal': '© {year} Industria B2B Sp. z o.o. · Tax ID (NIP) 7251234567 · KRS 0000987654',
    'chrome.footer.terms': 'Terms and conditions',
    'chrome.footer.privacy': 'Privacy policy',
    'chrome.footer.cookies': 'Cookies',
    /** `{heart}` is a decorative heart, hidden from assistive technology. */
    'chrome.footer.builtWith': 'Built with {heart} using',
    'chrome.footer.builtWithProduct': 'Endora Commerce',

    'chrome.notFound.documentTitle': '404 — page not found · {site}',
    'chrome.notFound.status': 'Error 404 · page does not exist',
    'chrome.notFound.heading': 'We could not find this page.',
    'chrome.notFound.body':
      'The address you are trying to open may have moved or may never have existed. Check the spelling in the address bar or use the shortcuts below — one click is usually enough to get where you want to go.',
    'chrome.notFound.searchLabel': 'Search the catalog',
    'chrome.notFound.searchPlaceholder': 'Find the product you are looking for…',
    'chrome.notFound.home': 'Back to the home page',
    'chrome.notFound.quoteRequest': 'Send a quote request',
    'chrome.notFound.popularLabel': 'Most popular',
    'chrome.notFound.popularHeading': 'Most popular departments',
    'chrome.notFound.help': 'Need help?',

    'chrome.offline.title': 'Offline',
    'chrome.offline.heading': 'You are offline',
    'chrome.offline.body':
      'Showing the last version of this page that you visited. Re-connect to the internet to load the latest catalog data, place an order, or request a quote.',

    'chrome.manifest.description': 'B2B commerce storefront',

    'chrome.pwa.install.title': 'Install our app',
    'chrome.pwa.install.body': 'Add this store to your home screen for one-tap access — no app store needed.',
    'chrome.pwa.install.install': 'Install',
    'chrome.pwa.install.dismiss': 'Not now',
    'chrome.pwa.install.close': 'Close',
    'chrome.pwa.push.iosHint': 'Add this store to your home screen to enable notifications.',
    'chrome.pwa.push.iosDismiss': 'Dismiss',
    'chrome.pwa.push.prompt': 'Get notified about your orders and quotes.',
    'chrome.pwa.push.enable': 'Enable notifications',
    'chrome.pwa.push.notNow': 'Not now',
    'chrome.pwa.update.available': 'A new version is available.',
    'chrome.pwa.update.reload': 'Reload',

    'chrome.impersonation.heading': 'Support session active.',
    /** `{admin}` is the first characters of the administrator's id, rendered as code. */
    'chrome.impersonation.body': 'An administrator ({admin}) is signed in as you. Anything you do here is logged.',
    'chrome.impersonation.end': 'End support session',

    'chrome.mobileSearch.back': 'Back',
    'chrome.mobileSearch.clear': 'Clear',
    'chrome.mobileSearch.suggestions': 'Suggestions',
    'chrome.mobileSearch.categories': 'Categories',
    'chrome.mobileTabBar.label': 'Mobile',

    'chrome.picker.country.blank': 'Select country',
    'chrome.picker.country.archived': '{label} (archived)',
    'chrome.picker.currency.blank': 'Select currency',
    'chrome.picker.currency.archived': '{label} ({code}, archived)',
    'chrome.picker.language.blank': 'Select language',
    'chrome.picker.language.archived': '{label} (archived)',
    'chrome.picker.archivedGroup': 'Archived',

    'chrome.consent.defaultMessage':
      'We use cookies for analytics (Google Analytics). You can accept or decline statistics.',
    'chrome.gtm.frameTitle': 'Google Tag Manager',
    'chrome.breadcrumbs.label': 'Breadcrumb',
    'chrome.miniCart.count.one': '{count} item in cart',
    'chrome.miniCart.count.few': '{count} items in cart',
    'chrome.miniCart.count.many': '{count} items in cart',
    'chrome.miniCart.count.other': '{count} items in cart',
  },
  'pl-PL': {
    'chrome.shared.browseCatalog': 'Przeglądaj katalog',
    'chrome.shared.creditLimit': 'Limit kredytowy',
    'chrome.shared.vatInvoice': 'Faktura VAT',
    'chrome.shared.productCount.one': '{count} produkt',
    'chrome.shared.productCount.few': '{count} produkty',
    'chrome.shared.productCount.many': '{count} produktów',
    'chrome.shared.productCount.other': '{count} produktu',
    'chrome.shared.category.fasteners': 'Łączniki',
    'chrome.shared.category.tools': 'Narzędzia',
    'chrome.shared.category.electronics': 'Elektronika',
    'chrome.shared.category.safety': 'BHP',
    'chrome.shared.category.screws': 'Wkręty',
    'chrome.shared.category.bolts': 'Śruby',

    'chrome.layout.title': 'B2B Platform',
    'chrome.layout.description':
      'Platforma handlowa B2B obsługująca zapytania ofertowe i bezpośrednie zakupy klientów biznesowych.',

    'chrome.home.mobile.all': 'Wszystko',
    'chrome.home.mobile.shipsToday': 'Wysyłka dziś',
    'chrome.home.hero.badge': '{skus} SKU · {makers} producentów · wysyłka dziś',
    'chrome.home.hero.titleLine1': 'Komponenty przemysłowe',
    'chrome.home.hero.titleLine2': 'dostępne {emphasis}.',
    'chrome.home.hero.titleEmphasis': 'od ręki',
    'chrome.home.hero.intro':
      'Hurtownia B2B dla utrzymania ruchu, integratorów automatyki i działów produkcji. Ceny netto, limit kredytowy, karty katalogowe, certyfikaty 3.1 — wszystko w jednym miejscu.',
    'chrome.home.hero.quickOrderCsv': 'Quick Order z CSV',
    'chrome.home.stats.items': 'Pozycji w magazynie',
    'chrome.home.stats.manufacturers': 'Producentów',
    'chrome.home.stats.cutoff': 'Cut-off wysyłki',
    'chrome.home.stats.availability': 'Dostępność on-stock',
    'chrome.home.demo.sku': 'SKU {sku} · {brand}',
    'chrome.home.demo.stock': 'on-stock · {count} szt. · {warehouse}',
    'chrome.home.demo.loadRating': 'Nośność dynamiczna',
    'chrome.home.demo.speed': '{value} obr/min',
    'chrome.home.demo.datasheet': 'Karta katalogowa',
    'chrome.home.demo.certificate': 'Certyfikat 3.1',
    'chrome.home.demo.model': 'Model 3D STEP',
    'chrome.home.categories.eyebrow': '01 / Asortyment',
    'chrome.home.categories.heading': 'Sześć kluczowych działów',
    'chrome.home.categories.intro':
      'Drzewo kategorii odzwierciedla katalogi producentów — łatwo trafisz do tego, czego szukasz.',
    'chrome.home.categories.seeAll': 'Zobacz wszystkie',
    'chrome.home.features.shipping.heading': 'Wysyłka tego samego dnia',
    'chrome.home.features.shipping.body':
      'Cut-off {time}. {share} pozycji on-stock w magazynie centralnym Warszawa-Okęcie.',
    'chrome.home.features.credit.body': 'Od {min} do {max}. Faktura z odroczonym terminem 14/30/60 dni.',
    'chrome.home.features.datasheets.heading': 'Karty katalogowe i CAD',
    'chrome.home.features.datasheets.body': 'Każdy produkt ma kartę PDF, model 3D STEP/DXF, deklarację RoHS.',
    'chrome.home.features.erp.heading': 'Integracja z ERP',
    'chrome.home.features.erp.body': 'API REST, webhooki, eksport CSV/EDI. Quick Order dla 200+ pozycji.',
    'chrome.home.bestsellers.eyebrow': '02 / Bestsellery',
    'chrome.home.bestsellers.heading': 'Najczęściej zamawiane w tym tygodniu',
    'chrome.home.bestsellers.intro': 'Gotowe do wysyłki, sprawdzone w utrzymaniu ruchu.',
    'chrome.home.bestsellers.seeAll': 'Wszystkie bestsellery',

    'chrome.header.shipsTodayBy': 'Wysyłka dziś, jeśli zamówisz do {time}',
    'chrome.header.taxId': 'NIP',
    'chrome.header.support': 'Wsparcie B2B',
    'chrome.header.currency': 'Waluta:',
    'chrome.header.tagline': 'B2B · Komponenty przemysłowe',
    'chrome.header.taglineCompact': 'Komponenty B2B',
    'chrome.header.shoppingList': 'Lista zakupów',
    'chrome.header.quoteRequest': 'Zapytanie ofertowe',
    'chrome.header.quoteRequestItems': 'Zapytanie ofertowe · liczba pozycji: {count}',
    'chrome.header.compare': 'Porównaj produkty',
    'chrome.header.cartItems': 'Koszyk · liczba pozycji: {count}',

    'chrome.footer.about':
      'Hurtownia B2B komponentów przemysłowych. Łożyska, napędy, automatyka, elektryka, pneumatyka i narzędzia. Wysyłka tego samego dnia, faktura z odroczonym terminem płatności i pełna dokumentacja techniczna.',
    'chrome.footer.shop': 'Sklep',
    'chrome.footer.account': 'Konto B2B',
    'chrome.footer.myAccount': 'Moje konto',
    'chrome.footer.orders': 'Zamówienia',
    'chrome.footer.invoices': 'Faktury',
    'chrome.footer.quoteRequests': 'RFQ — zapytania ofertowe',
    'chrome.footer.shoppingLists': 'Listy zakupów',
    'chrome.footer.support': 'Wsparcie',
    'chrome.footer.support.contact': 'Kontakt',
    'chrome.footer.support.returns': 'Reklamacje i zwroty',
    'chrome.footer.support.delivery': 'Dostawa i płatności',
    'chrome.footer.support.certificates': 'Certyfikaty i zgodność',
    'chrome.footer.support.help': 'Centrum pomocy',
    'chrome.footer.newsletter.heading': 'Newsletter techniczny',
    'chrome.footer.newsletter.intro': 'Nowości katalogowe, promocje cenowe i raporty dostępności.',
    'chrome.footer.newsletter.placeholder': 'adres@firma.pl',
    'chrome.footer.newsletter.submit': 'Zapisz się',
    'chrome.footer.legal': '© {year} Industria B2B Sp. z o.o. · NIP 7251234567 · KRS 0000987654',
    'chrome.footer.terms': 'Regulamin',
    'chrome.footer.privacy': 'Polityka prywatności',
    'chrome.footer.cookies': 'Cookies',
    'chrome.footer.builtWith': 'Zbudowane z {heart} przy użyciu',
    'chrome.footer.builtWithProduct': 'Endora Commerce',

    'chrome.notFound.documentTitle': '404 — strona nie została znaleziona · {site}',
    'chrome.notFound.status': 'Błąd 404 · strona nie istnieje',
    'chrome.notFound.heading': 'Nie znaleźliśmy tej strony.',
    'chrome.notFound.body':
      'Adres, który próbujesz otworzyć, mógł zostać przeniesiony albo nigdy nie istniał. Sprawdź pisownię w pasku adresu lub skorzystaj z poniższych skrótów — z reguły wystarczy jedno kliknięcie, żeby trafić tam, gdzie chcesz.',
    'chrome.notFound.searchLabel': 'Wyszukaj w katalogu',
    'chrome.notFound.searchPlaceholder': 'Znajdź produkt, którego szukasz…',
    'chrome.notFound.home': 'Wróć na stronę główną',
    'chrome.notFound.quoteRequest': 'Wyślij zapytanie ofertowe',
    'chrome.notFound.popularLabel': 'Najczęściej wybierane',
    'chrome.notFound.popularHeading': 'Najpopularniejsze działy',
    'chrome.notFound.help': 'Potrzebujesz pomocy?',

    'chrome.offline.title': 'Brak połączenia',
    'chrome.offline.heading': 'Jesteś offline',
    'chrome.offline.body':
      'Widzisz ostatnią zapisaną wersję odwiedzonej strony. Połącz się ponownie z internetem, aby wczytać aktualne dane katalogu, złożyć zamówienie lub wysłać zapytanie ofertowe.',

    'chrome.manifest.description': 'Sklep internetowy B2B',

    'chrome.pwa.install.title': 'Zainstaluj aplikację',
    'chrome.pwa.install.body':
      'Dodaj sklep do ekranu głównego, aby mieć do niego dostęp jednym dotknięciem — bez sklepu z aplikacjami.',
    'chrome.pwa.install.install': 'Zainstaluj',
    'chrome.pwa.install.dismiss': 'Nie teraz',
    'chrome.pwa.install.close': 'Zamknij',
    'chrome.pwa.push.iosHint': 'Dodaj sklep do ekranu głównego, aby włączyć powiadomienia.',
    'chrome.pwa.push.iosDismiss': 'Ukryj',
    'chrome.pwa.push.prompt': 'Otrzymuj powiadomienia o swoich zamówieniach i zapytaniach ofertowych.',
    'chrome.pwa.push.enable': 'Włącz powiadomienia',
    'chrome.pwa.push.notNow': 'Nie teraz',
    'chrome.pwa.update.available': 'Dostępna jest nowa wersja.',
    'chrome.pwa.update.reload': 'Odśwież',

    'chrome.impersonation.heading': 'Trwa sesja wsparcia.',
    'chrome.impersonation.body':
      'Administrator ({admin}) jest zalogowany jako Ty. Wszystko, co tu robisz, jest rejestrowane.',
    'chrome.impersonation.end': 'Zakończ sesję wsparcia',

    'chrome.mobileSearch.back': 'Wstecz',
    'chrome.mobileSearch.clear': 'Wyczyść',
    'chrome.mobileSearch.suggestions': 'Podpowiedzi',
    'chrome.mobileSearch.categories': 'Kategorie',
    'chrome.mobileTabBar.label': 'Nawigacja mobilna',

    'chrome.picker.country.blank': 'Wybierz kraj',
    'chrome.picker.country.archived': '{label} (archiwalny)',
    'chrome.picker.currency.blank': 'Wybierz walutę',
    'chrome.picker.currency.archived': '{label} ({code}, archiwalna)',
    'chrome.picker.language.blank': 'Wybierz język',
    'chrome.picker.language.archived': '{label} (archiwalny)',
    'chrome.picker.archivedGroup': 'Archiwalne',

    'chrome.consent.defaultMessage':
      'Używamy plików cookie do analityki (Google Analytics). Możesz zaakceptować lub odrzucić statystyki.',
    'chrome.gtm.frameTitle': 'Google Tag Manager',
    'chrome.breadcrumbs.label': 'Ścieżka nawigacji',
    'chrome.miniCart.count.one': '{count} pozycja w koszyku',
    'chrome.miniCart.count.few': '{count} pozycje w koszyku',
    'chrome.miniCart.count.many': '{count} pozycji w koszyku',
    'chrome.miniCart.count.other': '{count} pozycji w koszyku',
  },
});
