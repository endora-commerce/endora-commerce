import {
  ADMIN_FEEDBACK_DEFAULT_RELAY_URL,
  ADMIN_FEEDBACK_ERROR_CODES,
  ADMIN_FEEDBACK_SETTING_CODES,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Feedback from the Admin UI to the makers of Endora Commerce (issue #379).
 *
 * The module owns no table and stores nothing: it forwards what an
 * administrator typed, plus what the instance knows about itself, to a relay
 * that turns it into one e-mail to support. The Admin UI's link and dialog live
 * in `@endora-commerce/admin-shell`, shown only while this module is present.
 *
 * Two ways to stop it, on purpose: switch the module off (nothing is offered,
 * nothing is sent), or empty the relay address (the dialog is offered and the
 * send is refused as not configured).
 */
export const adminFeedbackSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'admin_feedback',
  groups: [{ code: 'admin_feedback', name: 'Feedback' }],
  settings: [
    {
      // Constitution XVII — the operator's activation control. Platform-wide.
      code: ADMIN_FEEDBACK_SETTING_CODES.MODULE_ENABLED,
      name: 'Feedback module enabled',
      description:
        'Shows the "Send feedback" link in the admin and lets administrators send feedback to the makers of Endora Commerce. Switch it off if this instance must not send any data to Endora: the link disappears and nothing is sent. Nothing is stored either way.',
      groupCode: 'admin_feedback',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL,
      name: 'Feedback relay address',
      description:
        'The http(s) address feedback is sent to. Leave the default to reach Endora support. Empty switches sending off while keeping the module on.',
      groupCode: 'admin_feedback',
      valueType: 'string',
      defaultValue: ADMIN_FEEDBACK_DEFAULT_RELAY_URL,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'admin_feedback',
  name: 'Feedback',
  description:
    'Send feedback from the admin to the makers of Endora Commerce: a message, a contact address and what the instance knows about itself, relayed as one e-mail and stored nowhere.',
  version: '1.0.0',
  // The ports this module resolves: `requireAdmin` (`auth`), the sending
  // administrator's name (`admin_users`) and its own relay address
  // (`settings`). All three are non-deactivatable.
  dependencies: ['auth', 'admin_users', 'settings'],
  settings: adminFeedbackSettingsManifest,
  activation: { settingCode: ADMIN_FEEDBACK_SETTING_CODES.MODULE_ENABLED, default: true },
  // Routes the two codes' sentences to this package's own bundle. The codes
  // are in the platform's `ERROR_CODES` as well, as every code a module of
  // this repository declares must be (check:error-translations, FR-043).
  errorCodes: [
    { code: ADMIN_FEEDBACK_ERROR_CODES.NOT_CONFIGURED },
    { code: ADMIN_FEEDBACK_ERROR_CODES.DELIVERY_FAILED },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  // Principle XVI — the module's one configurable surface is its settings
  // group on the generic Settings screen; the dialog itself is the shell's.
  actions: [
    {
      id: 'open-admin-feedback-settings',
      labelKey: 'actions.openAdminFeedbackSettings.label',
      descriptionKey: 'actions.openAdminFeedbackSettings.description',
      icon: 'Settings',
      targetRoute: '/settings',
      // Core catalogue code, referenced rather than re-declared: this module
      // owns no permission of its own.
      requiredPermission: 'settings:read',
      keywords: ['feedback', 'support', 'relay'],
      keywordsKey: 'actions.openAdminFeedbackSettings.keywords',
      weight: 960,
    },
  ],
});
