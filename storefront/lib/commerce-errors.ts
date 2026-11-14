import type { MessageKey } from './i18n/messages';
import { defineUrlErrors } from './url-errors';

/**
 * What the commerce pages' `?error=` / `?reason=` say (issue #745): `/cart`
 * (its own actions, and the product page's grouped, bundle and one-click
 * actions, which land there), `/checkout`, `/checkout/failure` and
 * `/quick-order`. **A code travels, never a sentence** — see
 * `lib/url-errors.ts`.
 *
 * The API codes are the ones the cart, order-placement and quick-order routes
 * answer that a buyer can act on. The backend's sentences for them carry
 * figures and names (a product, a minimum, a credit limit); a code cannot, so
 * the storefront's sentence says what went wrong without them. Every other
 * refusal reads as the failing action's own sentence.
 */
const COMMERCE_API_ERROR_KEYS = {
  CART_EMPTY: 'commerce.error.CART_EMPTY',
  CART_LINE_CAP_EXCEEDED: 'commerce.error.CART_LINE_CAP_EXCEEDED',
  CART_PRODUCT_QUOTE_ONLY: 'commerce.error.CART_PRODUCT_QUOTE_ONLY',
  CART_PRODUCT_UNPRICED: 'commerce.error.CART_PRODUCT_UNPRICED',
  CART_QUANTITY_INVALID: 'commerce.error.CART_QUANTITY_INVALID',
  LINE_QUANTITY_EXCEEDED: 'commerce.error.LINE_QUANTITY_EXCEEDED',
  CART_PRICE_CHANGED: 'commerce.error.CART_PRICE_CHANGED',
  CART_APPROVAL_NOT_REQUIRED: 'commerce.error.CART_APPROVAL_NOT_REQUIRED',
  CART_APPROVAL_ALREADY_SUBMITTED: 'commerce.error.CART_APPROVAL_ALREADY_SUBMITTED',
  PRODUCT_NOT_FOUND: 'commerce.error.PRODUCT_NOT_FOUND',
  PRODUCT_BELOW_MINIMUM_QUANTITY: 'commerce.error.PRODUCT_BELOW_MINIMUM_QUANTITY',
  PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY: 'commerce.error.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY',
  STOCK_UNAVAILABLE: 'commerce.error.STOCK_UNAVAILABLE',
  ORDER_CART_APPROVAL_REQUIRED: 'commerce.error.ORDER_CART_APPROVAL_REQUIRED',
  'ORDER_CART_APPROVAL_REQUIRED.cart_approval_not_submitted':
    'commerce.error.ORDER_CART_APPROVAL_REQUIRED.cart_approval_not_submitted',
  'ORDER_CART_APPROVAL_REQUIRED.cart_approval_pending': 'commerce.error.ORDER_CART_APPROVAL_REQUIRED.cart_approval_pending',
  'ORDER_CART_APPROVAL_REQUIRED.cart_approval_rejected': 'commerce.error.ORDER_CART_APPROVAL_REQUIRED.cart_approval_rejected',
  ORDER_DELIVERY_METHOD_UNAVAILABLE: 'commerce.error.ORDER_DELIVERY_METHOD_UNAVAILABLE',
  'ORDER_DELIVERY_METHOD_UNAVAILABLE.delivery_method_not_allowed_for_organization':
    'commerce.error.ORDER_DELIVERY_METHOD_UNAVAILABLE.delivery_method_not_allowed_for_organization',
  'ORDER_DELIVERY_METHOD_UNAVAILABLE.delivery_method_not_in_sales_channel':
    'commerce.error.ORDER_DELIVERY_METHOD_UNAVAILABLE.delivery_method_not_in_sales_channel',
  ORDER_PAYMENT_METHOD_UNAVAILABLE: 'commerce.error.ORDER_PAYMENT_METHOD_UNAVAILABLE',
  'ORDER_PAYMENT_METHOD_UNAVAILABLE.payment_method_not_allowed_for_organization':
    'commerce.error.ORDER_PAYMENT_METHOD_UNAVAILABLE.payment_method_not_allowed_for_organization',
  'ORDER_PAYMENT_METHOD_UNAVAILABLE.payment_method_not_in_sales_channel':
    'commerce.error.ORDER_PAYMENT_METHOD_UNAVAILABLE.payment_method_not_in_sales_channel',
  ORDER_SALES_CHANNEL_MISMATCH: 'commerce.error.ORDER_SALES_CHANNEL_MISMATCH',
  ORDER_SALES_CHANNEL_NOT_ALLOWED: 'commerce.error.ORDER_SALES_CHANNEL_NOT_ALLOWED',
  ORDER_BELOW_MINIMUM_VALUE: 'commerce.error.ORDER_BELOW_MINIMUM_VALUE',
  LIMIT_INSUFFICIENT: 'commerce.error.LIMIT_INSUFFICIENT',
  CREDIT_LIMIT_NOT_GRANTED: 'commerce.error.CREDIT_LIMIT_NOT_GRANTED',
  CURRENCY_MISMATCH: 'commerce.error.CURRENCY_MISMATCH',
  ADDRESS_NOT_OWNED: 'commerce.error.ADDRESS_NOT_OWNED',
  ORGANIZATION_SUSPENDED: 'commerce.error.ORGANIZATION_SUSPENDED',
  QUOTE_VALIDITY_ENDED: 'commerce.error.QUOTE_VALIDITY_ENDED',
  'QUOTE_VALIDITY_ENDED.lapsed': 'commerce.error.QUOTE_VALIDITY_ENDED.lapsed',
  'QUOTE_VALIDITY_ENDED.withdrawn': 'commerce.error.QUOTE_VALIDITY_ENDED.withdrawn',
  'QUOTE_VALIDITY_ENDED.unavailable': 'commerce.error.QUOTE_VALIDITY_ENDED.unavailable',
  ORGANIZATION_PERMISSION_REQUIRED: 'commerce.error.ORGANIZATION_PERMISSION_REQUIRED',
  // Issue #641 — one-click buy refused by the setting or the buyer's defaults; the token is the reason.
  ONE_CLICK_UNAVAILABLE: 'commerce.error.ONE_CLICK_UNAVAILABLE',
  'ONE_CLICK_UNAVAILABLE.setting_disabled': 'commerce.error.ONE_CLICK_UNAVAILABLE.setting_disabled',
  'ONE_CLICK_UNAVAILABLE.missing_defaults': 'commerce.error.ONE_CLICK_UNAVAILABLE.missing_defaults',
  'VALIDATION_FAILED.too_many_items': 'commerce.error.VALIDATION_FAILED.too_many_items',
  // `specs/154-sales-channel-access/` — the store refused the shopper rather than the action.
  SALES_CHANNEL_NOT_PERMITTED: 'auth.login.channelNotPermitted',
  SALES_CHANNEL_SIGN_IN_REQUIRED: 'access.signInRequired',
} as const satisfies Record<string, MessageKey>;

