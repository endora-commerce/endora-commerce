import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Example deployment — the overlay module that owns a table
 * (`specs/190-overlay-full-modules/` US1, FR-030 – FR-040, #1850).
 *
 * D-297 made an overlay module a full module: it may own entities and
 * migrations, read at runtime from the deployment root exactly as an installed
 * package's are, and run under the same foreign-schema guard with no deployment
 * exemption. This is the smallest module that exercises all of it in this
 * repository — one organization-scoped entity, one migration — so the platform
 * half (`overlay/overlay-schema.ts`, the merge in `db/configured-*.ts`) and the
 * test harness's per-deployment template (FR-039) have a real subject, and
 * `backend/test/integration/overlay/overlay-table.test.ts` reads its rows across
 * two organizations.
 *
 * **It is not a capability.** It serves no route and contributes no admin or
 * storefront surface; a shop would never compose it, and `example` is the
 * reference deployment, composed nowhere a real shop runs (OR-12). The reference
 * overlay a client reads is `example_erp_keys` (US8, #1856).
 */
export const OVERLAY_NOTES_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'overlay_notes_fixture.enabled',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'overlay_notes_fixture',
  groups: [{ code: 'overlay_notes_fixture', name: 'Overlay notes fixture' }],
  settings: [
    {
      code: OVERLAY_NOTES_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'Overlay notes fixture enabled',
      description:
        'Switches this example-deployment fixture on or off. It owns one table so that an overlay module with schema is composed, migrated and tested in this repository; switching it off drops nothing, and switching it back on restores it as it was.',
      groupCode: 'overlay_notes_fixture',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'overlay_notes_fixture',
  name: 'Overlay notes fixture',
  description:
    'Example-deployment fixture: an overlay module that owns one organization-scoped table, read at runtime like an installed package.',
  version: '1.0.0',
  // The table's foreign key is to `organizations`, so the edge is declared, as a
  // package's would be: it orders this module's migration after the one that
  // creates the table it references. `settings` carries the activation control.
  dependencies: ['organizations', 'settings'],
  activation: { settingCode: OVERLAY_NOTES_FIXTURE_SETTING_CODES.ACTIVATION, default: true },
  settings,
});
