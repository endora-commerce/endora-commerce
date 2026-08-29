import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  MFA_SETTING_CODES,
} from '@endora-commerce/contracts';

/**
 * MFA module — feature 042.
 *
 * Owns two-factor authentication (TOTP + recovery codes) and federated
 * sign-in (Google / Microsoft) across the Storefront and Admin UI, plus the
 * per-surface / per-channel / per-organization enablement & enforcement
 * policy and Platform-Admin 2FA reset.
 *
 * `mfa` is a singular acronym module name — a documented Principle VI
 * carve-out (see specs/042-mfa-authentication/plan.md Complexity Tracking).
 *
 * Provider client id/secret are supplied via backend config/env, NOT settings.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'mfa',
  groups: [{ code: 'mfa', name: 'Security / MFA' }],
  settings: [
    {
      // Feature 074 — the operator's activation control. Platform-wide, and
      // never channel-scoped even though four of the policy switches below are:
      // activation stops at `global_value` → `default_value` by construction.
      code: MFA_SETTING_CODES.ACTIVATION,
      name: 'MFA enabled',
      description:
        'Switches the whole module on or off: two-factor enrolment and challenges, the federated sign-in buttons, the per-organization enforcement policy and the admin reset screen. Nothing is dropped — enrolled secrets, recovery codes and every policy value stay in the database and apply again exactly as before when you switch it back on.',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: MFA_SETTING_CODES.ADMIN_TOTP_ENABLED,
      name: 'Admin UI — allow 2FA',
      description: 'When enabled, admin users may set up TOTP two-factor authentication.',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED,
      name: 'Admin UI — enforce 2FA',
      description:
        'When enabled, admin users must complete 2FA setup before accessing the Admin UI.',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: MFA_SETTING_CODES.STOREFRONT_TOTP_ENABLED,
      name: 'Storefront — allow 2FA',
      description:
        'When enabled, customers may set up TOTP two-factor authentication. Can be overridden per sales channel.',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED,
      name: 'Storefront — enforce 2FA',
      description:
        'When enabled, customers must complete 2FA setup before using the storefront. Can be overridden per sales channel.',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: MFA_SETTING_CODES.ADMIN_GOOGLE_ENABLED,
      name: 'Admin UI — Google sign-in',
      description: 'Allow admin users to sign in with Google (existing admin users only).',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: MFA_SETTING_CODES.ADMIN_MICROSOFT_ENABLED,
      name: 'Admin UI — Microsoft sign-in',
      description: 'Allow admin users to sign in with Microsoft (existing admin users only).',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: MFA_SETTING_CODES.STOREFRONT_GOOGLE_ENABLED,
      name: 'Storefront — Google sign-in',
      description:
        'Allow customers to sign in with Google. Can be overridden per sales channel.',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: MFA_SETTING_CODES.STOREFRONT_MICROSOFT_ENABLED,
      name: 'Storefront — Microsoft sign-in',
      description:
        'Allow customers to sign in with Microsoft. Can be overridden per sales channel.',
      groupCode: 'mfa',
      valueType: 'boolean',
      defaultValue: false,
    },
  ],
});

/** Exposed for the settings ManifestReconciler (boot + test harness). */
export const mfaSettingsManifest = settings;

