import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Credentials module — feature 058.
 *
 * Reusable credential configurations: each an instance of a code-registered
 * configuration type (LLM, email adapter, …). The core stores and validates
 * declared field values (secrets encrypted at rest, masked on read) but never
 * interprets provider meaning (Principle XIV). It owns NO settings — it
 * *provides* the `credential_ref` value type consumed by other modules.
 *
 * Depends on `settings` for the reference/delete-integrity lookup (US2) and on
 * the platform `_lifecycle` / `_i18n` modules for registration + translations.
 */

export const CREDENTIALS_READ_PERMISSION = 'credentials:read';
export const CREDENTIALS_WRITE_PERMISSION = 'credentials:write';

export const CREDENTIALS_ACTIVATION_SETTING_CODE = 'credentials.enabled';

/**
 * Feature 074 — the module's one Setting, and it exists to hold the operator's
 * activation choice.
 *
 * The doc comment above still holds: this module owns no *configuration*. It
 * provides the `credential_ref` value type other modules consume, and it stores
 * their credential instances. The activation control is not configuration —
 * it is the operator axis of Constitution XVII, which is a Setting row by
 * construction — so declaring it here does not make this a settings-owning
 * module.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'credentials',
  groups: [{ code: 'credentials', name: 'Credentials' }],
  settings: [
    {
      // Platform-wide, never channel-scoped: activation does not join the
      // per-channel tier, and the reconciler's channel scope is additive-only.
      code: CREDENTIALS_ACTIVATION_SETTING_CODE,
      name: 'Credentials enabled',
      description:
        'Switches the credential store on or off: the Credentials screens, their API, and the resolution of a `credential_ref` setting by any module that references one. Nothing is dropped — every stored configuration and its encrypted secrets stay in the database and resolve again exactly as before when you switch it back on.',
      groupCode: 'credentials',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'credentials',
  name: 'Credentials',
  description:
    'Reusable credential configurations (LLM, email adapter, …) referenced by settings and resolved by consumers; secrets encrypted at rest and write-only at the boundary.',
  version: '1.0.0',
  dependencies: ['_i18n', '_lifecycle', 'auth', 'settings'],
  settings,
  // Feature 074 (Constitution XVII) — a control this module never had, so an
  // operator could not decline it at all. It is the secret store for the
  // integration surfaces; with those switched off it is dead weight, which is
  // exactly the "additional capability" ruling 1 means. Default `true` so that
  // merging this changes no deployment's state (FR-012).
  activation: { settingCode: CREDENTIALS_ACTIVATION_SETTING_CODE, default: true },
  /**
   * Feature 090 Phase 3 — the six error codes the incumbent prefix chain routes
   * to this module.
   *
   * The list is copied from the frozen capture
   * (`backend/test/fixtures/error-code-routing/chain-answers.ts`), which records
   * what `moduleIdForErrorCode` answered, and is not a judgement about where a
   * code belongs. Reading the chain's *source* would have coincided here — the
   * `CREDENTIAL_` branch is unshadowed and no later branch claims a
   * `CREDENTIAL_`-prefixed code — but that is a conclusion of having read the
   * whole chain, never a premise (trap T1), and the six below still come off the
   * answer.
   *
   * **Three read like somebody else's and all three stay** (trap T2).
   * `CREDENTIAL_TYPE_UNKNOWN` refuses a configuration *type* that no module has
   * contributed to `ConfigurationTypeRegistry`, so the module a reader would
   * blame is whichever one was supposed to register it; `CREDENTIAL_IN_USE` is
   * decided entirely by a `settings` read — `listReferencesToConfiguration`,
   * whose result is the refusal's `referencedBy` list; and
   * `CREDENTIAL_VALIDATION_FAILED` is a field-level validation refusal of the
   * shape `core` owns as `VALIDATION_FAILED`. All three are refusals *about a
   * credential configuration*, which is the noun the chain follows (D-95.2).
   *
   * **The inverse is the larger half, and every code in it is somebody else's.**
   * `INVALID_CREDENTIALS` is auth's sign-in failure and routes to `core` — the
   * chain says so in its own comment above the `CREDENTIAL_` branch, because the
   * plural noun is a password and not a stored configuration.
   * `KSEF_CREDENTIAL_EXISTS` and `KSEF_CREDENTIAL_INVALID` route to `core` as
   * well, which surprises twice over: not here, and not `ksef` either.
   * `MFA_SOCIAL_LAST_CREDENTIAL` is `mfa`'s. And `SETTING_SECRET_KEY_MISSING` is
   * `settings`' (!1133) although it is raised out of a secret codec that
   * `@endora-commerce/platform`, this module and `ksef` each ship a byte-identical
   * copy of — see `services/secret-value-codec.ts`, whose own header calls the
   * duplication debt. This module raises one code it does not own in the other
   * direction: `VERSION_CONFLICT`, in the optimistic-concurrency guard of
   * `update-configuration.command.ts`, which routes to `core` and is not declared
   * here. Re-routing any of this is out of scope (§6.5); disagreement belongs in
   * `specs/082-error-code-ownership/rulings.md` §9.
   *
   * **All six are raised**, in both spellings (trap T12): `ERROR_CODES.<CODE>`
   * and the bare quoted literal, over `packages`, `backend/src`, `admin` and
   * `storefront`. Every raise is inside this package — twelve `HttpError`
   * throws — so unlike `settings` and `invoices` this module's raise sites and
   * its package coincide. No entry for the deferred-defect register. The
   * thirteenth mention is not a throw and is worth naming, because a grep counts
   * it as one: `ConfigurationTypeUnknown` in
   * `services/configuration-type-registry.ts` carries
   * `readonly code = ERROR_CODES.CREDENTIAL_TYPE_UNKNOWN` on a plain `Error`
   * subclass, and that field is read by nothing — the envelope's error handler
   * takes `code` off an `HttpError` and off nothing else. What makes the code
   * reach a client is the `instanceof` catch in
   * `commands/create-configuration.command.ts`, which rethrows as an `HttpError`
   * by hand.
   *
   * **No `tokens`, derived rather than assumed.** `refusalToken`
   * (`packages/platform/src/http/error-envelope.ts`) reads `details.code` off a
   * free-form object and nothing else. Of the twelve throws, nine pass no
   * fourth argument at all; the two `CREDENTIAL_VALIDATION_FAILED` raises pass
   * the Zod-style `Array<{path, issue}>`, which `refusalToken` returns `null`
   * for by construction; and the one `CREDENTIAL_IN_USE` raise passes
   * `{ referencedBy }`, a free-form object with no `code` member. The runbook's
   * §5 raise-site scan attributes the tree's ten token-carrying codes over 41
   * sites to `core`, `invoices` and `carts`, naming none of these, and the
   * bundles hold no `errors.<CODE>.<token>` key in the other direction.
   */
  errorCodes: [
    { code: 'CREDENTIAL_CODE_TAKEN' },
    { code: 'CREDENTIAL_IN_USE' },
    { code: 'CREDENTIAL_NOT_FOUND' },
    { code: 'CREDENTIAL_TYPE_IMMUTABLE' },
    { code: 'CREDENTIAL_TYPE_UNKNOWN' },
    { code: 'CREDENTIAL_VALIDATION_FAILED' },
  ],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    {
      code: CREDENTIALS_READ_PERMISSION,
      label: 'View credential configurations',
      description: 'Allows viewing credential configurations and the configuration-type catalogue (secrets masked).',
    },
    {
      code: CREDENTIALS_WRITE_PERMISSION,
      label: 'Manage credential configurations',
      description: 'Allows creating, editing, and deleting credential configurations, including writing secret fields.',
    },
  ],
  actions: [
    {
      id: 'open-credentials',
      labelKey: 'actions.openCredentials.label',
      descriptionKey: 'actions.openCredentials.description',
      icon: 'KeyRound',
      targetRoute: '/credentials',
      requiredPermission: CREDENTIALS_READ_PERMISSION,
      keywords: ['credentials', 'secrets', 'api key', 'poświadczenia', 'sekrety', 'klucze'],
      weight: 250,
    },
    {
      id: 'new-credential',
      labelKey: 'actions.newCredential.label',
      descriptionKey: 'actions.newCredential.description',
      icon: 'Plus',
      targetRoute: '/credentials/new',
      requiredPermission: CREDENTIALS_WRITE_PERMISSION,
      keywords: ['credential', 'configuration', 'nowe poświadczenie', 'konfiguracja'],
      weight: 251,
    },
  ],
});
