import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';
import { DEFAULT_HEADER_BLOCK_CODE } from '@b2b/email-components/defaults/default-header';
import { DEFAULT_FOOTER_BLOCK_CODE } from '@b2b/email-components/defaults/default-footer';

/**
 * Transactional Emails module (feature 047). Owns the editable email
 * definitions, reusable email-safe blocks/templates, and branding (logo +
 * look), and provides the TransactionalEmailSender port other modules use to
 * send. Branding is modeled as per-channel-scopable settings (research R5).
 */
export const TRANSACTIONAL_EMAILS_SETTING_CODES = {
  LOGO_ASSET_ID: 'transactional_emails.logo_asset_id',
  ACCENT_COLOR: 'transactional_emails.accent_color',
  HEADER_BLOCK_CODE: 'transactional_emails.header_block_code',
  FOOTER_BLOCK_CODE: 'transactional_emails.footer_block_code',
} as const;

export const transactionalEmailsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'transactional_emails',
  groups: [{ code: 'transactional_emails', name: 'Transactional Emails' }],
  settings: [
    {
      code: TRANSACTIONAL_EMAILS_SETTING_CODES.LOGO_ASSET_ID,
      name: 'Email header logo',
      description: 'Asset used as the header logo in transactional emails.',
      groupCode: 'transactional_emails',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: TRANSACTIONAL_EMAILS_SETTING_CODES.ACCENT_COLOR,
      name: 'Email accent color',
      description: 'Accent color applied by default email components (hex).',
      groupCode: 'transactional_emails',
      valueType: 'string',
      defaultValue: '#1f2937',
    },
    {
      code: TRANSACTIONAL_EMAILS_SETTING_CODES.HEADER_BLOCK_CODE,
      name: 'Default header block',
      description: 'Email block auto-inserted as the header of new emails.',
      groupCode: 'transactional_emails',
      valueType: 'string',
      defaultValue: DEFAULT_HEADER_BLOCK_CODE,
    },
    {
      code: TRANSACTIONAL_EMAILS_SETTING_CODES.FOOTER_BLOCK_CODE,
      name: 'Default footer block',
      description: 'Email block auto-inserted as the footer of new emails.',
      groupCode: 'transactional_emails',
      valueType: 'string',
      defaultValue: DEFAULT_FOOTER_BLOCK_CODE,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'transactional_emails',
  name: 'Transactional Emails',
  description:
    'Admin-editable transactional email content and look (global + per sales channel), email-safe blocks/templates, variables, and preview.',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels', 'email', 'assets_library'],
  settings: transactionalEmailsSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'transactional_emails:read', label: 'View transactional emails' },
    {
      code: 'transactional_emails:write',
      label: 'Manage transactional emails, blocks, templates, and branding',
    },
  ],
  actions: [
    {
      id: 'open-transactional-emails',
      labelKey: 'actions.openTransactionalEmails.label',
      descriptionKey: 'actions.openTransactionalEmails.description',
      icon: 'Inbox',
      targetRoute: '/transactional-emails',
      requiredPermission: 'transactional_emails:read',
      keywords: ['email', 'transactional', 'notifications', 'templates'],
      weight: 240,
    },
  ],
});
