import type { FederatedSignInErrorCode } from '@endora-commerce/contracts';
import type { MessageKey } from '../i18n/messages';
import { tForLocale } from '../i18n/messages';
import { defineUrlErrors } from '../url-errors';
import { MFA_API_ERROR_KEYS } from './mfa-errors';

/**
 * How a refused sign-in reaches the sign-in screens
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §3; issue #745).
 *
 * **A code travels, never a sentence** — see `lib/url-errors.ts`. The sign-in
 * screens carry their error in `?error=`, so whatever they print from it is
 * text anyone could put there with a crafted link. Each screen names the codes
 * it knows in its own language and reads anything else as its own failure.
 *
 * A refusal because the account's Organization may not use this store can come
 * from three places — the password step, the second factor and the federated
 * callback, which the backend redirects with `?error=sales_channel_not_permitted`
 * — so it travels as that stable lower-case code, which the callback shares.
 *
 * The federated callback sends only codes (`federatedSignInErrorCodeSchema`, issue #789);
 * {@link FEDERATED_CALLBACK_ERROR_KEYS} words every one of them, and the contract's type
 * makes a code added there a compile error here until it has a wording.
 */

/** The `?error=` value of a sign-in the store refused. The federated callback uses it too. */
export const CHANNEL_NOT_PERMITTED_ERROR = 'sales_channel_not_permitted';

/**
 * The `?error=` value of a federated sign-up the store refused: no account
 * exists yet and the store is closed to anonymous visitors, so none is created.
 */
export const CHANNEL_SIGN_IN_REQUIRED_ERROR = 'sales_channel_sign_in_required';

const SIGN_IN_API_ERROR_KEYS = {
  ...MFA_API_ERROR_KEYS,
  INVALID_CREDENTIALS: 'auth.error.INVALID_CREDENTIALS',
  ACCOUNT_BLOCKED: 'auth.error.ACCOUNT_BLOCKED',
  CUSTOMER_AUTHENTICATION_THROTTLED: 'auth.error.CUSTOMER_AUTHENTICATION_THROTTLED',
  CUSTOMER_AUTHENTICATION_UNAVAILABLE: 'auth.error.CUSTOMER_AUTHENTICATION_UNAVAILABLE',
  // Carried as {@link CHANNEL_NOT_PERMITTED_ERROR}, the callback's spelling (`signInErrorParam`).
  SALES_CHANNEL_NOT_PERMITTED: 'auth.login.channelNotPermitted',
} as const satisfies Record<string, MessageKey>;

/** `/login?error=` from `mfa`'s federated callback (`routes.oauth.ts`, `loginRedirect`). */
const FEDERATED_CALLBACK_ERROR_KEYS = {
  unknown_provider: 'auth.federated.error.unknownProvider',
  provider_unavailable: 'auth.federated.error.providerUnavailable',
  sign_in_cancelled: 'auth.federated.error.cancelled',
  sign_in_expired: 'auth.federated.error.expired',
  sign_in_failed: 'auth.login.failed',
  email_unverified: 'auth.federated.error.emailUnverified',
  no_matching_account: 'auth.federated.error.noMatchingAccount',
  account_blocked: 'auth.error.ACCOUNT_BLOCKED',
  registration_disabled_in_channel: 'auth.federated.error.registrationDisabledInChannel',
  mfa_setup_required: 'auth.federated.error.setupRequired',
  [CHANNEL_SIGN_IN_REQUIRED_ERROR]: 'auth.login.signInRequired',
  [CHANNEL_NOT_PERMITTED_ERROR]: 'auth.login.channelNotPermitted',
} as const satisfies Record<FederatedSignInErrorCode, MessageKey>;

const SIGN_IN_OWN_ERROR_KEYS = {
  ...FEDERATED_CALLBACK_ERROR_KEYS,
  LOGIN_FAILED: 'auth.login.failed',
  SETUP_START_FAILED: 'auth.login.setupStartFailed',
  MFA_VERIFY_FAILED: 'auth.mfa.verifyFailed',
  MFA_SETUP_FAILED: 'auth.mfaSetup.failed',
  // The invitation page's redirect when its form arrives without a token (issue #808).
  INVITATION_INVALID: 'auth.invitation.invalidLink',
} as const satisfies Record<string, MessageKey>;

/** `/login?error=` — the password step's and the federated callback's codes. */
export const SIGN_IN_ERRORS = defineUrlErrors({
  api: SIGN_IN_API_ERROR_KEYS,
  own: SIGN_IN_OWN_ERROR_KEYS,
  generic: 'LOGIN_FAILED',
});

/** `/login/mfa?error=` — the second factor's. */
export const MFA_STEP_ERRORS = defineUrlErrors({
  api: SIGN_IN_API_ERROR_KEYS,
  own: SIGN_IN_OWN_ERROR_KEYS,
  generic: 'MFA_VERIFY_FAILED',
});

/** `/login/setup?error=` — the forced two-step setup's. */
export const MFA_SETUP_ERRORS = defineUrlErrors({
  api: SIGN_IN_API_ERROR_KEYS,
  own: SIGN_IN_OWN_ERROR_KEYS,
  generic: 'MFA_SETUP_FAILED',
});

export type SignInOwnCode = keyof typeof SIGN_IN_OWN_ERROR_KEYS;

/** The `?error=` value for a failed sign-in step: always a code. */
export function signInErrorParam(err: unknown, fallback: SignInOwnCode): string {
  const code = SIGN_IN_ERRORS.failureCode(err, fallback);
  return code === 'SALES_CHANNEL_NOT_PERMITTED' ? CHANNEL_NOT_PERMITTED_ERROR : code;
}

/** What `/login` shows for `?error=`: the wording of a code it knows, or its failure. */
export function signInErrorMessage(error: string | undefined, locale: string): string | undefined {
  if (error === undefined || error === '') return undefined;
  return tForLocale(locale)(SIGN_IN_ERRORS.errorKey(error)!);
}
