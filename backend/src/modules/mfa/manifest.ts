import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  MFA_SETTING_CODES,
} from '@b2b/contracts';

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
  dependencies: ['settings', 'customer_accounts', 'admin_users', 'organizations'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'mfa:reset', label: "Reset a user's 2FA" },
    { code: 'mfa:manage', label: 'Manage 2FA policies and organization enforcement' },
  ],
});
