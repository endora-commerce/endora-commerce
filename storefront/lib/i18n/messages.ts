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

export type MessageKey =
  | 'nav.home'
  | 'nav.catalog'
  | 'nav.search'
  | 'nav.account'
  | 'nav.login'
  | 'nav.quickOrder'
  | 'nav.cart'
  | 'nav.quoteRequest'
  | 'catalog.heading'
  | 'catalog.filters'
  | 'catalog.empty'
  | 'catalog.loadMore'
  | 'catalog.sort.priceAsc'
  | 'catalog.sort.priceDesc'
  | 'catalog.price.heading'
  | 'catalog.price.min'
  | 'catalog.price.max'
  | 'catalog.price.apply'
  | 'catalog.price.clear'
  | 'catalog.price.unitNote'
  | 'product.outOfStock'
  | 'product.requestQuote'
  | 'product.addToCart'
  | 'product.details'
  | 'product.tabs.description'
  | 'product.tabs.parameters'
  | 'product.tabs.attachments'
  | 'product.packaging.singlePiece'
  | 'product.packaging.pieces'
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
  // Issue #287 — the failure page's second reader: a buyer whose order exists
  // and whose payment did not settle. The keys above stay for the buyer whose
  // order was never created, whose cart really is intact.
  | 'checkout.paymentFailure.title.failed'
  | 'checkout.paymentFailure.title.cancelled'
  | 'checkout.paymentFailure.orderPlacedPrefix'
  | 'checkout.paymentFailure.orderPlacedSuffix'
  | 'checkout.paymentFailure.failedBody'
  | 'checkout.paymentFailure.cancelledBody'
  | 'checkout.paymentFailure.payAgain'
  | 'checkout.paymentFailure.retryHint'
  | 'checkout.paymentFailure.noRetryHint'
  | 'checkout.paymentFailure.viewOrder'
  | 'checkout.paymentFailure.allOrders'
  // Issue #287 — the webhook race: back from the gateway, confirmation not yet
  // in. Neither success nor failure is true yet, so neither is said.
  | 'checkout.paymentPending.title'
  | 'checkout.paymentPending.orderNumberPrefix'
  | 'checkout.paymentPending.placed'
  | 'checkout.paymentPending.stillWaiting'
  | 'checkout.paymentPending.checkAgain'
  | 'checkout.paymentPending.viewOrder'
  // Issue #264 — paying an order again after the first attempt did not go
  // through. Shown on the order page, which is where a buyer looks for it.
  | 'order.payment.retry.cta'
  | 'order.payment.retry.hint'
  | 'order.payment.retry.inProgress'
  | 'order.payment.retry.failed'
  // Feature 085 — the buyer cancelling an order they placed, offered exactly
  // when the platform says they may.
  | 'order.cancel.cta'
  | 'order.cancel.hint'
  | 'order.cancel.failed'
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
  | 'checkout.address.phone'
  | 'checkout.address.billingCompanyTitle'
  | 'checkout.address.billingCompanyHint'
  | 'checkout.address.companyName'
  | 'checkout.address.taxId'
  // Feature 063 — TPay checkout / pay step.
  | 'tpay.redirect.notice'
  | 'tpay.pay.title'
  | 'tpay.pay.subtitle'
  | 'tpay.blik.label'
  | 'tpay.blik.placeholder'
  | 'tpay.blik.invalid'
  | 'tpay.blik.submit'
  | 'tpay.blik.oneClick'
  | 'tpay.blik.registerHint'
  | 'tpay.blik.forget'
  | 'tpay.blik.multiAppFallback'
  | 'tpay.blik.accountTitle'
  | 'tpay.blik.accountRegistered'
  | 'tpay.blik.accountNotRegistered'
  | 'tpay.card.number'
  | 'tpay.card.expiry'
  | 'tpay.card.cvc'
  | 'tpay.card.submit'
  | 'tpay.card.save'
  | 'tpay.card.savedListLabel'
  | 'tpay.card.savedLabel'
  | 'tpay.card.paySaved'
  | 'tpay.card.remove'
  | 'tpay.card.empty'
  | 'tpay.card.encryptError'
  | 'tpay.card.rsaMissing'
  | 'tpay.card.fieldset'
  | 'tpay.card.orNew'
  | 'tpay.card.processing'
  | 'tpay.card.checkDetails'
  | 'tpay.card.numberIncomplete'
  | 'tpay.card.numberInvalid'
  | 'tpay.card.expiryIncomplete'
  | 'tpay.card.expiryInvalid'
  | 'tpay.card.expiryPast'
  | 'tpay.card.cvcIncomplete'
  | 'tpay.card.cvcInvalid'
  | 'tpay.3ds.hint'
  | 'tpay.terms.label'
  | 'tpay.pay.failure'
  | 'tpay.pay.retry'
  | 'tpay.bank.redirectHint'
  // Feature 065 — PayU checkout / pay step.
  | 'payu.redirect.notice'
  | 'payu.pay.title'
  | 'payu.pay.subtitle'
  | 'payu.blik.label'
  | 'payu.blik.placeholder'
  | 'payu.blik.invalid'
  | 'payu.blik.submit'
  | 'payu.blik.oneClick'
  | 'payu.blik.registerHint'
  | 'payu.blik.forget'
  | 'payu.blik.multiAppFallback'
  | 'payu.blik.accountTitle'
  | 'payu.blik.accountRegistered'
  | 'payu.blik.accountNotRegistered'
  | 'payu.card.savedListLabel'
  | 'payu.card.savedLabel'
  | 'payu.card.paySaved'
  | 'payu.card.remove'
  | 'payu.card.empty'
  | 'payu.card.save'
  | 'payu.card.fieldset'
  | 'payu.card.orNew'
  | 'payu.card.submit'
  | 'payu.card.processing'
  | 'payu.card.numberPlaceholder'
  | 'payu.card.widgetLoading'
  | 'payu.card.tokenizeError'
  | 'payu.card.tokenMissing'
  | 'payu.card.fallbackLabel'
  | 'payu.card.fallbackPlaceholder'
  | 'payu.card.fallbackHint'
  | 'payu.3ds.hint'
  | 'payu.pay.failure'
  | 'payu.pay.retry'
  | 'payu.bank.redirectHint'
  | 'payu.wallet.googlePay'
  | 'payu.wallet.applePay'
  | 'payu.wallet.googleUnavailable'
  | 'payu.wallet.appleUnavailable'
  // Feature 067 — Autopay checkout (redirect paywall).
  | 'autopay.redirect.notice'
  // Feature 086 — PayPal checkout / pay step.
  | 'paypal.redirect.notice'
  | 'paypal.pay.title'
  | 'paypal.pay.subtitle'
  | 'paypal.pay.loading'
  | 'paypal.pay.processing'
  | 'paypal.pay.failure'
  | 'paypal.pay.missingClientId'
  // Feature 008 — Quote Request success page (parallel to checkout success).
  | 'quoteRequest.success.title'
  | 'quoteRequest.success.numberPrefix'
  | 'quoteRequest.success.confirmationSent'
  | 'quoteRequest.success.nextStepsHint'
  | 'quoteRequest.success.viewRequest'
  | 'quoteRequest.success.allRequests'
  | 'quoteRequest.success.continueShopping'
  // Issue #193 — federated sign-in. Rendered only when `mfa` is present and the
  // provider is configured + enabled, so these never label a dead control.
  | 'auth.federated.groupLabel'
  | 'auth.federated.divider'
  | 'auth.federated.google'
  | 'auth.federated.microsoft'
  // Issue #194 — the linked-identities panel on the account security page.
  | 'account.socialLinks.heading'
  | 'account.socialLinks.intro'
  | 'account.socialLinks.linkedOn'
  | 'account.socialLinks.remove'
  | 'account.socialLinks.lastCredential'
  | 'account.socialLinks.setPassword'
  // The shared comparison. Sender and recipient legitimately see different
  // numbers and, where the sender restricted a product, different rows — so
  // the view says whose prices these are and that something is missing,
  // rather than leaving the reader to discover it.
  | 'compare.shared.pricesYours'
  | 'compare.shared.pricesChannel'
  | 'compare.shared.hiddenProducts'
  // Issue #274 — every payment gateway returns the buyer to the order page.
  // The page says why they are back; the order's own payment status decides
  // whether it says anything at all.
  | 'orders.paymentReturn.returned'
  | 'orders.paymentReturn.cancelled'
  | 'orders.paymentReturn.failed'
  | 'orders.actionFailed';

