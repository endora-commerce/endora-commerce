import { describe, expect, it } from 'vitest';
import { META_ADS_SETTING_CODES } from '@endora-commerce/contracts';
import { MetaConfigService } from '../../../src/modules/meta_ads/services/meta-config.service.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';

/** The kill switch and the fail-safe read path (FR-003, FR-004, FR-013). */

function settingsStub(values: Record<string, unknown>): SettingsService {
  return {
    async get(code: string): Promise<unknown> {
      if (!(code in values)) throw new Error(`setting not registered: ${code}`);
      return values[code];
    },
  } as unknown as SettingsService;
}

const CH = 'channel-1';

describe('MetaConfigService', () => {
  it('reports disabled when the master switch is off', async () => {
    const svc = new MetaConfigService(
      settingsStub({
        [META_ADS_SETTING_CODES.ENABLED]: false,
        [META_ADS_SETTING_CODES.PIXEL_ID]: '123',
        [META_ADS_SETTING_CODES.REQUIRE_CONSENT]: true,
      }),
      async () => [{ triggerAction: 'purchase', eventName: 'BigOrder' }],
    );
    const config = await svc.getConfig(CH);
    expect(config.enabled).toBe(false);
    expect(config.pixelId).toBeNull();
    expect(config.customEvents).toEqual([]);
  });

  it('treats a blank or whitespace-only pixel id as not configured', async () => {
    for (const pixelId of ['', '   ']) {
      const svc = new MetaConfigService(
        settingsStub({
          [META_ADS_SETTING_CODES.ENABLED]: true,
          [META_ADS_SETTING_CODES.PIXEL_ID]: pixelId,
          [META_ADS_SETTING_CODES.REQUIRE_CONSENT]: true,
        }),
      );
      const config = await svc.getConfig(CH);
      expect(config.enabled).toBe(false);
      expect(config.pixelId).toBeNull();
    }
  });

  it('resolves a configured channel with its custom events', async () => {
    const svc = new MetaConfigService(
      settingsStub({
        [META_ADS_SETTING_CODES.ENABLED]: true,
        [META_ADS_SETTING_CODES.PIXEL_ID]: ' 9876543210 ',
        [META_ADS_SETTING_CODES.REQUIRE_CONSENT]: false,
      }),
      async () => [{ triggerAction: 'purchase', eventName: 'BigOrder' }],
    );
    const config = await svc.getConfig(CH);
    expect(config).toMatchObject({ enabled: true, pixelId: '9876543210', requireConsent: false });
    expect(config.customEvents).toHaveLength(1);
  });

  it('degrades an unregistered setting to its default instead of throwing', async () => {
    const svc = new MetaConfigService(
      settingsStub({
        [META_ADS_SETTING_CODES.ENABLED]: true,
        [META_ADS_SETTING_CODES.PIXEL_ID]: '9876543210',
      }),
    );
    const config = await svc.getConfig(CH);
    expect(config.enabled).toBe(true);
    expect(config.requireConsent).toBe(true);
  });
});
