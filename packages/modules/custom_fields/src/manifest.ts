import { defineModuleManifest, type ModuleUninstallHook } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Custom Fields module — manifest (feature 055).
 *
 * Owns the entity-agnostic custom-field definition/option registry and the
 * value-validation service consumed by host modules. Platform-global; values
 * live on host rows and inherit the host's tenant scope (Principle XI).
 * Definition/option mutations run through the Command Bus (Principle XIII).
 */
export const manifest = defineModuleManifest({
  id: 'custom_fields',
  name: 'Custom Fields',
  description: 'Entity-agnostic runtime custom fields for core entities.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by.
  dependencies: ['auth'],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'custom_fields:read', label: 'View custom fields' },
    { code: 'custom_fields:write', label: 'Manage custom fields (definitions and options)' },
  ],
  actions: [
    {
      id: 'open-custom-fields',
      labelKey: 'actions.openCustomFields.label',
      descriptionKey: 'actions.openCustomFields.description',
      icon: 'Layers',
      targetRoute: '/custom-fields',
      requiredPermission: 'custom_fields:read',
      keywords: ['custom fields', 'attributes', 'pola', 'niestandardowe'],
      weight: 240,
    },
  ],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. The flag
  // used to rest on `organizations` declaring this module; ruling 2 withdraws
  // a dependent's authority to impose the lock, so the ground is now this
  // module's own. It is Principle XIV's extensibility mechanism: the answer
  // the platform gives to "add a field" instead of a bespoke column. Switching
  // it off does not remove a capability a client chose, it makes the values
  // already stored against every host entity unreachable.
  activation: {
    nonDeactivatable: true,
    reason:
      'The platform\'s extensibility mechanism; the custom values already stored against ' +
      'every host entity become unreachable without it.',
  },
});

/**
 * Hard-uninstall cleanup (feature 055). A soft uninstall keeps definitions so a
 * re-install restores them; a hard uninstall drops all definitions (options
 * cascade via FK). Host `custom_field_values` columns are owned by their host
 * modules and removed with them, so nothing dangles either way.
 */
export const uninstallHook: ModuleUninstallHook = async (ctx) => {
  if (!ctx.hard) return;
  const em = ctx.em as EntityManager;
  await em
    .getConnection()
    .execute('truncate table "custom_field_options", "custom_field_definitions" cascade');
  ctx.log.info('custom_fields: removed all custom-field definitions on hard uninstall');
};
