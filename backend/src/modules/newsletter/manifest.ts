import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';
import { NEWSLETTER_SETTING_CODES } from '@b2b/contracts';

/**
 * Newsletter module (feature 048). Owns the subscriber list, tags, custom
 * fields, campaigns, linear automations, reusable email-safe blocks, the
 * bulk-sending provider (SMTP / Amazon SES via nodemailer), and engagement
 * tracking. Bulk delivery is independent of the transactional-email transport.
 * Provider credentials are stored as Settings `secret` values (feature 043).
 */
export const newsletterSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'newsletter',
  groups: [{ code: 'newsletter', name: 'Newsletter' }],
  settings: [
    {
      code: NEWSLETTER_SETTING_CODES.OPT_IN_MODE,
      name: 'Opt-in mode',
      description: 'Single (immediate) or double (confirmation email) opt-in. Scopable per sales channel.',
      groupCode: 'newsletter',
      valueType: 'string',
      enumOptions: ['single', 'double'],
      defaultValue: 'double',
    },
    {
      code: NEWSLETTER_SETTING_CODES.CONFIRM_TTL_HOURS,
      name: 'Confirmation link TTL (hours)',
      description: 'How long a double opt-in confirmation link stays valid before the pending subscriber expires.',
      groupCode: 'newsletter',
      valueType: 'number',
      defaultValue: 168,
    },
    {
      code: NEWSLETTER_SETTING_CODES.PROVIDER,
      name: 'Sending provider',
      description: 'Bulk sending provider used for newsletter dispatch.',
      groupCode: 'newsletter',
      valueType: 'string',
      enumOptions: ['smtp', 'console'],
      defaultValue: 'console',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SMTP_HOST,
      name: 'SMTP host',
      description: 'SMTP host (e.g. email-smtp.<region>.amazonaws.com for Amazon SES).',
      groupCode: 'newsletter',
      valueType: 'string',
      defaultValue: '',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SMTP_PORT,
      name: 'SMTP port',
      description: 'SMTP port (587 for STARTTLS, 465 for TLS).',
      groupCode: 'newsletter',
      valueType: 'number',
      defaultValue: 587,
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SMTP_SECURE,
      name: 'SMTP TLS',
      description: 'Use implicit TLS (true for port 465).',
      groupCode: 'newsletter',
      valueType: 'boolean',
      defaultValue: false,
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SMTP_USERNAME,
      name: 'SMTP username',
      description: 'SMTP username / SES SMTP credential id.',
      groupCode: 'newsletter',
      valueType: 'string',
      defaultValue: '',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SMTP_PASSWORD,
      name: 'SMTP password',
      description: 'SMTP password / SES SMTP secret. Stored encrypted (write-only).',
      groupCode: 'newsletter',
      valueType: 'secret',
      defaultValue: '',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SENDER_FROM_EMAIL,
      name: 'Sender email',
      description: 'Verified From address for newsletter mail.',
      groupCode: 'newsletter',
      valueType: 'string',
      defaultValue: '',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SENDER_FROM_NAME,
      name: 'Sender name',
      description: 'Display name shown in the From header.',
      groupCode: 'newsletter',
      valueType: 'string',
      defaultValue: '',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.RATE_LIMIT_PER_SECOND,
      name: 'Send rate limit (per second)',
      description: 'Maximum messages dispatched per second (provider throttle).',
      groupCode: 'newsletter',
      valueType: 'number',
      defaultValue: 14,
      hidden: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'newsletter',
  name: 'Newsletter',
  description:
    'Own-infrastructure newsletter: subscribers with tags + custom fields, campaigns, linear automations, email-safe templates and variables, engagement stats, and a configurable bulk-sending provider.',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels', 'customers', 'email', 'audit_logs'],
  settings: newsletterSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'newsletter:read', label: 'View newsletter' },
    {
      code: 'newsletter:write',
      label: 'Manage newsletter subscribers, campaigns, automations, and provider',
    },
  ],
  actions: [
    {
      id: 'open-newsletter',
      labelKey: 'actions.openNewsletter.label',
      descriptionKey: 'actions.openNewsletter.description',
      icon: 'Inbox',
      targetRoute: '/newsletter/subscribers',
      requiredPermission: 'newsletter:read',
      keywords: ['newsletter', 'campaign', 'subscribers', 'marketing', 'automation'],
      weight: 230,
    },
  ],
});
