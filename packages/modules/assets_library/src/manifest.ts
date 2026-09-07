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
        'Public-facing URL prefix for /assets/file/:assetId — leave blank to use the request host.',
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
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T092), which also made
  // the gate non-optional.
  dependencies: ['auth'],
  settings,
  // Feature 074 (Constitution XVII), test C3 — platform primitive. This module
  // had no activation declaration at all, which resolved as "always activated"
  // and read as an omission. Media storage carries no independent business
  // decision: product images, CMS media and e-mail assets all resolve here, and
  // "we do not want files" is not something a client chooses — it is something
  // a deployment does by mistake.
  activation: {
    nonDeactivatable: true,
    reason:
      'Media storage. Product images, CMS media and e-mail assets all resolve here, and "we ' +
      'do not want files" is not a business decision.',
  },
  /**
   * The fifteen error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where each sentence is looked up from: `errors.<CODE>` in
   * this module's own `i18n/{en,pl}.json`, which holds all fifteen in both
   * languages and no sixteenth.
   *
   * The list is answer-preserving, not a judgement (§6.2 and §6.5): it is
   * exactly what the prefix chain in `@endora-commerce/mod-i18n` routes here
   * today, copied from the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts` rather than
   * re-derived. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **One code a reader will look for here and not find.**
   * `ASSET_KIND_NOT_SUPPORTED` carries this module's own `ASSET_` prefix and is
   * `catalog`'s: the chain's `CATALOG_MISC_ERROR_CODES` set names it thirty
   * lines before the `ASSET_` rule is reached, so the prefix never runs on it.
   * `catalog` declares it and holds its sentence in that module's bundle. Read
   * from the chain's source it looks like ours; read from its answer — the only
   * reading that matches what a client receives today — it is not.
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
   * **No `tokens`, and it is derived rather than assumed.** The envelope's
   * `refusalToken` (`packages/platform/src/http/error-envelope.ts`) reads
   * exactly one member of `details` — `code`, and only when `details` is an
   * object — as the tail of `errors.<CODE>.<token>`. All twenty-nine raises of
   * these codes were enumerated over `packages` and `backend/src` rather than
   * over this package alone (runbook §5): twenty-seven pass no fourth argument
   * at all, and the two that do — `ASSET_REFERENCED` in
   * `assets-library.service.ts` and in `folders.service.ts` — pass the
   * Zod-style **array** of `{ path, issue }` pairs, which `refusalToken`
   * refuses by construction. The bundle agrees from the other direction: it
   * holds fifteen `errors.<CODE>` keys and not one `errors.<CODE>.<token>`.
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
