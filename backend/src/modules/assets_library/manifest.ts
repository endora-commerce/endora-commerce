import { defineModuleSettingsManifest } from '@b2b/contracts';

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
export const assetsLibraryManifest = defineModuleSettingsManifest({
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
