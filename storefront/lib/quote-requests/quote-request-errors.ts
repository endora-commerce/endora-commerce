import { defineUrlErrors } from '../url-errors';

/**
 * What `/quote-requests/:id?error=<code>` says (issue #745) — the accept,
 * reject, order and resubmit actions. **A code travels, never a sentence** —
 * see `lib/url-errors.ts`.
 */
export const QUOTE_REQUEST_ERRORS = defineUrlErrors({
  api: {
    RFQ_EXPIRED: 'account.quoteRequest.error.RFQ_EXPIRED',
    RFQ_NOT_QUOTED: 'account.quoteRequest.error.RFQ_NOT_QUOTED',
    QUOTE_INCOMPLETE: 'account.quoteRequest.error.QUOTE_INCOMPLETE',
    VERSION_CONFLICT: 'account.quoteRequest.error.VERSION_CONFLICT',
    QUOTE_VALIDITY_ENDED: 'commerce.error.QUOTE_VALIDITY_ENDED',
    ORGANIZATION_PERMISSION_REQUIRED: 'commerce.error.ORGANIZATION_PERMISSION_REQUIRED',
    SALES_CHANNEL_NOT_PERMITTED: 'auth.login.channelNotPermitted',
  },
  own: {
    ACCEPT_FAILED: 'account.quoteRequest.acceptFailed',
    REJECT_FAILED: 'account.quoteRequest.rejectFailed',
    CONVERT_FAILED: 'account.quoteRequest.convertFailed',
    RESUBMIT_FAILED: 'account.quoteRequest.resubmitFailed',
    FAILED: 'account.quoteRequest.error.FAILED',
  },
  generic: 'FAILED',
});
