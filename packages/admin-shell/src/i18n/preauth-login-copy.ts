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
  /**
   * The hint below the form. It used to name `pnpm --filter backend run
   * admin:create`, which exists only in this repository's checkout: a
   * scaffolded instance spells it `pnpm run admin:create`, a production image
   * `node dist/cli.js admin_users create`, and the person reading a sign-in
   * screen is usually not the one with a shell at all. So it names the two
   * routes that are true everywhere and links to the page that spells the
   * command for each setting.
   */
  noAccount: 'No account yet? Ask your platform administrator, or create one from the command line:',
  noAccountLink: 'see the Getting started guide',
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

/**
 * Where `noAccountLink` points: the published guide's section on creating an
 * administrator. The public site rather than an instance's own, because an
 * instance may build no documentation site at all (`--without docs`).
 */
export const ADMIN_ACCOUNT_HELP_URL =
  'https://docs.commerce.endora.software/getting-started#creating-an-administrator';

export const appBootstrapCopy = {
  loading: 'Loading...',
} as const;
