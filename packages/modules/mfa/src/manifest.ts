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
  /**
   * What this module needs from the environment (`specs/117-instance-bring-up/`
   * FR-002). Only what it **owns**: its reads of platform-owned names are
   * satisfied by `packages/platform/src/env/index.ts`.
   *
   * Why each of these is not a Setting is its entry in
   * `backend/scripts/ledgers/module-environment-inputs/mfa.ts`.
   */
  env: [
    {
      name: 'ADMIN_BASE_URL',
      describes: {
        en: 'Where the admin panel is, so that a link this instance mails an administrator opens their own installation.',
        pl: 'Gdzie znajduje się panel administracyjny, aby link wysłany administratorowi otwierał jego własną instalację.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'A sign-in or recovery link mailed to an administrator points nowhere they can open — which matters most when the panel is on a host of its own.',
          pl: 'Link logowania lub odzyskiwania wysłany administratorowi prowadzi donikąd — co ma największe znaczenie, gdy panel stoi na osobnym hoście.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'mfa' },
      consumers: ['backend'],
      addressOf: 'admin',
    },
    {
      name: 'MFA_SECRET_ENCRYPTION_KEY',
      describes: {
        en: 'The key that encrypts every stored second-factor secret, so a copy of the database is not a copy of everybody’s authenticator.',
        pl: 'Klucz szyfrujący każdy zapisany sekret drugiego składnika, aby kopia bazy danych nie była kopią czyjegoś uwierzytelniacza.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'No second factor can be enrolled: the module serves its screens and refuses every enrolment, because it will not store a secret it cannot encrypt.',
          pl: 'Nie da się zarejestrować drugiego składnika: moduł udostępnia swoje ekrany i odmawia każdej rejestracji, bo nie zapisze sekretu, którego nie potrafi zaszyfrować.',
        },
      },
      secret: true,
      generable: true,
      owner: { kind: 'module', moduleId: 'mfa' },
      consumers: ['backend'],
      addressOf: null,
    },
  ],
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
   * The first ten entries are answer-preserving, not a judgement (§6.2 and
   * §6.5), and were not written by hand: they are the verbatim output of the
   * runbook's step-1 derivation over the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`, which records
   * what the prefix chain in `@endora-commerce/mod-i18n` answered at
   * `49f3c6817`. Re-routing a code to a better owner was
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work, deliberately
   * not done in Phase 3; the last two entries are that sweep arriving.
   *
   * **No shadow reaches this module, and that is a conclusion rather than a
   * premise.** The chain is an ordered `if` and an earlier rule silently claims
   * a later one's codes — it cost `inventory` two and gave `catalog` four
   * (trap T1). Here the whole chain was read: the `MFA_` rule is second from
   * last, no rule above it names an `MFA_`-prefixed code, and no misc set holds
   * one, so the source reading and the answer reading coincide. The derivation
   * was still run from the answer.
   *
   * **`TWO_FACTOR_REQUIRED` and `TWO_FACTOR_REQUIRED_BY_ROLE` were the codes a
   * reader would look for here and not find** (trap T2). Both name this
   * module's subject and neither carries the prefix, so they fell off the end
   * of the chain to `core`, which is what the capture records; whether that was
   * the right owner is the question §6.5 put out of scope. D-129's remaining
   * sweep answers it — **both are declared below since MR 4** — and the entry
   * after this list is the argument.
   *
   * **All ten of those are raised, and the spelling is why that had to be
   * measured.**
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
   *
   * **`TWO_FACTOR_REQUIRED` and `TWO_FACTOR_REQUIRED_BY_ROLE` join them in
   * D-129's remaining sweep, MR 4** (`d129-sweep.md` §5.2, Appendix A; D-186 in
   * `specs/080-f4-real-scope/rulings.md`). D-121 T1 decides both: the noun is
   * the second factor, which is this module's whole subject, and `_BY_ROLE`
   * names `MfaOrganizationPolicy` — the per-role enforcement this module owns
   * outright. Neither was a judgement about who throws them, because **nothing
   * in the tree throws either**: they are members of `ERROR_CODES` that no raise
   * site produces, which is the sweep's class D.
   *
   * **That is also why they arrive without a sentence, and why writing one
   * would have been the wrong call.** Both carried a placeholder in `_i18n`'s
   * bundle — `"Two Factor Required."` / `"Błąd: two factor required."`, the code
   * rewritten twice — and D-186 §2 deletes a placeholder rather than moving it,
   * because in this module's own bundle it would read as this module's answer
   * and every instrument would count the code as translated for good.
   * `d129-sweep.md` §5.4 keeps writing real prose available as the better
   * outcome, and it is available whenever a raise site says what the refusal
   * means. Here there is no raise site: a sentence would have to be invented
   * from the code's own name, which is the placeholder again in longer words,
   * and it would render for nobody. So both are `UNTRANSLATED_ERROR_CODES`
   * entries under `mfa`, where the debt is findable and attached to the module
   * that will write it if the refusal is ever implemented.
   *
   * They carry no `tokens` for the same reason the ten above do not, arrived at
   * from the other end: there is no raise site to put a `details.code` on the
   * wire.
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
    { code: 'TWO_FACTOR_REQUIRED' },
    { code: 'TWO_FACTOR_REQUIRED_BY_ROLE' },
  ],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'mfa:reset', label: "Reset a user's 2FA" },
    { code: 'mfa:manage', label: 'Manage 2FA policies and organization enforcement' },
  ],
});
