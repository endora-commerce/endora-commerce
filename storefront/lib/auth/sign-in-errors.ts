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

const SIGN_IN_OWN_ERROR_KEYS = {
  [CHANNEL_NOT_PERMITTED_ERROR]: 'auth.login.channelNotPermitted',
  [CHANNEL_SIGN_IN_REQUIRED_ERROR]: 'auth.login.signInRequired',
  LOGIN_FAILED: 'auth.login.failed',
  SETUP_START_FAILED: 'auth.login.setupStartFailed',
  MFA_VERIFY_FAILED: 'auth.mfa.verifyFailed',
  MFA_SETUP_FAILED: 'auth.mfaSetup.failed',
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

/**
 * The sentences `mfa`'s federated callback (`routes.oauth.ts`, `loginRedirect`) still puts in
 * `/login?error=`, each mapped to this page's own wording. A sentence is only ever a lookup key
 * here — never printed — so a link carrying any other text shows the generic failure. Until the
 * callback sends codes, a sentence it changes reads as the generic failure too.
 */
const FEDERATED_CALLBACK_ERRORS: Readonly<Record<string, MessageKey>> = {
  'Unknown sign-in provider.': 'auth.federated.error.unknownProvider',
  'Sign-in with this provider is not available.': 'auth.federated.error.providerUnavailable',
  'Sign-in was cancelled or failed.': 'auth.federated.error.cancelled',
  'This sign-in attempt has expired.': 'auth.federated.error.expired',
  'Sign-in failed. Please try again.': 'auth.login.failed',
  'Your provider email is not verified.': 'auth.federated.error.emailUnverified',
  'No account matches this provider. Please contact an administrator.': 'auth.federated.error.noMatchingAccount',
  'This account has been blocked. Please contact support.': 'auth.error.ACCOUNT_BLOCKED',
  'No account found. Please create an account first.': 'auth.federated.error.noAccount',
  'Two-step verification is required for your account. Sign in with your email and password to set it up.':
    'auth.federated.error.setupRequired',
};

/** The `?error=` value for a failed sign-in step: always a code. */
export function signInErrorParam(err: unknown, fallback: SignInOwnCode): string {
  const code = SIGN_IN_ERRORS.failureCode(err, fallback);
  return code === 'SALES_CHANNEL_NOT_PERMITTED' ? CHANNEL_NOT_PERMITTED_ERROR : code;
}

/** What `/login` shows for `?error=`: a code it knows, a federated callback's sentence it knows, or its failure. */
export function signInErrorMessage(error: string | undefined, locale: string): string | undefined {
  if (error === undefined || error === '') return undefined;
  const t = tForLocale(locale);
  if (Object.hasOwn(FEDERATED_CALLBACK_ERRORS, error)) return t(FEDERATED_CALLBACK_ERRORS[error]!);
  return t(SIGN_IN_ERRORS.errorKey(error)!);
}
