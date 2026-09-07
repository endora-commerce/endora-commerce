import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { DEFAULT_HEADER_BLOCK_CODE } from '@endora-commerce/email-components/defaults/default-header';
import { DEFAULT_FOOTER_BLOCK_CODE } from '@endora-commerce/email-components/defaults/default-footer';

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
  dependencies: ['assets_library', 'email', 'sales_channels', 'settings'],
  // Feature 074 (Constitution XVII), test C2 — functional base. The second
  // half of the old ground was that `organizations` declares this module, so
  // the flip failed closed onto the tenancy root; ruling 2 withdraws that, and
  // the first half stands on its own. This module is the platform's only
  // acknowledgement path to a buyer and to an operator — order confirmation,
  // document delivery, account mail. The granularity a business actually wants
  // is the individual email, and that control exists: see
  // `commands/email-activation.commands.ts` and
  // `services/email-defaults-registry.ts` (issue #89).
  activation: {
    nonDeactivatable: true,
    reason:
      'The platform\'s only acknowledgement path to buyer and operator — order confirmation, ' +
      'document delivery, account mail. Switch off an individual email instead.',
  },
  settings: transactionalEmailsSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  /**
   * `TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE` — D-129's remaining sweep, Tier A
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 3).
   *
   * Declared by `_i18n` until this merge request, not because anybody judged
   * it the platform's but because the deleted prefix chain had no rule for it
   * and its last line was `return 'core'`. **D-121 T1 puts it here**: the noun
   * is one transactional email, and this module owns the email, its content,
   * its per-channel customization and the registry that says which emails a
   * business may switch off.
   *
   * **The word `NOT_DEACTIVATABLE` is not the platform's here**, which is the
   * one thing about this code worth reading twice. It sounds like the module
   * lifecycle's `MODULE_NOT_DEACTIVATABLE`, and it is a different refusal at a
   * different granularity: the platform's is about a *module* an operator may
   * not switch off, this one is about a single **email** — `order_confirmation`
   * and its like — that the registry marks always-on with a reason. Issue #89
   * introduced the per-email control precisely because the module's own
   * activation is `nonDeactivatable`; the two codes are the two ends of that
   * decision and only one of them belongs to the lifecycle.
   *
   * **No sentence moves with it.** It has none in either language anywhere in
   * the tree; it was already on `UNTRANSLATED_ERROR_CODES` under `_i18n` and
   * moves to this module's group there, so the bundle this module already
   * ships gains no key. The refusal an operator reads today is the registry's
   * own `nonDeactivatableReasonOf(code)` prose, which the raise passes as the
   * message.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and this is the case where that rule bites rather than
   * repeats itself. The single raise
   * (`commands/email-activation.commands.ts`) puts `{ code, reason }` in
   * `details`, so `refusalToken` reads a token off every one of these errors
   * (`packages/platform/src/http/error-envelope.ts`) — and the token is the
   * **email's** registry code, an open set every module contributing an email
   * extends, not a fixed vocabulary this manifest could enumerate. Declaring
   * tokens would therefore be declaring a list that goes stale on the next
   * email somebody registers. It is `VALIDATION_FAILED`'s shape one layer
   * along: a machine-readable discriminator on the wire rather than a token
   * choosing between sentences.
   *
   * Two consequences, both recorded rather than repaired here. A base sentence
   * written at `errors.TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE` would be **dead
   * key** — the envelope always looks up `<key>.<token>` when a token is
   * present — so whoever drains this code's ledger entry writes
   * `errors.TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE.<email code>` per protected
   * email, or leaves the registry's reason to answer. And `_i18n`'s own
   * `tokens` paragraph counted seven codes carrying a `details.code`; this was
   * an eighth, so that count is true of the list it describes only now that
   * this code has left it.
   */
  errorCodes: [{ code: 'TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE' }],
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
    {
      id: 'open-email-templates',
      labelKey: 'actions.openEmailTemplates.label',
      descriptionKey: 'actions.openEmailTemplates.description',
      icon: 'FileText',
      targetRoute: '/transactional-emails/templates',
      requiredPermission: 'transactional_emails:read',
      keywords: ['email', 'templates', 'layout', 'transactional'],
      weight: 241,
    },
    /**
     * The one `AppShell.tsx` `PALETTE_ITEMS` row feature 091's batch 11
     * deletes, arriving as a declaration (Principle XVI) — same destination,
     * same code, same keywords. Its two siblings were declared already, so
     * this is the row that would otherwise have gone silently.
     *
     * This module is `nonDeactivatable`, so the row it replaces never
     * advertised an absent module; what the declaration buys here is the other
     * axis, the one a lock leaves — the server resolves the operator's
     * permission before the entry reaches the palette, and a hand-written row
     * carried its own copy of that answer.
     */
    {
      id: 'open-email-blocks',
      labelKey: 'actions.openEmailBlocks.label',
      descriptionKey: 'actions.openEmailBlocks.description',
      icon: 'Inbox',
      targetRoute: '/transactional-emails/blocks',
      requiredPermission: 'transactional_emails:read',
      keywords: ['email', 'blocks', 'fragments', 'bloki'],
      weight: 242,
    },
  ],
  /**
   * The 17 e-mail Page Builder blocks this module owns, and the four e-mail
   * palette sections its own blocks populate (feature 096, §7.2 and §2.1).
   *
   * They are not today's four. `order` moves to `orders`, which owns all eight
   * blocks in it. `internal` is **new**: the e-mail palette has no hidden
   * drawer today, which is exactly why `EmailColumn` sits in `components` and
   * in no category and lands in Puck's *Other* group, insertable outside a row
   * where it renders wrong. Putting it in a `visible: false` section is a
   * deliberate behaviour change and the operator loses an *Other*-drawer entry
   * that only ever worked inside a row. `EmailInsertTemplate` gains `embeds`:
   * it has a renderer and a persisted name and appears in no palette at all.
   *
   * `contexts: ['email']` rather than `['email', 'newsletter']`: the newsletter
   * palette is served by `filterConfigByContext`, which admits an `email` block
   * into the `newsletter` context, and no newsletter section exists for a
   * category declaration to name.
   */
  blocks: [
    {
      name: 'transactional_emails.EmailHeading',
      labelKey: 'blocks.emailHeading.label',
      descriptionKey: 'blocks.emailHeading.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 10,
    },
    {
      name: 'transactional_emails.EmailText',
      labelKey: 'blocks.emailText.label',
      descriptionKey: 'blocks.emailText.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 20,
    },
    {
      name: 'transactional_emails.EmailRichText',
      labelKey: 'blocks.emailRichText.label',
      descriptionKey: 'blocks.emailRichText.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 30,
    },
    {
      name: 'transactional_emails.EmailButton',
      labelKey: 'blocks.emailButton.label',
      descriptionKey: 'blocks.emailButton.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 40,
    },
    {
      name: 'transactional_emails.EmailImage',
      labelKey: 'blocks.emailImage.label',
      descriptionKey: 'blocks.emailImage.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 50,
    },
    {
      name: 'transactional_emails.EmailLogo',
      labelKey: 'blocks.emailLogo.label',
      descriptionKey: 'blocks.emailLogo.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 60,
    },
    {
      name: 'transactional_emails.EmailSocial',
      labelKey: 'blocks.emailSocial.label',
      descriptionKey: 'blocks.emailSocial.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 100,
    },
    {
      name: 'transactional_emails.EmailCallout',
      labelKey: 'blocks.emailCallout.label',
      descriptionKey: 'blocks.emailCallout.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 110,
    },
    {
      name: 'transactional_emails.EmailFooterLegal',
      labelKey: 'blocks.emailFooterLegal.label',
      descriptionKey: 'blocks.emailFooterLegal.description',
      category: 'content',
      contexts: ['email'],
      fields: {},
      weight: 120,
    },
    {
      name: 'transactional_emails.EmailSection',
      labelKey: 'blocks.emailSection.label',
      descriptionKey: 'blocks.emailSection.description',
      category: 'layout',
      contexts: ['email'],
      fields: {},
      weight: 10,
    },
    {
      name: 'transactional_emails.EmailRow',
      labelKey: 'blocks.emailRow.label',
      descriptionKey: 'blocks.emailRow.description',
      category: 'layout',
      contexts: ['email'],
      fields: {},
      weight: 20,
    },
    {
      name: 'transactional_emails.EmailTable',
      labelKey: 'blocks.emailTable.label',
      descriptionKey: 'blocks.emailTable.description',
      category: 'layout',
      contexts: ['email'],
      fields: {},
      weight: 30,
    },
    {
      name: 'transactional_emails.EmailDivider',
      labelKey: 'blocks.emailDivider.label',
      descriptionKey: 'blocks.emailDivider.description',
      category: 'layout',
      contexts: ['email'],
      fields: {},
      weight: 40,
    },
    {
      name: 'transactional_emails.EmailSpacer',
      labelKey: 'blocks.emailSpacer.label',
      descriptionKey: 'blocks.emailSpacer.description',
      category: 'layout',
      contexts: ['email'],
      fields: {},
      weight: 50,
    },
    {
      name: 'transactional_emails.EmailInsertBlock',
      labelKey: 'blocks.emailInsertBlock.label',
      descriptionKey: 'blocks.emailInsertBlock.description',
      category: 'embeds',
      contexts: ['email'],
      fields: {},
      weight: 10,
    },
    {
      name: 'transactional_emails.EmailInsertTemplate',
      labelKey: 'blocks.emailInsertTemplate.label',
      descriptionKey: 'blocks.emailInsertTemplate.description',
      category: 'embeds',
      contexts: ['email'],
      fields: {},
      weight: 20,
    },
    {
      name: 'transactional_emails.EmailColumn',
      labelKey: 'blocks.emailColumn.label',
      descriptionKey: 'blocks.emailColumn.description',
      category: 'internal',
      contexts: ['email'],
      fields: {},
      weight: 10,
    },
  ],
  blockCategories: [
    { key: 'content', titleKey: 'blocks.category.content', contexts: ['email'], weight: 10 },
    { key: 'layout', titleKey: 'blocks.category.layout', contexts: ['email'], weight: 30 },
    { key: 'embeds', titleKey: 'blocks.category.embeds', contexts: ['email'], weight: 40 },
    {
      key: 'internal',
      titleKey: 'blocks.category.internal',
      contexts: ['email'],
      weight: 50,
      visible: false,
    },
  ],
});
