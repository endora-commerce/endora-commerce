// AdapterSettingsView impl that reads platform-global Library settings
// directly from the `settings` table (no per-channel scope, no cache). The
// reads are infrequent (once per upload / once per resolveUrl miss), so a
// direct DB hit is fine.
//
// AdapterRegistry consumes this view; we keep it separate to make the
// adapter side trivially mockable in tests.

import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting } from '../../../settings/entities/setting.entity.js';
import { SettingValue } from '../../../settings/entities/setting-value.entity.js';
import type { AdapterSettingsView } from './adapter-registry.js';

const ADAPTER_CODES = ['local', 's3', 'gcs'] as const;

export function createSettingsView(
  emFactory: () => EntityManager,
): AdapterSettingsView {
  async function readString(code: string): Promise<string> {
    const em = emFactory();
    const setting = await em.findOne(Setting, { code });
    if (!setting) {
      throw new Error(`Assets Library settings: missing setting "${code}".`);
    }
    // Platform-global settings have no per-channel override in v1; the
    // setting_values table is empty for these codes. Returning defaultValue
    // is the correct behaviour.
    const override = await em.findOne(SettingValue, { setting: setting });
    const raw = override ? override.value : setting.defaultValue;
    return typeof raw === 'string' ? raw : String(raw ?? '');
  }
  async function readNumber(code: string, fallback: number): Promise<number> {
    const em = emFactory();
    const setting = await em.findOne(Setting, { code });
    if (!setting) return fallback;
    const override = await em.findOne(SettingValue, { setting: setting });
    const raw = override ? override.value : setting.defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  return {
    async activeAdapter() {
      const v = (await readString('assets.storage.adapter')).trim();
      if ((ADAPTER_CODES as readonly string[]).includes(v)) {
        return v as 'local' | 's3' | 'gcs';
      }
      // Fall back to local on any garbage so the platform remains bootable;
      // an admin who saved a bad value can fix it without a redeploy.
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
  };
}
