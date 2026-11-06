import { defineUrlErrors } from '../url-errors';

/**
 * What the customer registration and password-reset pages say about a refusal
 * (issue #745). **A code travels, never a sentence** — see `lib/url-errors.ts`.
 */
const ACCOUNT_API_ERROR_KEYS = {
  EMAIL_ALREADY_REGISTERED: 'auth.error.EMAIL_ALREADY_REGISTERED',
  TOKEN_INVALID_OR_EXPIRED: 'auth.error.TOKEN_INVALID_OR_EXPIRED',
  VALIDATION_FAILED: 'auth.error.VALIDATION_FAILED',
  CUSTOMER_AUTHENTICATION_THROTTLED: 'auth.error.CUSTOMER_AUTHENTICATION_THROTTLED',
  SALES_CHANNEL_NOT_PERMITTED: 'auth.login.channelNotPermitted',
} as const;

/** `/register-customer?error=<code>`. */
export const REGISTER_CUSTOMER_ERRORS = defineUrlErrors({
  api: ACCOUNT_API_ERROR_KEYS,
  own: { REGISTER_FAILED: 'auth.register.failed' },
  generic: 'REGISTER_FAILED',
});

/** `/password-reset/request?error=<code>` — only the request limit is ever said (no enumeration). */
export const RESET_REQUEST_ERRORS = defineUrlErrors({
  api: { CUSTOMER_AUTHENTICATION_THROTTLED: 'auth.error.CUSTOMER_AUTHENTICATION_THROTTLED' },
  own: { REQUEST_FAILED: 'auth.passwordReset.request.failed' },
  generic: 'REQUEST_FAILED',
});

/** `/password-reset/confirm?token=…&error=<code>`. */
export const RESET_CONFIRM_ERRORS = defineUrlErrors({
  api: ACCOUNT_API_ERROR_KEYS,
  own: { RESET_FAILED: 'auth.passwordReset.confirm.failed' },
  generic: 'RESET_FAILED',
});

/**
 * `/invitations/:token/accept?error=<code>` (issue #808): the accept endpoint's
 * refusals only. A failure after the account exists goes to `/login` with a
 * sign-in code (`SIGN_IN_TO_CONTINUE`, architect ruling on #822).
 */
export const INVITATION_ACCEPT_ERRORS = defineUrlErrors({
  api: {
    TOKEN_INVALID_OR_EXPIRED: ACCOUNT_API_ERROR_KEYS.TOKEN_INVALID_OR_EXPIRED,
    EMAIL_ALREADY_REGISTERED: ACCOUNT_API_ERROR_KEYS.EMAIL_ALREADY_REGISTERED,
    VALIDATION_FAILED: ACCOUNT_API_ERROR_KEYS.VALIDATION_FAILED,
  },
  own: { INVITATION_FAILED: 'auth.invitation.failed' },
  generic: 'INVITATION_FAILED',
});

/** A code {@link INVITATION_ACCEPT_ERRORS} words — the only thing its `?error=` carries. */
export type InvitationAcceptCode = ReturnType<typeof INVITATION_ACCEPT_ERRORS.failureCode>;