const MESSAGES: Record<string, Record<MessageKey, string>> = {
  'en-US': {
    'nav.home': 'Home',
    'nav.catalog': 'Catalog',
    'nav.search': 'Search',
    'nav.account': 'Account',
    'nav.login': 'Sign in',
    'nav.quickOrder': 'Quick Order',
    'nav.cart': 'Cart',
    'nav.quoteRequest': 'Quote',
    'catalog.heading': 'Catalog',
    'catalog.filters': 'Filters',
    'catalog.empty': 'No products match your filters.',
    'catalog.loadMore': 'Load more',
    'catalog.sort.priceAsc': 'Price: lowest first',
    'catalog.sort.priceDesc': 'Price: highest first',
    'catalog.price.heading': 'Price',
    'catalog.price.min': 'From',
    'catalog.price.max': 'To',
    'catalog.price.apply': 'Apply price range',
    'catalog.price.clear': 'Clear price range',
    'catalog.price.unitNote':
      'Prices shown are your unit prices. Quantity discounts and promotions are applied in the cart.',
    'product.outOfStock': 'Out of stock',
    'product.requestQuote': 'Request a quote',
    'product.addToCart': 'Add to cart',
    'product.details': 'Details',
    'product.tabs.description': 'Description',
    'product.tabs.parameters': 'Parameters',
    'product.tabs.attachments': 'Attachments',
    'product.packaging.singlePiece': 'Single piece',
    'product.packaging.pieces': 'pcs',
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
    // Issue #287 — the buyer whose order exists.
    'checkout.paymentFailure.title.failed': 'Your payment did not go through',
    'checkout.paymentFailure.title.cancelled': 'Your payment was not completed',
    'checkout.paymentFailure.orderPlacedPrefix': 'Your order ',
    'checkout.paymentFailure.orderPlacedSuffix':
      ' has been placed and is waiting to be paid. Nothing has been charged.',
    'checkout.paymentFailure.failedBody': 'The payment provider did not accept this payment.',
    'checkout.paymentFailure.cancelledBody':
      'The payment was left before it was finished, so nothing was charged.',
    'checkout.paymentFailure.payAgain': 'Pay for this order again',
    'checkout.paymentFailure.retryHint':
      'You can start the payment again for this same order.',
    'checkout.paymentFailure.noRetryHint':
      'This order cannot be paid online at the moment. Open it to see what to do next.',
    'checkout.paymentFailure.viewOrder': 'View order details',
    'checkout.paymentFailure.allOrders': 'All orders',
    'checkout.paymentPending.title': 'We are confirming your payment',
    'checkout.paymentPending.orderNumberPrefix': 'Your order number is ',
    'checkout.paymentPending.placed':
      'Your order is placed. Nothing more is needed from you — we are waiting for the payment provider to confirm the payment, which usually takes a few seconds.',
    'checkout.paymentPending.stillWaiting':
      'This is taking longer than usual. We will e-mail you as soon as the payment is confirmed, and the order page always shows where it stands.',
    'checkout.paymentPending.checkAgain': 'Check again',
    'checkout.paymentPending.viewOrder': 'View order details',
    'order.payment.retry.cta': 'Pay again',
    'order.payment.retry.hint':
      'Your payment did not go through. Nothing has been charged — you can pay for this order again.',
    'order.payment.retry.inProgress':
      'A payment is already in progress for this order. Finish it on the payment page or wait for it to time out before starting a new one.',
    'order.payment.retry.failed': 'We could not start the payment. Please try again in a moment.',
    'order.cancel.cta': 'Cancel this order',
    'order.cancel.hint':
      'You have not paid for this order yet and we have not started on it, so you can still cancel it. The goods it reserves go straight back on the shelf.',
    'order.cancel.failed': 'We could not cancel this order. Please contact us and we will help.',
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
    'checkout.address.billingCompanyTitle': 'Billing company details',
    'checkout.address.billingCompanyHint':
      'Defaults to your organization. Override for this order if needed.',
    'checkout.address.companyName': 'Company name',
    'checkout.address.taxId': 'Tax ID (NIP)',
    // Feature 063 — TPay.
    'tpay.redirect.notice':
      'After you click “Place order”, you’ll be redirected to TPay to complete your payment securely.',
    'tpay.pay.title': 'Complete your payment',
    'tpay.pay.subtitle': 'Enter your payment details to finish the order.',
    'tpay.blik.label': 'BLIK code',
    'tpay.blik.placeholder': '6-digit code',
    'tpay.blik.invalid': 'Enter a valid 6-digit BLIK code.',
    'tpay.blik.submit': 'Pay with BLIK',
    'tpay.blik.oneClick': 'Pay with BLIK One Click',
    'tpay.blik.registerHint': 'Remember for BLIK One Click',
    'tpay.blik.forget': 'Forget BLIK One Click',
    'tpay.blik.multiAppFallback':
      'Confirm the payment in your banking app, or enter a BLIK code instead.',
    'tpay.blik.accountTitle': 'BLIK One Click',
    'tpay.blik.accountRegistered':
      'Enabled. At checkout you can pay with BLIK without entering a 6-digit code — just confirm in your banking app.',
    'tpay.blik.accountNotRegistered':
      'Not enabled yet. At checkout, pay with a 6-digit BLIK code (sandbox: starts with 777), tick “Remember for BLIK One Click”, and complete the payment. One Click unlocks after that payment succeeds.',
    'tpay.card.number': 'Card number',
    'tpay.card.expiry': 'Expiry (MM/YY)',
    'tpay.card.cvc': 'CVC',
    'tpay.card.submit': 'Pay by card',
    'tpay.card.save': 'Save this card',
    'tpay.card.savedListLabel': 'Saved cards',
    'tpay.card.savedLabel': 'Saved card',
    'tpay.card.paySaved': 'Pay with saved card',
    'tpay.card.remove': 'Remove',
    'tpay.card.empty': 'No saved cards yet.',
    'tpay.card.encryptError': 'Could not encrypt the card details. Check the RSA key in TPay settings and try again.',
    'tpay.card.rsaMissing': 'Card payments need an RSA public key. Add it under Admin → TPay settings.',
    'tpay.card.fieldset': 'Card details',
    'tpay.card.orNew': 'Or pay with a new card',
    'tpay.card.processing': 'Processing…',
    'tpay.card.checkDetails': 'Check the card details and try again.',
    'tpay.card.numberIncomplete': 'Enter your complete card number.',
    'tpay.card.numberInvalid': 'Your card number is invalid.',
    'tpay.card.expiryIncomplete': 'Enter a complete expiry date.',
    'tpay.card.expiryInvalid': 'Your card’s expiry date is invalid.',
    'tpay.card.expiryPast': 'Your card has expired.',
    'tpay.card.cvcIncomplete': 'Enter your card’s security code.',
    'tpay.card.cvcInvalid': 'Your card’s security code is incomplete.',
    'tpay.3ds.hint': 'You will be redirected to complete 3-D Secure verification.',
    'tpay.terms.label': 'TPay terms and information clause',
    'tpay.pay.failure': 'Payment failed. Please try again.',
    'tpay.pay.retry': 'Try again',
    'tpay.bank.redirectHint':
      'Complete the payment on the TPay page if you were not redirected automatically.',
    // Feature 065 — PayU.
    'payu.redirect.notice':
      'After you click “Place order”, you’ll be redirected to PayU to complete your payment securely.',
    'payu.pay.title': 'Complete your payment',
    'payu.pay.subtitle': 'Enter your payment details to finish the order.',
    'payu.blik.label': 'BLIK code',
    'payu.blik.placeholder': '6-digit code',
    'payu.blik.invalid': 'Enter a valid 6-digit BLIK code.',
    'payu.blik.submit': 'Pay with BLIK',
    'payu.blik.oneClick': 'Pay with BLIK One Click',
    'payu.blik.registerHint': 'Remember for BLIK One Click',
    'payu.blik.forget': 'Forget BLIK One Click',
    'payu.blik.multiAppFallback':
      'Confirm the payment in your banking app, or enter a BLIK code instead.',
    'payu.blik.accountTitle': 'BLIK One Click',
    'payu.blik.accountRegistered':
      'Enabled. At checkout you can pay with BLIK without entering a 6-digit code — just confirm in your banking app.',
    'payu.blik.accountNotRegistered':
      'Not enabled yet. At checkout, pay with a 6-digit BLIK code, tick “Remember for BLIK One Click”, and complete the payment. One Click unlocks after that payment succeeds.',
    'payu.card.savedListLabel': 'Saved cards',
    'payu.card.savedLabel': 'Saved card',
    'payu.card.paySaved': 'Pay with saved card',
    'payu.card.remove': 'Remove',
    'payu.card.empty': 'No saved cards yet.',
    'payu.card.save': 'Save this card',
    'payu.card.fieldset': 'Card details',
    'payu.card.orNew': 'Or pay with a new card',
    'payu.card.submit': 'Pay by card',
    'payu.card.processing': 'Processing…',
    'payu.card.numberPlaceholder': 'Card number',
    'payu.card.widgetLoading': 'Loading the secure card form…',
    'payu.card.tokenizeError': 'Could not process the card details. Check them and try again.',
    'payu.card.tokenMissing': 'Enter a card token to continue.',
    'payu.card.fallbackLabel': 'Card token',
    'payu.card.fallbackPlaceholder': 'TOKC_… / TOK_…',
    'payu.card.fallbackHint':
      'The secure card form could not load, so enter a PayU card token directly (e.g. from a sandbox test token).',
    'payu.3ds.hint': 'You may be redirected to complete 3-D Secure verification.',
    'payu.pay.failure': 'Payment failed. Please try again.',
    'payu.pay.retry': 'Try again',
    'payu.bank.redirectHint':
      'Complete the payment on the PayU page if you were not redirected automatically.',
    'payu.wallet.googlePay': 'Pay with Google Pay',
    'payu.wallet.applePay': 'Pay with Apple Pay',
    'payu.wallet.googleUnavailable':
      'Google Pay is not available in this browser or for the current PayU POS.',
    'payu.wallet.appleUnavailable':
      'Apple Pay is not available (Safari / Apple device required, and merchant identity must be configured).',
    // Feature 067 — Autopay.
    'autopay.redirect.notice':
      'After you click “Place order”, you’ll be redirected to Autopay to complete your payment securely.',
    // Feature 086 — PayPal.
    'paypal.redirect.notice':
      'After you click “Place order”, you’ll be redirected to PayPal to complete your payment securely.',
    'paypal.pay.title': 'Complete your payment',
    'paypal.pay.subtitle': 'Pay with PayPal to finish the order.',
    'paypal.pay.loading': 'Loading PayPal…',
    'paypal.pay.processing': 'Processing payment…',
    'paypal.pay.failure': 'Payment failed. Please try again.',
    'paypal.pay.missingClientId': 'PayPal is not configured for this store.',
    // Feature 008 — Quote Request success page.
    'quoteRequest.success.title': 'Thank you — your quote request is submitted',
    'quoteRequest.success.numberPrefix': 'Your quote request number is ',
    'quoteRequest.success.confirmationSent':
      'We have received it and sent a confirmation e-mail.',
    'quoteRequest.success.nextStepsHint':
      'Our sales team will review your request and prepare a quote with prices and terms. You will be notified when the offer is ready.',
    'quoteRequest.success.viewRequest': 'View quote request',
    'quoteRequest.success.allRequests': 'All quote requests',
    'quoteRequest.success.continueShopping': 'Continue shopping',
    // Issue #193 — federated sign-in.
    'auth.federated.groupLabel': 'Other sign-in options',
    'auth.federated.divider': 'or',
    'auth.federated.google': 'Continue with Google',
    'auth.federated.microsoft': 'Continue with Microsoft',
    // Issue #194 — linked identities.
    'account.socialLinks.heading': 'Linked accounts',
    'account.socialLinks.intro':
      'These external accounts can sign you in. Removing one does not delete your account.',
    'account.socialLinks.linkedOn': 'Linked on',
    'account.socialLinks.remove': 'Remove',
    'account.socialLinks.lastCredential':
      'This is the last sign-in identity linked to your account, and your account has no password on record — removing it now could lock you out for good. Set a password first, then you can remove it.',
    'account.socialLinks.setPassword': 'Set a password',
    'compare.shared.pricesYours': 'Prices shown are your organisation’s.',
    'compare.shared.pricesChannel':
      'Prices shown are this store’s standard prices. Sign in to see the prices agreed for your organisation.',
    'compare.shared.hiddenProducts':
      'Some products in this comparison are not available to your account and are not shown here.',
    'orders.paymentReturn.returned':
      'You are back from the payment provider. Your order is placed; we are still waiting for the payment to be confirmed, and this page shows the result as soon as it arrives.',
    'orders.paymentReturn.cancelled':
      'You have not paid yet. Your order is placed and is waiting for payment — nothing has been charged.',
    'orders.paymentReturn.failed':
      'Your payment did not go through. Your order is placed and is still waiting for payment, so you can try again.',
    'orders.actionFailed': 'We could not complete that action.',
  },
  'pl-PL': {
    'nav.home': 'Strona glowna',
    'nav.catalog': 'Katalog',
    'nav.search': 'Wyszukiwanie',
    'nav.account': 'Konto',
    'nav.login': 'Zaloguj się',
    'nav.quickOrder': 'Quick Order',
    'nav.cart': 'Koszyk',
    'nav.quoteRequest': 'Zapytanie',
    'catalog.heading': 'Katalog',
    'catalog.filters': 'Filtry',
    'catalog.empty': 'Zaden produkt nie pasuje do filtrow.',
    'catalog.loadMore': 'Pokaz wiecej',
    'catalog.sort.priceAsc': 'Cena: od najniższej',
    'catalog.sort.priceDesc': 'Cena: od najwyższej',
    'catalog.price.heading': 'Cena',
    'catalog.price.min': 'Od',
    'catalog.price.max': 'Do',
    'catalog.price.apply': 'Zastosuj zakres cen',
    'catalog.price.clear': 'Wyczyść zakres cen',
    'catalog.price.unitNote':
      'Pokazane ceny to Twoje ceny jednostkowe. Rabaty ilościowe i promocje naliczamy w koszyku.',
    'product.outOfStock': 'Brak w magazynie',
    'product.requestQuote': 'Zapytaj o oferte',
    'product.addToCart': 'Dodaj do koszyka',
    'product.details': 'Szczegóły',
    'product.tabs.description': 'Opis',
    'product.tabs.parameters': 'Parametry',
    'product.tabs.attachments': 'Załączniki',
    'product.packaging.singlePiece': 'Pojedyncza sztuka',
    'product.packaging.pieces': 'szt.',
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
    // Issue #287 — the buyer whose order exists.
    'checkout.paymentFailure.title.failed': 'Płatność nie doszła do skutku',
    'checkout.paymentFailure.title.cancelled': 'Płatność nie została dokończona',
    'checkout.paymentFailure.orderPlacedPrefix': 'Twoje zamówienie ',
    'checkout.paymentFailure.orderPlacedSuffix':
      ' zostało złożone i czeka na opłacenie. Nic nie zostało obciążone.',
    'checkout.paymentFailure.failedBody': 'Operator płatności nie przyjął tej płatności.',
    'checkout.paymentFailure.cancelledBody':
      'Płatność została przerwana przed jej dokończeniem, więc nic nie zostało obciążone.',
    'checkout.paymentFailure.payAgain': 'Zapłać ponownie za to zamówienie',
    'checkout.paymentFailure.retryHint':
      'Możesz ponownie rozpocząć płatność za to samo zamówienie.',
    'checkout.paymentFailure.noRetryHint':
      'Tego zamówienia nie można teraz opłacić online. Otwórz je, aby zobaczyć, co dalej.',
    'checkout.paymentFailure.viewOrder': 'Zobacz szczegóły zamówienia',
    'checkout.paymentFailure.allOrders': 'Wszystkie zamówienia',
    'checkout.paymentPending.title': 'Potwierdzamy Twoją płatność',
    'checkout.paymentPending.orderNumberPrefix': 'Numer Twojego zamówienia to ',
    'checkout.paymentPending.placed':
      'Twoje zamówienie zostało złożone. Nie musisz nic więcej robić — czekamy na potwierdzenie płatności od operatora, co zwykle trwa kilka sekund.',
    'checkout.paymentPending.stillWaiting':
      'Trwa to dłużej niż zwykle. Wyślemy e-mail, gdy tylko płatność zostanie potwierdzona; aktualny stan zawsze widać na stronie zamówienia.',
    'checkout.paymentPending.checkAgain': 'Sprawdź ponownie',
    'checkout.paymentPending.viewOrder': 'Zobacz szczegóły zamówienia',
    'order.payment.retry.cta': 'Zaplac ponownie',
    'order.payment.retry.hint':
      'Platnosc nie doszla do skutku. Nic nie zostalo obciazone — mozesz oplacic to zamowienie ponownie.',
    'order.payment.retry.inProgress':
      'Dla tego zamowienia trwa juz platnosc. Dokoncz ja na stronie platnosci albo poczekaj, az wygasnie, zanim rozpoczniesz nowa.',
    'order.payment.retry.failed': 'Nie udalo sie rozpoczac platnosci. Sprobuj ponownie za chwile.',
    'order.cancel.cta': 'Anuluj zamowienie',
    'order.cancel.hint':
      'To zamowienie nie zostalo jeszcze oplacone i nie zaczelismy go realizowac, wiec mozesz je anulowac. Zarezerwowany towar wroci od razu na stan.',
    'order.cancel.failed': 'Nie udalo sie anulowac tego zamowienia. Skontaktuj sie z nami, pomozemy.',
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
    'checkout.address.billingCompanyTitle': 'Dane firmy do rozliczenia',
    'checkout.address.billingCompanyHint':
      'Domyslnie dane Twojej organizacji. Mozesz je nadpisac dla tego zamowienia.',
    'checkout.address.companyName': 'Nazwa firmy',
    'checkout.address.taxId': 'NIP',
    // Feature 063 — TPay.
    'tpay.redirect.notice':
      'Po kliknięciu „Złóż zamówienie” zostaniesz przekierowany do TPay, aby bezpiecznie dokończyć płatność.',
    'tpay.pay.title': 'Dokończ płatność',
    'tpay.pay.subtitle': 'Podaj dane płatności, aby zakończyć zamówienie.',
    'tpay.blik.label': 'Kod BLIK',
    'tpay.blik.placeholder': '6-cyfrowy kod',
    'tpay.blik.invalid': 'Podaj prawidłowy 6-cyfrowy kod BLIK.',
    'tpay.blik.submit': 'Zapłać BLIKIEM',
    'tpay.blik.oneClick': 'Zapłać BLIK One Click',
    'tpay.blik.registerHint': 'Zapamiętaj do BLIK One Click',
    'tpay.blik.forget': 'Zapomnij BLIK One Click',
    'tpay.blik.multiAppFallback':
      'Potwierdź płatność w aplikacji bankowej albo wpisz kod BLIK.',
    'tpay.blik.accountTitle': 'BLIK One Click',
    'tpay.blik.accountRegistered':
      'Włączone. Przy kolejnych zamówieniach możesz płacić BLIKIEM bez kodu 6-cyfrowego — wystarczy potwierdzenie w aplikacji banku.',
    'tpay.blik.accountNotRegistered':
      'Jeszcze nie włączone. Przy płatności podaj kod BLIK (na sandboxie: zaczyna się od 777), zaznacz „Zapamiętaj do BLIK One Click” i dokończ płatność. Po udanej płatności One Click pojawi się tutaj.',
    'tpay.card.number': 'Numer karty',
    'tpay.card.expiry': 'Ważność (MM/RR)',
    'tpay.card.cvc': 'CVC',
    'tpay.card.submit': 'Zapłać kartą',
    'tpay.card.save': 'Zapisz tę kartę',
    'tpay.card.savedListLabel': 'Zapisane karty',
    'tpay.card.savedLabel': 'Zapisana karta',
    'tpay.card.paySaved': 'Zapłać zapisaną kartą',
    'tpay.card.remove': 'Usuń',
    'tpay.card.empty': 'Brak zapisanych kart.',
    'tpay.card.encryptError': 'Nie udało się zaszyfrować danych karty. Sprawdź klucz RSA w ustawieniach TPay i spróbuj ponownie.',
    'tpay.card.rsaMissing': 'Płatność kartą wymaga klucza RSA. Dodaj go w Admin → ustawienia TPay.',
    'tpay.card.fieldset': 'Dane karty',
    'tpay.card.orNew': 'Albo zapłać nową kartą',
    'tpay.card.processing': 'Przetwarzanie…',
    'tpay.card.checkDetails': 'Sprawdź dane karty i spróbuj ponownie.',
    'tpay.card.numberIncomplete': 'Podaj pełny numer karty.',
    'tpay.card.numberInvalid': 'Numer karty jest nieprawidłowy.',
    'tpay.card.expiryIncomplete': 'Podaj pełną datę ważności.',
    'tpay.card.expiryInvalid': 'Data ważności karty jest nieprawidłowa.',
    'tpay.card.expiryPast': 'Karta jest przeterminowana.',
    'tpay.card.cvcIncomplete': 'Podaj kod CVC karty.',
    'tpay.card.cvcInvalid': 'Kod CVC jest niekompletny.',
    'tpay.3ds.hint': 'Zostaniesz przekierowany, aby dokończyć weryfikację 3-D Secure.',
    'tpay.terms.label': 'Regulamin i klauzula informacyjna TPay',
    'tpay.pay.failure': 'Płatność nie powiodła się. Spróbuj ponownie.',
    'tpay.pay.retry': 'Spróbuj ponownie',
    'tpay.bank.redirectHint':
      'Dokończ płatność na stronie TPay, jeśli nie nastąpiło automatyczne przekierowanie.',
    // Feature 065 — PayU.
    'payu.redirect.notice':
      'Po kliknięciu „Złóż zamówienie” zostaniesz przekierowany do PayU, aby bezpiecznie dokończyć płatność.',
    'payu.pay.title': 'Dokończ płatność',
    'payu.pay.subtitle': 'Podaj dane płatności, aby zakończyć zamówienie.',
    'payu.blik.label': 'Kod BLIK',
    'payu.blik.placeholder': '6-cyfrowy kod',
    'payu.blik.invalid': 'Podaj prawidłowy 6-cyfrowy kod BLIK.',
    'payu.blik.submit': 'Zapłać BLIKIEM',
    'payu.blik.oneClick': 'Zapłać BLIK One Click',
    'payu.blik.registerHint': 'Zapamiętaj do BLIK One Click',
    'payu.blik.forget': 'Zapomnij BLIK One Click',
    'payu.blik.multiAppFallback':
      'Potwierdź płatność w aplikacji bankowej albo wpisz kod BLIK.',
    'payu.blik.accountTitle': 'BLIK One Click',
    'payu.blik.accountRegistered':
      'Włączone. Przy kolejnych zamówieniach możesz płacić BLIKIEM bez kodu 6-cyfrowego — wystarczy potwierdzenie w aplikacji banku.',
    'payu.blik.accountNotRegistered':
      'Jeszcze nie włączone. Przy płatności podaj kod BLIK, zaznacz „Zapamiętaj do BLIK One Click” i dokończ płatność. Po udanej płatności One Click pojawi się tutaj.',
    'payu.card.savedListLabel': 'Zapisane karty',
    'payu.card.savedLabel': 'Zapisana karta',
    'payu.card.paySaved': 'Zapłać zapisaną kartą',
    'payu.card.remove': 'Usuń',
    'payu.card.empty': 'Brak zapisanych kart.',
    'payu.card.save': 'Zapisz tę kartę',
    'payu.card.fieldset': 'Dane karty',
    'payu.card.orNew': 'Albo zapłać nową kartą',
    'payu.card.submit': 'Zapłać kartą',
    'payu.card.processing': 'Przetwarzanie…',
    'payu.card.numberPlaceholder': 'Numer karty',
    'payu.card.widgetLoading': 'Ładowanie bezpiecznego formularza karty…',
    'payu.card.tokenizeError': 'Nie udało się przetworzyć danych karty. Sprawdź je i spróbuj ponownie.',
    'payu.card.tokenMissing': 'Podaj token karty, aby kontynuować.',
    'payu.card.fallbackLabel': 'Token karty',
    'payu.card.fallbackPlaceholder': 'TOKC_… / TOK_…',
    'payu.card.fallbackHint':
      'Nie udało się załadować bezpiecznego formularza karty — podaj token karty PayU bezpośrednio (np. testowy token z sandboxa).',
    'payu.3ds.hint': 'Możesz zostać przekierowany, aby dokończyć weryfikację 3-D Secure.',
    'payu.pay.failure': 'Płatność nie powiodła się. Spróbuj ponownie.',
    'payu.pay.retry': 'Spróbuj ponownie',
    'payu.bank.redirectHint':
      'Dokończ płatność na stronie PayU, jeśli nie nastąpiło automatyczne przekierowanie.',
    'payu.wallet.googlePay': 'Zapłać Google Pay',
    'payu.wallet.applePay': 'Zapłać Apple Pay',
    'payu.wallet.googleUnavailable':
      'Google Pay jest niedostępny w tej przeglądarce lub dla bieżącego POS PayU.',
    'payu.wallet.appleUnavailable':
      'Apple Pay jest niedostępny (wymagany Safari / urządzenie Apple oraz skonfigurowana tożsamość sprzedawcy).',
    // Feature 067 — Autopay.
    'autopay.redirect.notice':
      'Po kliknięciu „Złóż zamówienie” zostaniesz przekierowany do Autopay, aby bezpiecznie dokończyć płatność.',
    // Feature 086 — PayPal.
    'paypal.redirect.notice':
      'Po kliknięciu „Złóż zamówienie” zostaniesz przekierowany do PayPal, aby bezpiecznie dokończyć płatność.',
    'paypal.pay.title': 'Dokończ płatność',
    'paypal.pay.subtitle': 'Zapłać przez PayPal, aby zakończyć zamówienie.',
    'paypal.pay.loading': 'Ładowanie PayPal…',
    'paypal.pay.processing': 'Przetwarzanie płatności…',
    'paypal.pay.failure': 'Płatność nie powiodła się. Spróbuj ponownie.',
    'paypal.pay.missingClientId': 'PayPal nie jest skonfigurowany dla tego sklepu.',
    // Feature 008 — Quote Request success page.
    'quoteRequest.success.title': 'Dziekujemy — Twoje zapytanie ofertowe zostalo zlozone',
    'quoteRequest.success.numberPrefix': 'Numer Twojego zapytania ofertowego: ',
    'quoteRequest.success.confirmationSent':
      'Otrzymalismy je i wyslalismy e-mail z potwierdzeniem.',
    'quoteRequest.success.nextStepsHint':
      'Dzial sprzedazy przeanalizuje zapytanie i przygotuje oferte z cenami oraz warunkami. Powiadomimy Cie, gdy oferta bedzie gotowa.',
    'quoteRequest.success.viewRequest': 'Zobacz zapytanie ofertowe',
    'quoteRequest.success.allRequests': 'Wszystkie zapytania ofertowe',
    'quoteRequest.success.continueShopping': 'Kontynuuj zakupy',
    // Issue #193 — federated sign-in.
    'auth.federated.groupLabel': 'Inne sposoby logowania',
    'auth.federated.divider': 'lub',
    'auth.federated.google': 'Kontynuuj przez Google',
    'auth.federated.microsoft': 'Kontynuuj przez Microsoft',
    // Issue #194 — linked identities.
    'account.socialLinks.heading': 'Powiązane konta',
    'account.socialLinks.intro':
      'Za pomocą tych zewnętrznych kont możesz się logować. Usunięcie powiązania nie usuwa Twojego konta.',
    'account.socialLinks.linkedOn': 'Powiązano',
    'account.socialLinks.remove': 'Usuń',
    'account.socialLinks.lastCredential':
      'To ostatnia tożsamość logowania powiązana z Twoim kontem, a konto nie ma zapisanego hasła — usunięcie jej teraz mogłoby trwale odciąć Ci dostęp. Najpierw ustaw hasło, a potem będziesz móc usunąć to powiązanie.',
    'account.socialLinks.setPassword': 'Ustaw hasło',
    'compare.shared.pricesYours': 'Pokazane ceny dotyczą Twojej organizacji.',
    'compare.shared.pricesChannel':
      'Pokazane ceny to ceny standardowe tego sklepu. Zaloguj się, aby zobaczyć ceny uzgodnione dla Twojej organizacji.',
    'compare.shared.hiddenProducts':
      'Część produktów z tego zestawienia nie jest dostępna dla Twojego konta i nie jest tutaj pokazana.',
    'orders.paymentReturn.returned':
      'Wracasz od operatora płatności. Twoje zamówienie zostało złożone; czekamy jeszcze na potwierdzenie płatności — wynik pojawi się na tej stronie, gdy tylko dotrze.',
    'orders.paymentReturn.cancelled':
      'Płatność nie została jeszcze wykonana. Twoje zamówienie zostało złożone i czeka na opłacenie — nic nie zostało obciążone.',
    'orders.paymentReturn.failed':
      'Płatność nie doszła do skutku. Twoje zamówienie zostało złożone i nadal czeka na opłacenie, więc możesz spróbować ponownie.',
    'orders.actionFailed': 'Nie udało się wykonać tej operacji.',
  },
};

export function tForLocale(locale: string): (key: MessageKey) => string {
  const dictionary = MESSAGES[locale] ?? MESSAGES['en-US']!;
  return (key) => dictionary[key] ?? MESSAGES['en-US']![key] ?? key;
}
