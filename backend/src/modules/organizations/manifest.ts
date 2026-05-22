import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Organization-owned setting codes (feature 026 consolidation).
 *
 * Both keys are platform-wide policies (no per-channel override).
 */
export const ORGANIZATIONS_SETTING_CODES = {
  MODERATION_MODE: 'organizations.moderation.mode',
  NEW_REGISTRATION_RECIPIENTS: 'organizations.notifications.new_registration_recipients',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'organizations',
  groups: [{ code: 'organizations', name: 'Organizations' }],
  settings: [
    {
      code: ORGANIZATIONS_SETTING_CODES.MODERATION_MODE,
      name: 'Moderation mode for new Organizations',
      description:
        'Whether newly registered Organizations enter pending_verification (manual moderation) or active (auto-activation). One of: manual | auto.',
      groupCode: 'organizations',
      valueType: 'string',
      defaultValue: 'manual',
    },
    {
      code: ORGANIZATIONS_SETTING_CODES.NEW_REGISTRATION_RECIPIENTS,
      name: 'New Organization registration — email recipients',
      description:
        'List of email addresses receiving a notification on every new Organization registration. Validated syntactically; max 50 entries; case-insensitive dedup. Empty list ⇒ no emails sent (in-app admin notification still fires).',
      groupCode: 'organizations',
      valueType: 'json',
      defaultValue: [],
    },
  ],
});

/**
 * Organizations module — manifest backfill (Module Lifecycle, feature 018)
 * extended by feature 026 with two settings keys (moderation mode + new
 * registration email recipients).
 */
export const manifest = defineModuleManifest({
  id: 'organizations',
  name: 'Organizations',
  description:
    'B2B organization records, members, addresses, sales-rep assignment, moderation lifecycle, and per-org commercial scoping.',
  version: '1.1.0',
  dependencies: [],
  settings,
});
