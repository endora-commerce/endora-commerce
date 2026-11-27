import {
  defineModuleErrorCodes,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Example deployment — **the reference overlay module** (`specs/190-overlay-full-modules/`
 * US8, FR-095, #1856). Read it as the thing to copy when an instance needs a
 * module of its own: it uses every seam an overlay module has since D-297, each
 * once, and each where a real shop would want it.
 *
 * The capability is small on purpose: every Organization may carry the key the
 * shop's ERP knows it by, unique across the shop.
 *
 *  - **Data** — a side table on `organizations.Organization`, declared in
 *    `extends` (`specs/187-side-table-extensions/`), owned and migrated by this
 *    module (`entities/`, `migrations/`), organization-scoped by its primary key.
 *    No core column is added.
 *  - **Write** — a `beforeCommit` hook on `organization.create`
 *    (`hooks/fill-erp-key.ts`): a server-side caller, an ERP import, hands the
 *    key as `extensions.example_erp_keys` to `organizationCommandPort.create`,
 *    and the side row commits with the Organization or not at all.
 *  - **Read** — an extension-attribute loader, so any module asks
 *    `organizationDetailsPort` for `include: ['extensions.example_erp_keys']`;
 *    and a published port, `exampleErpKeysPort`, whose types are in `ports.ts`.
 *  - **Admin** — one gated screen, its sidebar entry and its palette action
 *    (`admin/index.tsx`), translated in `i18n/` (en, pl).
 *  - **Off** — an activation control: switched off it behaves as if never
 *    installed, and its keys stay where they are.
 *
 * `example` is the reference deployment and is composed nowhere a real shop
 * runs: the public demo is bare core (OR-12).
 */
export const EXAMPLE_ERP_KEYS_SETTING_CODES = {
  ACTIVATION: 'example_erp_keys.enabled',
} as const;

/** The host this module extends, and the side table it owns on it. */
export const EXAMPLE_ERP_KEYS_HOST = 'organizations.Organization';
export const EXAMPLE_ERP_KEYS_TABLE = 'example_erp_keys_organization_keys';

/** The one code the screen, its sidebar entry, its palette action and its route are gated on. */
export const EXAMPLE_ERP_KEYS_PERMISSION = 'example_erp_keys:read';

/** The module's own refusals, translated in its own bundles under `errors.<code>`. */
const exampleErpKeysErrorCodes = defineModuleErrorCodes(['EXAMPLE_ERP_KEYS_KEY_INVALID', 'EXAMPLE_ERP_KEYS_KEY_TAKEN']);

export const EXAMPLE_ERP_KEYS_ERROR_CODES = {
  /** 422 — the key handed to the create is not an ERP key. */
  KEY_INVALID: exampleErpKeysErrorCodes.EXAMPLE_ERP_KEYS_KEY_INVALID,
  /** 409 — another Organization holds the key. */
  KEY_TAKEN: exampleErpKeysErrorCodes.EXAMPLE_ERP_KEYS_KEY_TAKEN,
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'example_erp_keys',
  groups: [{ code: 'example_erp_keys', name: 'ERP keys' }],
  settings: [
    {
      code: EXAMPLE_ERP_KEYS_SETTING_CODES.ACTIVATION,
      name: 'ERP keys enabled',
      description:
        'Switches the ERP keys module on or off. Off, an Organization created with an ERP key is refused as if the module were not installed, no read carries the key and the screen is gone; nothing is dropped, and switching it back on restores every key as it was.',
      groupCode: 'example_erp_keys',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'example_erp_keys',
  name: 'ERP keys',
  description:
    'Reference overlay module of the example deployment: one unique ERP key per Organization, kept in a side table on organizations.',
  version: '1.0.0',
  // `organizations` owns the host: `extends` needs it in the dependency closure
  // (187 E3), it orders this module's migration after the one creating the
  // table its foreign key references, and the hook attaches to its action.
  // `auth` owns the `requireAdmin` the route resolves; `settings` carries the
  // activation control.
  dependencies: ['auth', 'organizations', 'settings'],
  activation: { settingCode: EXAMPLE_ERP_KEYS_SETTING_CODES.ACTIVATION, default: true },
  settings,
  i18n: { bundlesDir: 'i18n' },
  extends: [{ entity: EXAMPLE_ERP_KEYS_HOST, table: EXAMPLE_ERP_KEYS_TABLE }],
  errorCodes: Object.values(EXAMPLE_ERP_KEYS_ERROR_CODES).map((code) => ({ code })),
  permissions: [
    {
      code: EXAMPLE_ERP_KEYS_PERMISSION,
      module: 'example_erp_keys',
      label: 'Read the ERP keys of organizations',
    },
  ],
  // Principle XVI: the screen `admin/index.tsx` mounts is reachable from the
  // palette, on the code its route and its sidebar entry use.
  actions: [
    {
      id: 'open-example-erp-keys',
      labelKey: 'actions.openExampleErpKeys.label',
      descriptionKey: 'actions.openExampleErpKeys.description',
      icon: 'KeyRound',
      targetRoute: '/example-erp-keys',
      entryApiRoute: '/api/v1/admin/example-erp-keys/keys',
      requiredPermission: EXAMPLE_ERP_KEYS_PERMISSION,
      keywords: ['erp', 'key', 'organization', 'external id'],
      weight: 400,
    },
  ],
  // `specs/192-organization-merge/` FR-045 — a key names one Organization, so an
  // Organization merge says what becomes of the loser's: it moves to a survivor
  // that has none, and stays on the archived loser otherwise (`merge.ts`).
  merge: {
    participates: [
      {
        host: 'organization',
        key: 'erp-keys',
        phase: 'configuration',
        references: [
          { entity: 'ExampleErpOrganizationKey', property: 'organizationId', disposition: 'survivor_wins_fill_gaps' },
        ],
      },
    ],
  },
});
