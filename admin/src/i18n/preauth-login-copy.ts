/**
 * Copy for the screens that render **before** a session exists.
 *
 * English-only by construction, not by omission: `TranslationProvider` fetches
 * its bundles from an endpoint that needs an admin session, so the login screen
 * has no bundle to read (see the provider's `initialBundle` note). Every string
 * an authenticated admin sees goes through the module i18n bundles in `en`+`pl`
 * instead. Adding a language to this file means giving the pre-auth screen a
 * language source first — that is a feature, not a copy change.
 */
export const loginCopy = {
  title: 'B2B Admin · sign in',
  subheading: 'Use the email and password issued by your platform administrator.',
  sessionExpired: 'Session expired',
  failed: 'Sign-in failed',
  email: 'Email',
  password: 'Password',
  submitting: 'Signing in…',
  submit: 'Sign in',
  footerPrefix: 'No account yet? Run',
  footerSuffix: 'from the repository root.',
  /**
   * Issue #193 — federated sign-in. `divider` is deliberately just "or": the
   * button carries the whole intent ("Continue with Google"), so a longer rule
   * label would repeat it, and "or" is what every sign-in screen a user has
   * already met puts there (Jakob's Law).
   */
  federatedGroupLabel: 'Other sign-in options',
  federatedDivider: 'or',
  federatedGoogle: 'Continue with Google',
  federatedMicrosoft: 'Continue with Microsoft',
} as const;

export const appBootstrapCopy = {
  loading: 'Loading...',
} as const;
