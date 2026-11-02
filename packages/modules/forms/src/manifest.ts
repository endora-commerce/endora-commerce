import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Forms — a form builder whose forms are placed on pages as Page Builder blocks
 * (`specs/170-forms-module/`). The module owns forms, their immutable published
 * versions, the entries shoppers submit and the notes employees add to them.
 *
 * The module is operator-toggleable (Constitution XVII): `forms.enabled` is its
 * activation control, and everything it contributes — routes, workers,
 * subscribers, admin surfaces, the `forms.Form` block — stops with it. Nothing
 * is dropped while it is off.
 */

const settings = defineModuleSettingsManifest({
  moduleCode: 'forms',
  groups: [
    {
      code: 'forms',
      name: 'Forms',
    },
  ],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: 'forms.enabled',
      name: 'Forms enabled',
      description:
        'Switches Forms on or off: the form builder, the entries, the Form block on pages and the form submissions. Nothing is dropped — every form, version and entry stays in the database and reappears when Forms is switched back on.',
      groupCode: 'forms',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // Research R-14: one CAPTCHA provider per deployment. `none` leaves a
      // form that requires CAPTCHA unprotected and warned about in the builder.
      code: 'forms.captcha_provider',
      name: 'CAPTCHA provider',
      description:
        'The service that checks a form was sent by a person: Cloudflare Turnstile or hCaptcha. A form asks for the check only when its CAPTCHA option is on; with "none" no form is checked.',
      groupCode: 'forms',
      valueType: 'string',
      enumOptions: ['none', 'turnstile', 'hcaptcha'],
      defaultValue: 'none',
    },
    {
      // Public: carried in the public form definition for the provider's widget.
      code: 'forms.captcha_site_key',
      name: 'CAPTCHA site key',
      description: 'The public site key the CAPTCHA provider issued for this shop. It is sent to the browser.',
      groupCode: 'forms',
      valueType: 'string',
      defaultValue: '',
    },
    {
      // Research F-18: encrypted at rest, never returned by any read endpoint,
      // read server-side through `settingsReadPort` per verification.
      code: 'forms.captcha_secret_key',
      name: 'CAPTCHA secret key',
      description:
        'The secret key the CAPTCHA provider issued for this shop, used by the server to verify a check. Stored encrypted at rest; write-only.',
      groupCode: 'forms',
      valueType: 'secret',
      defaultValue: '',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'forms',
  name: 'Forms',
  description:
    'A form builder: forms with sections, conditional logic and translations, published as immutable versions and placed on pages with the Form block; entries with statuses, notes, export, notifications and retention.',
  version: '1.0.0',
  // Research R-2 — every owner this module binds is non-deactivatable (T001 a),
  // so none of these edges costs an operator a switch:
  // `_i18n` owns `adminI18nService` (validation messages and e-mail wording in
  // the reader's language); `audit_logs` the audit trail every Command writes;
  // `auth` `requireAdmin` and the session that attributes an entry;
  // `customer_accounts` `customerAccountReadPort` (attribution, erasure);
  // `dictionaries` `dictionaryValidator` (country answers); `email`
  // `emailMailer` (notifications); `sales_channels` the resolved request
  // channel and the storefront languages; `settings` the store the activation
  // control and the CAPTCHA settings live in.
  dependencies: [
    '_i18n',
    'audit_logs',
    'auth',
    'customer_accounts',
    'dictionaries',
    'email',
    'sales_channels',
    'settings',
  ],
  /**
   * Edges that are real to the container and bind no operator (R-2, FR-002).
   */
  nonBindingDependencies: [
    {
      moduleId: 'cms',
      name: 'cmsPageReadPort',
      kind: 'degrades-without',
      whenAbsent: 'A confirmation that leads to a CMS page shows the confirmation message instead.',
      reason:
        'The one call into this owner resolves a form\'s "show a CMS page" confirmation to the ' +
        "page's path; the public read asks `effectiveState.isPresent('cms')` in front of the gate " +
        'and answers the confirmation message without it. No table of that owner is referenced ' +
        "from this module's schema.",
    },
    {
      moduleId: 'webhooks',
      name: 'webhookEventRegistry',
      kind: 'contributes-to',
      reason:
        "A push, from this module's contribution-only boot hook, of the event name it offers for " +
        'outbound delivery. Nothing is read back: the registry is a plain registration that leaves ' +
        'out every event type whose owner is not present when it is read, and `webhooks` bridges ' +
        'and delivers through its own gated subscription.',
    },
  ],
  settings,
  // Constitution XVII — the operator's activation control.
  activation: { settingCode: 'forms.enabled', default: true },
  /**
   * `contracts/admin-surfaces.md` §1. Deleting a form with entries and changing
   * its retention period also need `forms:entries_write` and an unrestricted
   * admin scope (research § Principle XI review).
   */
  permissions: [
    {
      code: 'forms:read',
      label: 'View forms',
      module: 'forms',
    },
    {
      code: 'forms:write',
      label: 'Create and edit forms',
      module: 'forms',
      requires: ['forms:read'],
    },
    {
      code: 'forms:entries_read',
      label: 'View form entries',
      module: 'forms',
    },
    {
      code: 'forms:entries_write',
      label: 'Process and delete form entries',
      module: 'forms',
      requires: ['forms:entries_read'],
    },
    {
      code: 'forms:entries_export',
      label: 'Export form entries',
      module: 'forms',
      requires: ['forms:entries_read'],
    },
  ],
  /**
   * The refusals this module raises, each with its sentence under
   * `errors.<CODE>` in `i18n/{en,pl}.json`, declared by the change that adds
   * its first raise site (research R-25).
   */
  errorCodes: [
    { code: 'FORM_NOT_FOUND' },
    { code: 'FORM_KEY_TAKEN' },
    // `details.issues[].code` is the broken rule (data-model §3.5); the sentence names none of them.
    { code: 'FORM_DEFINITION_INVALID' },
    { code: 'FORM_REVISION_CONFLICT' },
    { code: 'FORM_HAS_ENTRIES' },
    // `details.code` is why the form takes no submission now (research R-25); the storefront words
    // the shopper reads are its own, these are the headless client's.
    { code: 'FORM_NOT_ACCEPTING', tokens: ['closed', 'not_yet_open', 'full', 'sign_in_required', 'unavailable'] },
    { code: 'FORM_SUBMISSION_TOO_LARGE' },
    // `details.fields[].code` is the broken field rule; each `message` is the field's own sentence.
    { code: 'FORM_SUBMISSION_INVALID' },
    // An out-of-scope entry answers exactly like a missing one (research Principle XI review).
    { code: 'FORM_ENTRY_NOT_FOUND' },
    // `details.status` is the entry's status now, so the screen can say what happened.
    { code: 'FORM_ENTRY_STATUS_CONFLICT' },
    { code: 'FORM_SCOPE_REQUIRED' },
    // A refused or missing CAPTCHA response (research R-14); nothing was stored.
    { code: 'FORM_CAPTCHA_FAILED' },
    // The provider could not answer (timeout, network, non-2xx): fail closed, retryable — `Retry-After`.
    { code: 'FORM_CAPTCHA_UNAVAILABLE' },
  ],
  /**
   * The command palette (Principle XVI; `contracts/admin-surfaces.md` §2). Each
   * opens a screen of this module's own admin layer and declares the code that
   * screen and its API are gated on.
   */
  actions: [
    {
      id: 'open-forms',
      labelKey: 'actions.openForms.label',
      descriptionKey: 'actions.openForms.description',
      icon: 'ClipboardList',
      targetRoute: '/forms',
      requiredPermission: 'forms:read',
      keywords: ['forms', 'form builder', 'contact form', 'survey'],
      keywordsKey: 'actions.openForms.keywords',
      weight: 260,
    },
    {
      id: 'new-form',
      labelKey: 'actions.newForm.label',
      descriptionKey: 'actions.newForm.description',
      icon: 'FilePlus',
      targetRoute: '/forms/new',
      requiredPermission: 'forms:write',
      keywords: ['form', 'new', 'create'],
      keywordsKey: 'actions.newForm.keywords',
      weight: 261,
    },
    {
      id: 'open-form-entries',
      labelKey: 'actions.openFormEntries.label',
      descriptionKey: 'actions.openFormEntries.description',
      icon: 'Inbox',
      targetRoute: '/forms/entries',
      requiredPermission: 'forms:entries_read',
      keywords: ['form entries', 'submissions', 'responses'],
      keywordsKey: 'actions.openFormEntries.keywords',
      weight: 262,
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  // `docs/forms.md` at the package root: users' and developers' page.
  docs: { dir: 'docs' },
  /**
   * `contracts/blocks-and-storefront.md` §1 — the block that places a published
   * form on a page. Declared here, by the module whose data it reads and
   * writes, as `newsletter` declares `newsletter.Signup`; its React code is
   * `@endora-commerce/cms-components`' `forms/FormBlock.tsx`, fed server-side by
   * the `form` block-data kind. It holds no prose (`translatable: []`): every
   * text is the form's own, per language (FR-003). While `forms` or `cms` is
   * absent the block is neither offered nor rendered.
   */
  blocks: [
    {
      name: 'forms.Form',
      labelKey: 'blocks.form.label',
      descriptionKey: 'blocks.form.description',
      category: 'forms',
      contexts: ['cms'],
      translatable: [],
      fields: {},
      responsiveFields: [],
      weight: 1,
    },
  ],
  // The palette section the block sits in, declared beside it (the manifest
  // validator refuses a block whose section its manifest does not declare);
  // merged by key with `cms`' and `newsletter`'s, same weight.
  blockCategories: [{ key: 'forms', titleKey: 'blocks.category.forms', contexts: ['cms'], weight: 70 }],
});
