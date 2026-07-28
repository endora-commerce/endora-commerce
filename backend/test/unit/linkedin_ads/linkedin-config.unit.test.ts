import { describe, expect, it } from 'vitest';
import { LINKEDIN_ADS_SETTING_CODES } from '@b2b/contracts';
import { LinkedInConfigService } from '../../../src/modules/linkedin_ads/services/linkedin-config.service.js';
import type { SettingsService } from '../../../src/modules/settings/services/settings.service.js';

/**
 * The kill switch and the fail-safe read path — the two behaviours that decide
 * whether a visitor gets a LinkedIn script at all (FR-003, FR-004, FR-019).
 */

/** Minimal stand-in: resolves declared codes, throws for anything else. */
function settingsStub(values: Record<string, unknown>): SettingsService {
  return {
    async get(code: string): Promise<unknown> {
      if (!(code in values)) throw new Error(`setting not registered: ${code}`);
      return values[code];
    },
  } as unknown as SettingsService;
}

const CH = 'channel-1';

describe('LinkedInConfigService', () => {
  it('reports disabled when the master switch is off', async () => {
    const svc = new LinkedInConfigService(
      settingsStub({
        [LINKEDIN_ADS_SETTING_CODES.ENABLED]: false,
        [LINKEDIN_ADS_SETTING_CODES.PARTNER_ID]: '1234567',
        [LINKEDIN_ADS_SETTING_CODES.REQUIRE_CONSENT]: true,
      }),
      async () => [{ triggerAction: 'purchase', conversionId: '99' }],
    );
    const config = await svc.getConfig(CH);
    expect(config.enabled).toBe(false);
    expect(config.partnerId).toBeNull();
    expect(config.conversionMappings).toEqual([]);
  });

  it('treats a blank or whitespace-only partner id as not configured', async () => {
    for (const partnerId of ['', '   ']) {
      const svc = new LinkedInConfigService(
        settingsStub({
          [LINKEDIN_ADS_SETTING_CODES.ENABLED]: true,
          [LINKEDIN_ADS_SETTING_CODES.PARTNER_ID]: partnerId,
          [LINKEDIN_ADS_SETTING_CODES.REQUIRE_CONSENT]: true,
        }),
      );
      const config = await svc.getConfig(CH);
      expect(config.enabled).toBe(false);
      expect(config.partnerId).toBeNull();
    }
  });

  it('reports the operator consent choice even for an untracked channel', async () => {
    const svc = new LinkedInConfigService(
      settingsStub({
        [LINKEDIN_ADS_SETTING_CODES.ENABLED]: false,
        [LINKEDIN_ADS_SETTING_CODES.PARTNER_ID]: '',
        [LINKEDIN_ADS_SETTING_CODES.REQUIRE_CONSENT]: false,
      }),
    );
    expect((await svc.getConfig(CH)).requireConsent).toBe(false);
  });

  it('resolves a configured channel with its mappings', async () => {
    const svc = new LinkedInConfigService(
      settingsStub({
        [LINKEDIN_ADS_SETTING_CODES.ENABLED]: true,
        [LINKEDIN_ADS_SETTING_CODES.PARTNER_ID]: ' 1234567 ',
        [LINKEDIN_ADS_SETTING_CODES.REQUIRE_CONSENT]: true,
        [LINKEDIN_ADS_SETTING_CODES.SERVER_SIDE_ENABLED]: true,
      }),
      async () => [{ triggerAction: 'purchase', conversionId: '99' }],
    );
    const config = await svc.getConfig(CH);
    expect(config).toMatchObject({
      enabled: true,
      partnerId: '1234567',
      requireConsent: true,
      serverSide: true,
    });
    expect(config.conversionMappings).toHaveLength(1);
  });

  it('degrades an unregistered setting to its default instead of throwing', async () => {
    // Only ENABLED and PARTNER_ID are registered; the rest must fall back so an
    // incomplete settings catalogue cannot fail a storefront render.
    const svc = new LinkedInConfigService(
      settingsStub({
        [LINKEDIN_ADS_SETTING_CODES.ENABLED]: true,
        [LINKEDIN_ADS_SETTING_CODES.PARTNER_ID]: '1234567',
      }),
    );
    const config = await svc.getConfig(CH);
    expect(config.enabled).toBe(true);
    expect(config.requireConsent).toBe(true);
    expect(config.serverSide).toBe(false);
  });
});