/** `/cart?error=<code>` — the cart's actions and the product page's redirecting ones. */
export const CART_ERRORS = defineUrlErrors({
  api: COMMERCE_API_ERROR_KEYS,
  own: {
    MISSING_PRODUCT: 'product.addToCartFailed',
    ADD_TO_CART_FAILED: 'product.addToCartFailed',
    ONE_CLICK_FAILED: 'product.oneClickFailed',
    QUANTITY_INVALID: 'cart.line.quantityInvalid',
    UPDATE_FAILED: 'cart.line.updateFailed',
    REMOVE_FAILED: 'cart.line.removeFailed',
    SIGN_IN_TO_SAVE: 'commerce.cart.error.signInToSave',
    NO_SHOPPING_LIST: 'commerce.cart.error.noShoppingList',
    SAVE_TO_LIST_FAILED: 'commerce.cart.error.saveToListFailed',
    APPLY_COUPON_FAILED: 'commerce.cart.error.applyCouponFailed',
    CONVERT_FAILED: 'commerce.cart.error.convertFailed',
    SUBMIT_FOR_APPROVAL_FAILED: 'cart.submitForApprovalFailed',
    FAILED: 'commerce.cart.error.FAILED',
  },
  generic: 'FAILED',
});

/** `/checkout/failure?reason=<code>` — the placement's refusal. */
export const CHECKOUT_ERRORS = defineUrlErrors({
  api: COMMERCE_API_ERROR_KEYS,
  own: {
    PLACE_FAILED: 'commerce.checkout.placeFailed',
    FAILED: 'checkout.failure.generic',
  },
  generic: 'FAILED',
});

/** `/quick-order?problem=<code>` — the page's own refusals and the import's and build's. */
export const QUICK_ORDER_ERRORS = defineUrlErrors({
  api: COMMERCE_API_ERROR_KEYS,
  own: {
    no_input: 'quickOrder.problem.no_input',
    nothing_to_build: 'quickOrder.problem.nothing_to_build',
    preview_too_large: 'quickOrder.problem.preview_too_large',
    preview_full: 'quickOrder.problem.preview_full',
    // Issue #809 — the backend keeps the preview for an hour after its last write.
    preview_expired: 'quickOrder.problem.preview_expired',
    preview_unavailable: 'quickOrder.problem.preview_unavailable',
    import_failed: 'quickOrder.problem.import_failed',
    build_failed: 'quickOrder.problem.build_failed',
  },
  // The page shows nothing for a code it does not know (`isCode`), so this is never read there.
  generic: 'build_failed',
});

/** The codes a cart line's quantity edit reports beside the line, with the minimum it carried. */
export const BELOW_MINIMUM_CODES: ReadonlySet<string> = new Set([
  'PRODUCT_BELOW_MINIMUM_QUANTITY',
  'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY',
]);
