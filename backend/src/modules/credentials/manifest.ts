import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

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
