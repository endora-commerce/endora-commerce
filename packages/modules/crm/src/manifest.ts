import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * CRM — Sales Opportunities and their configurable status workflow
 * (`specs/143-crm-sales-opportunities/`).
 *
 * The module is operator-toggleable (Constitution XVII): `crm.enabled` is its
 * activation control, and everything it contributes — routes, subscribers,
 * workers, admin surfaces — stops with it. Nothing is dropped while it is off.
 */

const settings = defineModuleSettingsManifest({
  moduleCode: 'crm',
  groups: [
    {
      code: 'crm',
      name: 'CRM',
    },
  ],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: 'crm.enabled',
      name: 'CRM enabled',
      description:
        'Switches the CRM on or off: the sales opportunity screens, the status workflow and its configuration, and the link between an opportunity and its orders. Nothing is dropped — every opportunity, its history and the workflow configuration stay in the database and resume where they were.',
      groupCode: 'crm',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'crm',
  name: 'CRM',
  description:
    'Sales opportunities with a configurable status workflow that linked orders follow.',
  version: '1.0.0',
  // `auth` owns `requireAdmin`, which gates every route of this module;
  // `settings` owns the store the activation control and the module settings
  // live in.
  dependencies: ['auth', 'settings'],
  settings,
  // Constitution XVII — the operator's activation control.
  activation: { settingCode: 'crm.enabled', default: true },
  // Nothing to document yet: the page lands with the first operator-visible
  // surface.
  docs: false,
  // Demo data is a later story's decision (research R-24); `false` is a
  // decision, absent would be "nobody has decided".
  demo: false,
});
