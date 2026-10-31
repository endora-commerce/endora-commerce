import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Built-in manifest for the Assets Library — feature 013 / research.md R13.
 * The Settings reconciler picks this up at boot and creates one DB row per
 * setting under the `storage` group. The active adapter and per-adapter
 * configuration are read by `AdapterRegistry` on demand.
 *
 * Limitation (v1): the Settings schema currently lacks a `redactedRead` flag,
 * so credentials (`assets.s3.secretAccessKey`, `assets.gcs.serviceAccountJson`)
 * are stored plaintext. FR-022 asked for masking parity with existing
 * sensitive settings — there is no existing mechanism to inherit. A follow-up
 * change to spec 004's manifest schema will add `redactedRead`; until then,
 * operators must restrict admin Settings access to trusted users.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'assets_library',
  groups: [
    {
      code: 'storage',
      name: 'Storage',
      // Empty salesChannelCodes ⇒ applies to every channel; assets are platform-global.
    },
  ],
  settings: [
    // — adapter selection
    {
      code: 'assets.storage.adapter',
      name: 'Active storage adapter',
      groupCode: 'storage',
      valueType: 'string',
      defaultValue: 'local',
      description: 'One of {local, s3, gcs}. Switching affects new uploads only.',
    },

    // — Local FS
    {
      code: 'assets.local.base_dir',
      name: 'Local FS — base directory',
      groupCode: 'storage',
      valueType: 'string',
      defaultValue: 'var/assets',
    },

    // — S3
    { code: 'assets.s3.bucket',           name: 'S3 — bucket',                            groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.s3.region',           name: 'S3 — region',                            groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.s3.access_key_id',    name: 'S3 — access key id',                     groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.s3.secret_access_key', name: 'S3 — secret access key (sensitive)',    groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.s3.endpoint',         name: 'S3 — custom endpoint (optional)',        groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.s3.prefix',           name: 'S3 — key prefix (optional)',             groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.s3.public_base_url',  name: 'S3 — public CDN base URL (optional)',    groupCode: 'storage', valueType: 'string', defaultValue: '' },

    // — GCS
    { code: 'assets.gcs.bucket',                name: 'GCS — bucket',                          groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.gcs.service_account_json',  name: 'GCS — service-account JSON (sensitive)', groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.gcs.prefix',                name: 'GCS — object prefix (optional)',         groupCode: 'storage', valueType: 'string', defaultValue: '' },
    { code: 'assets.gcs.public_base_url',       name: 'GCS — public CDN base URL (optional)',   groupCode: 'storage', valueType: 'string', defaultValue: '' },

    // — upload constraints
    {
      code: 'assets.allowed_file_types',
      name: 'Allowed file types (extensions/MIME; * = any)',
      groupCode: 'storage',
      valueType: 'string_list',
      defaultValue: ['*'],
    },
    {
      code: 'assets.max_file_size_mb',
      name: 'Max file size (MB; 0 = no cap)',
      groupCode: 'storage',
      valueType: 'number',
      defaultValue: 0,
    },

    // — visibility / lifecycle
    {
      code: 'assets.private_url_ttl_sec',
      name: 'Private signed-URL TTL (seconds)',
      groupCode: 'storage',
      valueType: 'number',
      defaultValue: 300,
    },
    {
      code: 'assets.soft_delete_retention_days',
      name: 'Soft-delete retention before hard-delete (days)',
      groupCode: 'storage',
      valueType: 'number',
      defaultValue: 30,
    },
    {
      code: 'assets.local.public_url_base',
      name: 'Local FS — public URL base (no trailing slash)',
      groupCode: 'storage',
      valueType: 'string',
      defaultValue: '',
      description:
        'Public-facing URL prefix for /assets/file/:assetId — a CDN or the public hostname a ' +
        'reverse proxy serves. Leave blank to build every URL on this deployment\'s public API ' +
        'origin (PUBLIC_API_BASE_URL).',
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'assets_library',
  name: 'Assets Library',
  description:
    'Storage adapter registry (local / S3 / GCS), asset upload, and reference tracking.',
  version: '1.0.0',
  /**
   * What this module needs from the environment (`specs/117-instance-bring-up/`
   * FR-002). Only what it **owns**: its reads of platform-owned names are
   * satisfied by `packages/platform/src/env/index.ts`.
   *
   * Why each of these is not a Setting is its entry in
   * `backend/scripts/ledgers/module-environment-inputs/assets_library.ts`.
   */
  env: [
    {
      name: 'ASSETS_LIBRARY_HMAC_KEY',
      describes: {
        en: 'The signing key that makes an asset download link valid, and unforgeable by anyone who has not got it.',
        pl: 'Klucz podpisujący, dzięki któremu link do pobrania zasobu jest ważny i nie do podrobienia bez jego znajomości.',
      },
      requirement: { kind: 'required' },
      secret: true,
      generable: true,
      owner: { kind: 'module', moduleId: 'assets_library' },
      consumers: ['backend'],
      addressOf: null,
    },
  ],
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T092), which also made
  // the gate non-optional.
  //
  // `admin_users` publishes `adminUserReadPort`, which the asset detail reads to
  // name who replaced the kept previous version (feature 156,
  // `specs/156-asset-stable-url/` research R-14). The read is one display
  // name; when nobody is found the detail answers `replacedBy: null`.
  //
  // `admin_roles` publishes `permissionService`, whose `listPermissions` tells
  // a holder of the platform wildcard `*` — who sees every asset — from a
  // reader whose files follow the records that use them
  // (`specs/166-asset-reference-visibility/` research R-3). `admin_roles` is
  // non-deactivatable, so the edge owes no degrade classification.
  dependencies: ['auth', 'admin_users', 'admin_roles'],
  settings,
  /**
   * The module's landing action under ⌘K (Constitution XVI) — "Assets library",
   * named like the sidebar entry: the product decision `specs/156-asset-stable-url/`
   * research R-16 records, with the name the owner ruled later. Its keywords keep
   * "media" so a search for the media library still finds it.
   */
  actions: [
    {
      id: 'open-assets-library',
      labelKey: 'actions.openLibrary.label',
      descriptionKey: 'actions.openLibrary.description',
      icon: 'Image',
      targetRoute: '/assets-library',
      requiredPermission: 'assets.read',
      keywords: [
        'assets',
        'assets library',
        'media',
        'media library',
        'files',
        'images',
        'permalink',
        'multimedia',
      ],
      keywordsKey: 'actions.openLibrary.keywords',
      weight: 250,
    },
  ],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. This module
  // had no activation declaration at all, which resolved as "always activated"
  // and read as an omission. Media storage carries no independent business
  // decision: product images, CMS media and e-mail assets all resolve here, and
  // "we do not want files" is not something a client chooses — it is something
  // a deployment does by mistake.
  /**
   * Nothing to demonstrate of its own (feature 113, T224 — contract §1.2).
   *
   * The demo shop does hold ~500 assets, and not one of them is this module's
   * demo data: every one is minted inside a loop over `catalog`'s products and
   * its id handed straight to `product_assets`, `gallery_items`,
   * `gallery_item_labels` or `product_attachments`. An asset with no product to
   * belong to would demonstrate nothing, and an asset that has one is two
   * modules' rows in one statement — a composition step (§5.1), and one whose
   * filename and generated image are derived from the product it hangs off.
   *
   * `false` rather than absent, because the two are different states: this is a
   * decision that the module owes nothing, not a module nobody has looked at.
   */
  demo: false,
  activation: {
    nonDeactivatable: true,
    reason:
      'Media storage. Product images, CMS media and e-mail assets all resolve here, and "we ' +
      'do not want files" is not a business decision.',
  },
  /**
   * The twenty-two error codes this module owns — fifteen from feature 090
   * Phase 3 (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1) and seven minted by feature 156 (`specs/156-asset-stable-url/`).
   * This is where each sentence is looked up from: `errors.<CODE>` in this
   * module's own `i18n/{en,pl}.json`, which holds all twenty-two in both
   * languages and no twenty-third.
   *
   * The fifteen are answer-preserving, not a judgement (§6.2 and §6.5): they are
   * exactly what the prefix chain that used to route error codes sent here,
   * copied from the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts` rather than
   * re-derived. That chain is deleted; routing is now built from these
   * declarations and held to the capture by
   * `backend/test/unit/kernel/error-code-routing-equality.test.ts`. Re-routing
   * a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **One code a reader will look for here and not find.**
   * `ASSET_KIND_NOT_SUPPORTED` carries this module's own `ASSET_` prefix and is
   * `catalog`'s. The capture records it so because the chain named it, one code
   * at a time, among `catalog`'s before its `ASSET_` rule was reached. It is
   * also what the code does: both raise sites are `catalog`'s —
   * `attachment.service.ts` and `gallery.service.ts`, refusing an asset kind a
   * product's attachments or gallery do not accept — and `catalog` declares it
   * and holds its sentence in that module's bundle. Nothing in this package
   * raises it.
   *
   * **This module's list and this module's `throw`s are two different sets, in
   * both directions**, because ownership follows the domain noun and never the
   * thrower (D-95.2). Going one way, `ASSET_STORAGE_MISCONFIGURED` is declared
   * here, is written in both languages, and has **no raise site anywhere in the
   * tree** — nothing routes to it, so its two sentences are unreachable today.
   * That is neither this merge request's to fix nor a finding any check makes
   * (`check:error-translations`' `unreachable` asks the other question: a
   * sentence written where the chain does not route). Going the other way, the
   * two codes this module raises and does not own are `INTERNAL` and
   * `VALIDATION_FAILED`, both the platform's.
   *
   * **One code with `tokens`, and it is derived rather than assumed.** The
   * envelope's `refusalToken` (`packages/platform/src/http/error-envelope.ts`)
   * reads exactly one member of `details` — `code`, and only when `details` is
   * an object — as the tail of `errors.<CODE>.<token>`. Of the fifteen codes of
   * feature 090, all twenty-nine raises were enumerated over `packages` and
   * `backend/src` rather than over this package alone (runbook §5):
   * twenty-seven pass no fourth argument at all, and the two that do —
   * `ASSET_REFERENCED` in `assets-library.service.ts` and in
   * `folders.service.ts` — pass the Zod-style **array** of `{ path, issue }`
   * pairs, which `refusalToken` refuses by construction. Of the seven of
   * feature 156, `ASSET_PERMALINK_INVALID` passes `details.code` — the reason
   * `validateAssetPermalink` (`@endora-commerce/contracts`) names — so it
   * declares those five reasons as tokens, and the bundle holds one
   * `errors.ASSET_PERMALINK_INVALID.<reason>` sentence for each; the other six
   * pass no `details.code`.
   */
  errorCodes: [
    { code: 'ASSET_ACCESS_DENIED' },
    { code: 'ASSET_FILE_MISSING' },
    { code: 'ASSET_FOLDER_CYCLE' },
    { code: 'ASSET_FOLDER_NAME_CONFLICT' },
    { code: 'ASSET_FOLDER_NOT_EMPTY' },
    { code: 'ASSET_FOLDER_NOT_FOUND' },
    { code: 'ASSET_GONE' },
    { code: 'ASSET_LEGACY_LOCATOR_CANNOT_HARDEN' },
    { code: 'ASSET_NOT_FOUND' },
    { code: 'ASSET_REFERENCED' },
    { code: 'ASSET_STORAGE_MISCONFIGURED' },
    { code: 'ASSET_STORAGE_UNAVAILABLE' },
    { code: 'ASSET_UPLOAD_NO_FILE' },
    { code: 'ASSET_UPLOAD_TOO_LARGE' },
    { code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED' },
    { code: 'ASSET_REPLACE_KIND_MISMATCH' },
    { code: 'ASSET_LEGACY_CANNOT_REPLACE' },
    { code: 'ASSET_REPLACE_CONFLICT' },
    { code: 'ASSET_NO_PREVIOUS_VERSION' },
    { code: 'ASSET_PERMALINK_TAKEN' },
    { code: 'ASSET_PERMALINK_PREVIOUSLY_USED' },
    {
      code: 'ASSET_PERMALINK_INVALID',
      tokens: ['empty', 'too_long', 'invalid_characters', 'invalid_segment', 'uuid_shaped'],
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  permissions: [
    { code: 'assets.read', label: 'Browse assets library' },
    { code: 'assets.write', label: 'Upload and manage assets' },
  ],
});

/** Legacy export retained for backward compatibility. */
export const assetsLibraryManifest = settings;
