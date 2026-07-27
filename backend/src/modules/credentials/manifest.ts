import { defineModuleManifest } from '@b2b/contracts';

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

export const manifest = defineModuleManifest({
  id: 'credentials',
  name: 'Credentials',
  description:
    'Reusable credential configurations (LLM, email adapter, …) referenced by settings and resolved by consumers; secrets encrypted at rest and write-only at the boundary.',
  version: '1.0.0',
  dependencies: ['_lifecycle', '_i18n', 'settings'],
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