export const manifest = defineModuleManifest({
  id: 'mfa',
  name: 'MFA',
  description:
    'Two-factor authentication (TOTP + recovery codes) and Google/Microsoft sign-in, with per-scope enablement/enforcement and admin reset.',
  version: '1.0.0',
  // `auth` owns `authSessionPort`, `requireAdmin` and the customer guard this
  // module resolves; feature 072 made those container resolutions rather than
  // constructor arguments, so the edge is real now and has to be declared.
  // Feature 075 Phase C turned the session edge into the published port: the
  // second factor mints its session over `authSessionPort`, so no `Session`
  // entity and no `SessionService` class crosses into this module any more.
  dependencies: ['admin_users', 'customer_accounts', 'organizations', 'settings', 'auth'],
  settings,
  // Feature 074 (Constitution XVII) — a control this module never had, so an
  // operator could not decline it at all. Two-factor authentication is a client
  // *security policy*, not a platform floor: a deployment behind a corporate
  // SSO gateway or a VPN may run without it. The eight policy switches above
  // stay where they are — they choose which factor a surface offers, which is a
  // different question from whether the module is present. Default `true` so
  // that merging this changes no deployment's state (FR-012).
  activation: { settingCode: MFA_SETTING_CODES.ACTIVATION, default: true },
  /**
   * The operator-visible error codes this module owns (feature 090, D-182,
   * `specs/090-module-owned-error-codes/`).
   *
   * The list is answer-preserving, not a judgement (§6.2 and §6.5), and it was
   * not written by hand: it is the verbatim output of the runbook's step-1
   * derivation over the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`, which records
   * what the prefix chain in `@endora-commerce/mod-i18n` answered at
   * `49f3c6817`. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **No shadow reaches this module, and that is a conclusion rather than a
   * premise.** The chain is an ordered `if` and an earlier rule silently claims
   * a later one's codes — it cost `inventory` two and gave `catalog` four
   * (trap T1). Here the whole chain was read: the `MFA_` rule is second from
   * last, no rule above it names an `MFA_`-prefixed code, and no misc set holds
   * one, so the source reading and the answer reading coincide. The derivation
   * was still run from the answer.
   *
   * **`TWO_FACTOR_REQUIRED` and `TWO_FACTOR_REQUIRED_BY_ROLE` are the codes a
   * reader will look for here and not find** (trap T2). Both name this module's
   * subject and neither carries the prefix, so they fall off the end of the
   * chain to `core`, which is what the capture records. Whether that is the
   * right owner is exactly the question §6.5 puts out of scope.
   *
   * **All ten are raised, and the spelling is why that had to be measured.**
   * Nine of them are thrown as a bare string literal in the second argument of
   * `new HttpError` — `throw new HttpError(409, 'MFA_ALREADY_ENROLLED', …)` —
   * and only `MFA_SOCIAL_LAST_CREDENTIAL` is thrown as `ERROR_CODES.<CODE>`.
   * Fourteen raise sites over `routes.public.ts`, `routes.self-service.ts`,
   * `services/mfa-enrolment-service.ts` and `services/social-link-service.ts`,
   * every code covered by at least one. A scan keyed on the `ERROR_CODES.`
   * spelling sees one of the fourteen.
   *
   * No `tokens`, and it is derived rather than assumed. `refusalToken`
   * (`packages/platform/src/http/error-envelope.ts`) reads `details.code` and
   * nothing else, and **not one of the fourteen sites passes a fourth argument
   * at all**, so there is nothing for it to read. The runbook's §5 raise-site
   * scan agrees from the whole tree — it attributes the ten token-carrying
   * codes to `core`, `invoices` and `carts` and names none of these — and so
   * does the bundle from the other direction: ten `errors.<CODE>` keys in `en`
   * and ten in `pl`, exactly these ten, and no `errors.<CODE>.<token>` key.
   * There is no dead sentence in either direction and none of the ten is an
   * `UNTRANSLATED_ERROR_CODES` entry.
   */
  errorCodes: [
    { code: 'MFA_ALREADY_ENROLLED' },
    { code: 'MFA_INVALID_CHALLENGE' },
    { code: 'MFA_INVALID_CODE' },
    { code: 'MFA_NOT_ENABLED' },
    { code: 'MFA_NO_ACTIVE_ENROLMENT' },
    { code: 'MFA_NO_PENDING_ENROLMENT' },
    { code: 'MFA_REAUTH_REQUIRED' },
    { code: 'MFA_SOCIAL_LAST_CREDENTIAL' },
    { code: 'MFA_TOO_MANY_ATTEMPTS' },
    { code: 'MFA_WRONG_SURFACE' },
  ],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'mfa:reset', label: "Reset a user's 2FA" },
    { code: 'mfa:manage', label: 'Manage 2FA policies and organization enforcement' },
  ],
});
