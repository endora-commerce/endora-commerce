// AdapterSettingsView impl that reads the Library's settings through the
// platform's settings read (`settingsReadPort`), platform-wide.
//
// Every `assets.*` setting is platform-global: its group names no sales
// channel, and the bytes of an asset do not depend on which storefront asked.
// So every read passes `null` as the channel, which the platform resolves as
// `global_value ?? default_value` — the tier the Admin Settings screen writes
// as its "Platform-wide global override". A per-channel `setting_values` row is
// never consulted (issue #333): reading `setting_values` by hand used to skip
// `global_value` altogether and answer with whichever channel's row it found.
//
// The reads are infrequent (once per upload / once per adapter build), and the
// platform read brings its own cache, which the admin write drops.
//
// AdapterRegistry consumes this view; we keep it separate to make the
// adapter side trivially mockable in tests.

import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { AdapterSettingsView } from './adapter-registry.js';

const ADAPTER_CODES = ['local', 's3', 'gcs'] as const;

/** What an upload is checked against: `['*']` is any type, `0` is no limit. */
export interface UploadPolicy {
  allowedTypes: string[];
  maxFileSizeMb: number;
}

export interface AssetsSettingsView extends AdapterSettingsView {
  /** `assets.soft_delete_retention_days` as read now (at least one day). */
  softDeleteRetentionDays(): Promise<number>;
  /** `assets.allowed_file_types` and `assets.max_file_size_mb` as read now. */
  uploadPolicy(): Promise<UploadPolicy>;
}

/** The registered values among `codes`; a code that is not registered is absent. */
type Read = ReadonlyMap<string, unknown>;

export function createSettingsView(
  settings: Pick<SettingsReadPort, 'getMany'>,
): AssetsSettingsView {
  async function read(codes: string[]): Promise<Read> {
    // `getMany` rather than `get`: it takes no schema, so a value of the wrong
    // shape reaches the module's own coercion below — which answers it as the
    // fallback (FR-035) — instead of throwing, and a missing code is a result
    // rather than an exception.
    const results = await settings.getMany(codes, null);
    const out = new Map<string, unknown>();
    for (const [code, result] of results) {
      if (result.ok) {
        out.set(code, result.value);
      } else if (result.error === 'out_of_scope') {
        // Every `assets.*` setting applies to all channels; one limited to some
        // has no platform-wide answer, and saying "missing" would mislead.
        throw new Error(
          `Assets Library settings: "${code}" is limited to some sales channels and has no platform-wide value.`,
        );
      }
    }
    return out;
  }

  function stringOf(values: Read, code: string): string {
    if (!values.has(code)) {
      throw new Error(`Assets Library settings: missing setting "${code}".`);
    }
    const raw = values.get(code);
    return typeof raw === 'string' ? raw : String(raw ?? '');
  }

  async function readString(code: string): Promise<string> {
    return stringOf(await read([code]), code);
  }

  async function readStrings<K extends string>(codes: Record<K, string>): Promise<Record<K, string>> {
    const values = await read(Object.values(codes));
    const out = {} as Record<K, string>;
    for (const key of Object.keys(codes) as K[]) out[key] = stringOf(values, codes[key]);
    return out;
  }

  async function readNumber(code: string, fallback: number): Promise<number> {
    const raw = (await read([code])).get(code);
    // Only a number, or a string that spells one, is a value: `Number('')`,
    // `Number(null)` and `Number([])` are 0, which is not what an empty setting
    // means (FR-035 — a missing or non-numeric value applies as the fallback).
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
    return Number.isFinite(n) ? n : fallback;
  }

  return {
    async softDeleteRetentionDays() {
      // At least one day (owner ruling P3, specs/156-asset-stable-url/): a zero
      // setting must not make a deletion or a replaced file due at once.
      const days = await readNumber('assets.soft_delete_retention_days', 30);
      return days >= 0 ? Math.max(1, days) : 30;
    },
    async uploadPolicy() {
      const values = await read(['assets.allowed_file_types', 'assets.max_file_size_mb']);
      const allowedRaw = values.has('assets.allowed_file_types')
        ? values.get('assets.allowed_file_types')
        : ['*'];
      const allowedTypes = Array.isArray(allowedRaw) ? allowedRaw.map(String) : ['*'];
      const maxRaw = values.get('assets.max_file_size_mb') ?? 0;
      const maxFileSizeMb = typeof maxRaw === 'number' ? maxRaw : Number(maxRaw) || 0;
      return { allowedTypes, maxFileSizeMb };
    },
    async activeAdapter() {
      const v = (await readString('assets.storage.adapter')).trim();
      if ((ADAPTER_CODES as readonly string[]).includes(v)) {
        return v as 'local' | 's3' | 'gcs';
      }
      return 'local';
    },
    localBaseDir() {
      return readString('assets.local.base_dir');
    },
    localPublicUrlBase() {
      return readString('assets.local.public_url_base');
    },
    privateUrlTtlSec() {
      return readNumber('assets.private_url_ttl_sec', 300);
    },
    s3Config() {
      return readStrings({
        bucket: 'assets.s3.bucket',
        region: 'assets.s3.region',
        accessKeyId: 'assets.s3.access_key_id',
        secretAccessKey: 'assets.s3.secret_access_key',
        endpoint: 'assets.s3.endpoint',
        prefix: 'assets.s3.prefix',
        publicBaseUrl: 'assets.s3.public_base_url',
      });
    },
    gcsConfig() {
      return readStrings({
        bucket: 'assets.gcs.bucket',
        serviceAccountJson: 'assets.gcs.service_account_json',
        prefix: 'assets.gcs.prefix',
        publicBaseUrl: 'assets.gcs.public_base_url',
      });
    },
  };
}
