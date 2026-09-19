import type { ClientFetchLedgerEntry } from '../../check-rsc-discipline.js';

/**
 * The storefront application's own client components that populate a render
 * gate from an effect (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-020;
 * `contracts/rsc-discipline-check.md` §5).
 *
 * Keyed `(file, state name)` and never a line.
 *
 * **Every entry in this shard is `firstPaint: false`, and that is a finding
 * about the application rather than a weakness of the ledger.** The
 * storefront's *content* — the product, the category, the CMS page, the blog
 * post — is composed by Server Components and arrives in the first response;
 * what is left on the client is per-visitor state (a cart count, a comparison
 * membership), a control (a PWA opt-in, an autocomplete dropdown), or a surface
 * behind a `noindex` declaration Phase 2 wrote (checkout, compare, the RFQ
 * draft). None of it is content a crawler is owed. The blocks a shop composes
 * onto its *indexable* pages are the ones that are, and they are in
 * `cms-components.ts` — where all eleven entries are `firstPaint: true`.
 *
 * So none of these retires on `specs/096-page-builder-block-ownership/`'s D-31
 * seam. Each `retiredBy` names instead the change that would make the exemption
 * **wrong**: the component starting to render page content, or its page
 * becoming indexable. That is what an exemption owes — the condition under
 * which somebody should come back and disagree with it — and it is why the
 * contract asks a `false` entry for a retiring condition as well.
 *
 * The `noindex` claims below are Phase 2's declarations, not this file's
 * reading: `app/(commerce)/checkout/page.tsx`, `.../checkout/pay/page.tsx`,
 * `app/compare/page.tsx`, `app/compare/share/[token]/page.tsx` and
 * `app/(commerce)/quote-request/page.tsx` each carry
 * `robots: { index: false, follow: false }`, and `check:storefront-indexability`
 * is what keeps that true.
 *
 * **Three entries left with their subject** (`specs/134-paid-module-extraction/`
 * T031): a carrier's locker picker is the carrier's own storefront code and is no
 * longer a file in this repository, so those entries described nothing and
 * `stale-ledger-entry` is what would have said so. Deleting an entry whose
 * subject is gone is the ledger working, not an exemption being dropped.
 */
const NOT_PAGE_CONTENT =
  'this entry is wrong the moment the component renders anything a crawler is owed — page ' +
  'copy, a product, a category, an internal link into the catalogue. Re-classify it then.';

const STILL_NOINDEX = (route: string): string =>
  `this entry rests on \`${route}\` declaring \`robots: { index: false }\`. It retires — as a ` +
  'finding, not as an exemption — if that route ever becomes indexable, which ' +
  '`check:storefront-indexability` is what makes visible.';

