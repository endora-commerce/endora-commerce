import { defineUrlErrors } from '../url-errors';

/**
 * What `/orders/:id?error=<code>` says (issue #745) — the order page's actions
 * (comment, order again, order again as a quote request, cancel, pay again)
 * and the checkout failure page's pay-again, which lands here. **A code
 * travels, never a sentence** — see `lib/url-errors.ts`.
 */
export const ORDER_ERRORS = defineUrlErrors({
  api: {
    ORDER_NOT_CANCELLABLE: 'account.order.error.ORDER_NOT_CANCELLABLE',
    ORDER_COMMENTS_CLOSED: 'account.order.error.ORDER_COMMENTS_CLOSED',
    ORDER_CLONE_NO_LINES: 'account.order.error.ORDER_CLONE_NO_LINES',
    PAYMENT_NOT_DUE: 'account.order.error.PAYMENT_NOT_DUE',
    PAYMENT_ORDER_CLOSED: 'account.order.error.PAYMENT_ORDER_CLOSED',
    PAYMENT_ADAPTER_UNAVAILABLE: 'account.order.error.PAYMENT_ADAPTER_UNAVAILABLE',
    ORGANIZATION_PERMISSION_REQUIRED: 'commerce.error.ORGANIZATION_PERMISSION_REQUIRED',
  },
  own: {
    COMMENT_FAILED: 'account.order.comments.failed',
    REORDER_FAILED: 'account.order.reorderFailed',
    REORDER_TO_QUOTE_FAILED: 'account.order.reorderToQuoteFailed',
    CANCEL_FAILED: 'order.cancel.failed',
    PAYMENT_RETRY_FAILED: 'order.payment.retry.failed',
    PAYMENT_RETRY_IN_PROGRESS: 'order.payment.retry.inProgress',
    FAILED: 'account.order.error.FAILED',
  },
  generic: 'FAILED',
});

/** Where a pay-again that opened no gateway page lands: the order, saying why. */
export function paymentRetryRefusedHref(orderId: string, opened: boolean): string {
  return `/orders/${orderId}?error=${opened ? 'PAYMENT_RETRY_FAILED' : 'PAYMENT_RETRY_IN_PROGRESS'}`;
}
