import { describe, expect, it } from 'vitest';
import { GOOGLE_ANALYTICS_SETTING_CODES } from '@endora-commerce/contracts';
import { GaConfigService } from './ga-config.service.js';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';

/**
 * Fake SettingsReadPort — resolves from a per-code map; unknown codes throw
 * (mirroring SettingNotRegistered) so the service's graceful fallbacks are
 * exercised.
 */
function fakeSettings(values: Record<string, unknown>): SettingsReadPort {
  return {
    async get(code: string): Promise<unknown> {
      if (!(code in values)) throw new Error(`not registered: ${code}`);
      return values[code];
    },
  } as unknown as SettingsReadPort;
}

const C = GOOGLE_ANALYTICS_SETTING_CODES;

describe('GaConfigService', () => {
  it('resolves a fully tracked channel', async () => {
    const svc = new GaConfigService(
      fakeSettings({
        [C.ENABLED]: true,
        [C.MEASUREMENT_ID]: 'G-ABC123',
        [C.ENHANCED_ECOMMERCE_ENABLED]: true,
        [C.SERVER_SIDE_ENABLED]: true,
        [C.REQUIRE_CONSENT]: false,
      }),
      async () => [
        { eventName: 'lead', triggerAction: 'add_to_cart', buttonId: null, fields: [] },
      ],
    );
    const cfg = await svc.getConfig('chan-1');
    expect(cfg).toMatchObject({
      enabled: true,
      measurementId: 'G-ABC123',
      enhancedEcommerce: true,
      serverSide: true,
      requireConsent: false,
    });
    expect(cfg.customEvents).toHaveLength(1);
  });

  it('treats a blank Measurement ID as untracked (FR-004)', async () => {
    const svc = new GaConfigService(
      fakeSettings({ [C.ENABLED]: true, [C.MEASUREMENT_ID]: '   ', [C.REQUIRE_CONSENT]: true }),
    );
    const cfg = await svc.getConfig('chan-1');
    expect(cfg.enabled).toBe(false);
    expect(cfg.measurementId).toBeNull();
    expect(cfg.customEvents).toEqual([]);
  });

  it('emits nothing when the master switch is off', async () => {
    const svc = new GaConfigService(
      fakeSettings({ [C.ENABLED]: false, [C.MEASUREMENT_ID]: 'G-XYZ' }),
    );
    const cfg = await svc.getConfig('chan-1');
    expect(cfg.enabled).toBe(false);
    expect(cfg.measurementId).toBeNull();
  });

  it('falls back to safe defaults when settings are unregistered', async () => {
    const svc = new GaConfigService(fakeSettings({}));
    const cfg = await svc.getConfig('chan-1');
    expect(cfg.enabled).toBe(false);
    expect(cfg.requireConsent).toBe(true);
  });

  describe('isServerSideOn', () => {
    const tracked = {
      [C.ENABLED]: true,
      [C.MEASUREMENT_ID]: 'G-ABC123',
      [C.SERVER_SIDE_ENABLED]: true,
    };

    // Each case must agree with `getConfig().serverSide`: the collect route and
    // the storefront have to be given the same answer.
    it.each([
      ['a fully configured channel', tracked, true],
      ['the server-side switch off', { ...tracked, [C.SERVER_SIDE_ENABLED]: false }, false],
      ['a blank Measurement ID', { ...tracked, [C.MEASUREMENT_ID]: '   ' }, false],
      ['the master switch off', { ...tracked, [C.ENABLED]: false }, false],
      ['unregistered settings', {}, false],
    ])('answers for %s', async (_label, values, expected) => {
      const svc = new GaConfigService(fakeSettings(values));
      expect(await svc.isServerSideOn('chan-1')).toBe(expected);
      expect((await svc.getConfig('chan-1')).serverSide).toBe(expected);
    });

    it('does not load the custom events', async () => {
      let loads = 0;
      const svc = new GaConfigService(fakeSettings(tracked), async () => {
        loads += 1;
        return [];
      });
      await svc.isServerSideOn('chan-1');
      expect(loads).toBe(0);
    });
  });
});