export const entries: Readonly<Record<string, ClientFetchLedgerEntry>> = {
  // --- Checkout. Every one of these is on a route Phase 2 declared `noindex`.
  'storefront/app/(commerce)/checkout/pay/PaypalPayForm.tsx#error': {
    firstPaint: false,
    reason:
      'FR-020 — a PayPal payment failure message on `/checkout/pay`. A payment form is not ' +
      'content and the route is `noindex`.',
    retiredBy: STILL_NOINDEX('/checkout/pay'),
  },
  'storefront/app/(commerce)/checkout/pay/PaypalPayForm.tsx#loading': {
    firstPaint: false,
    reason:
      'FR-020 — the gate while the PayPal SDK and the order are fetched. Nothing behind it is ' +
      'crawlable content, and the route is `noindex`.',
    retiredBy: STILL_NOINDEX('/checkout/pay'),
  },
  'storefront/app/(commerce)/checkout/pay/PaypalPayForm.tsx#processing': {
    firstPaint: false,
    reason: 'FR-020 — the in-flight state of a payment capture on a `noindex` route.',
    retiredBy: STILL_NOINDEX('/checkout/pay'),
  },
  'storefront/app/(commerce)/checkout/pay/PayuPayForm.tsx#applePayReady': {
    firstPaint: false,
    reason:
      'FR-020 — whether PayU’s Apple Pay widget reported itself available. It is a capability ' +
      'of the visitor’s browser, so it cannot be decided on the server at all.',
    retiredBy: STILL_NOINDEX('/checkout/pay'),
  },
  'storefront/app/(commerce)/checkout/pay/PayuPayForm.tsx#cardWidgetStatus': {
    firstPaint: false,
    reason:
      'FR-020 — the PayU card widget’s own load state, reported by a third-party script in the ' +
      'browser.',
    retiredBy: STILL_NOINDEX('/checkout/pay'),
  },
  'storefront/app/(commerce)/checkout/pay/PayuPayForm.tsx#googlePayReady': {
    firstPaint: false,
    reason: 'FR-020 — as `applePayReady`: a browser capability, on a `noindex` route.',
    retiredBy: STILL_NOINDEX('/checkout/pay'),
  },
  'storefront/components/checkout/PaymentMethods.tsx#visibleMethods': {
    firstPaint: false,
    reason:
      'FR-020 — the payment methods available for *this* cart and this visitor’s browser, on ' +
      'a `noindex` route.',
    retiredBy: STILL_NOINDEX('/checkout'),
  },
  'storefront/components/checkout/StripeInlinePaymentMethods.tsx#visibleMethods': {
    firstPaint: false,
    reason: 'FR-020 — as `PaymentMethods`, for the Stripe inline element set.',
    retiredBy: STILL_NOINDEX('/checkout'),
  },

  // --- Comparison. Both routes are `noindex`; the header toggle is not.
  'storefront/components/ComparisonTable.tsx#error': {
    firstPaint: false,
    reason: 'FR-020 — a load failure on `/compare`, which Phase 2 declared `noindex`.',
    retiredBy: STILL_NOINDEX('/compare'),
  },
  'storefront/components/ComparisonTable.tsx#view': {
    firstPaint: false,
    reason:
      'FR-020 — the comparison itself. It is a set this visitor assembled and is stored ' +
      'against their session, so there is no server render of it to crawl.',
    retiredBy: STILL_NOINDEX('/compare'),
  },
  'storefront/components/SharedComparisonTable.tsx#state': {
    firstPaint: false,
    reason:
      'FR-020 — a shared comparison fetched by token on `/compare/share/[token]`, which is ' +
      '`noindex`. The token is a capability, so a crawlable render of it would be a leak ' +
      'rather than a feature.',
    retiredBy: STILL_NOINDEX('/compare/share/[token]'),
  },
  'storefront/components/CompareToggle.tsx#active': {
    firstPaint: false,
    reason:
      'FR-020 — whether *this* visitor already has this product in their comparison. It is ' +
      'rendered on the PDP, which **is** indexable, and it is still not content: the answer ' +
      'differs per session, so a server render would be wrong for everyone but the first.',
    retiredBy: NOT_PAGE_CONTENT,
  },
  'storefront/components/CompareToggle.tsx#hydrated': {
    firstPaint: false,
    reason:
      'FR-020 — the toggle suppresses itself until the session-dependent answer above is ' +
      'known, which is the correct treatment of a control whose state cannot be server-rendered.',
    retiredBy: NOT_PAGE_CONTENT,
  },
  'storefront/components/CompareToggle.tsx#size': {
    firstPaint: false,
    reason:
      'FR-020 — `CompareCounterLink`’s badge count in the header. Per-session, like the other ' +
      'three header badges.',
    retiredBy: NOT_PAGE_CONTENT,
  },

  // --- Header badges. On every page, indexable ones included, and per-session.
  'storefront/components/CartCounterBadge.tsx#count': {
    firstPaint: false,
    reason:
      'FR-020 — the number of lines in this visitor’s cart. A crawler has no cart, and a ' +
      'server render of somebody else’s count is worse than none.',
    retiredBy: NOT_PAGE_CONTENT,
  },
  'storefront/components/ShoppingListHeartBadge.tsx#count': {
    firstPaint: false,
    reason: 'FR-020 — this visitor’s shopping-list count, in the header.',
    retiredBy: NOT_PAGE_CONTENT,
  },
  'storefront/components/rfq/RfqDraftBadge.tsx#count': {
    firstPaint: false,
    reason: 'FR-020 — this visitor’s open RFQ draft count, in the header.',
    retiredBy: NOT_PAGE_CONTENT,
  },

  // --- Controls and account surfaces.
  'storefront/components/SearchAutocomplete.tsx#unavailable': {
    firstPaint: false,
    reason:
      'FR-020 — the "search is unavailable" message inside the autocomplete dropdown. The ' +
      'dropdown exists only after the visitor types, so nothing behind this gate is on the ' +
      'first paint at all — FR-022’s case, arriving through a shape the openness vocabulary ' +
      'does not recognise, which is why it is reported and answered here rather than excused ' +
      'in silence.',
    retiredBy: NOT_PAGE_CONTENT,
  },
  'storefront/components/pwa/PushOptIn.tsx#iosHint': {
    firstPaint: false,
    reason:
      'FR-020 — an install hint shown only to iOS Safari, decided from the visitor’s own user ' +
      'agent in the browser. Rendered from the root layout, so it is on indexable pages, and ' +
      'it is a control rather than content.',
    retiredBy: NOT_PAGE_CONTENT,
  },
  'storefront/components/pwa/PushOptIn.tsx#vapidKey': {
    firstPaint: false,
    reason:
      'FR-020 — the push subscription key, fetched before the opt-in control can do anything. ' +
      'The control is suppressed until it arrives, which is correct.',
    retiredBy: NOT_PAGE_CONTENT,
  },
  'storefront/components/rfq/RfqDraftView.tsx#hydrated': {
    firstPaint: false,
    reason:
      'FR-020 — the draft view suppresses itself until this visitor’s draft is read, on ' +
      '`/quote-request`, which Phase 2 declared `noindex`.',
    retiredBy: STILL_NOINDEX('/quote-request'),
  },
  'storefront/components/rfq/RfqDraftView.tsx#items': {
    firstPaint: false,
    reason: 'FR-020 — the lines of this visitor’s own RFQ draft, on a `noindex` route.',
    retiredBy: STILL_NOINDEX('/quote-request'),
  },
};
