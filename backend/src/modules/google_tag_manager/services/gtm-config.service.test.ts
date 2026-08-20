import { describe, expect, it } from 'vitest';
import { GOOGLE_TAG_MANAGER_SETTING_CODES } from '@b2b/contracts';
import { GtmConfigService } from './gtm-config.service.js';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

/**
 * Fake SettingsService — resolves from a per-code map; unknown codes throw
 * (mirroring SettingNotRegistered) so the service's graceful fallbacks are
 * exercised.
 */
function fakeSettings(values: Record<string, unknown>): SettingsService {
  return {
    async get(code: string): Promise<unknown> {
      if (!(code in values)) throw new Error(`not registered: ${code}`);
      return values[code];
    },
  } as unknown as SettingsService;
}

const C = GOOGLE_TAG_MANAGER_SETTING_CODES;

describe('GtmConfigService', () => {
  it('resolves a fully tracked, client-side channel', async () => {
    const svc = new GtmConfigService(
      fakeSettings({
        [C.ENABLED]: true,
        [C.CONTAINER_ID]: 'GTM-ABC1234',
        [C.REQUIRE_CONSENT]: false,
        [C.SERVER_SIDE_ENABLED]: false,
        [C.SERVER_CONTAINER_URL]: '',
        [C.SERVER_INGEST_PATH]: '/data',
      }),
    );
    await expect(svc.getConfig('chan-1')).resolves.toEqual({
      enabled: true,
      containerId: 'GTM-ABC1234',
      requireConsent: false,
      serverSide: false,
    });
  });

  it('is disabled when the master switch is off, preserving requireConsent', async () => {
    const svc = new GtmConfigService(
      fakeSettings({
        [C.ENABLED]: false,
        [C.CONTAINER_ID]: 'GTM-ABC1234',
        [C.REQUIRE_CONSENT]: false,
      }),
    );
    const cfg = await svc.getConfig('chan-1');
    expect(cfg.enabled).toBe(false);
    expect(cfg.containerId).toBeNull();
    expect(cfg.requireConsent).toBe(false);
  });

  it('treats a blank container id as untracked (FR-004)', async () => {
    const svc = new GtmConfigService(
      fakeSettings({
        [C.ENABLED]: true,
        [C.CONTAINER_ID]: '   ',
        [C.REQUIRE_CONSENT]: true,
      }),
    );
    const cfg = await svc.getConfig('chan-1');
    expect(cfg.enabled).toBe(false);
    expect(cfg.containerId).toBeNull();
    expect(cfg.requireConsent).toBe(true);
  });

  it('treats a malformed container id as untracked (FR-005)', async () => {
    // A malformed stored value must never reach a <script src>.
    for (const bad of ['G-ABC1234', 'gtm-abc1234', 'GTM-', 'GTM-ABCDEFGHIJKL']) {
      const svc = new GtmConfigService(
        fakeSettings({
          [C.ENABLED]: true,
          [C.CONTAINER_ID]: bad,
          [C.REQUIRE_CONSENT]: true,
        }),
      );
      const cfg = await svc.getConfig('chan-1');
      expect(cfg.enabled, bad).toBe(false);
      expect(cfg.containerId, bad).toBeNull();
      expect(cfg.requireConsent, bad).toBe(true);
    }
  });

  it('trims a padded container id rather than rejecting it', async () => {
    const svc = new GtmConfigService(
      fakeSettings({
        [C.ENABLED]: true,
        [C.CONTAINER_ID]: '  GTM-ABC1234  ',
        [C.REQUIRE_CONSENT]: true,
      }),
    );
    const cfg = await svc.getConfig('chan-1');
    expect(cfg.enabled).toBe(true);
    expect(cfg.containerId).toBe('GTM-ABC1234');
  });

  it('reports serverSide only when a server container URL is configured (FR-031)', async () => {
    const withUrl = new GtmConfigService(
      fakeSettings({
        [C.ENABLED]: true,
        [C.CONTAINER_ID]: 'GTM-ABC1234',
        [C.REQUIRE_CONSENT]: true,
        [C.SERVER_SIDE_ENABLED]: true,
        [C.SERVER_CONTAINER_URL]: 'https://sgtm.example.com',
      }),
    );
    expect((await withUrl.getConfig('chan-1')).serverSide).toBe(true);

    const blankUrl = new GtmConfigService(
      fakeSettings({
        [C.ENABLED]: true,
        [C.CONTAINER_ID]: 'GTM-ABC1234',
        [C.REQUIRE_CONSENT]: true,
        [C.SERVER_SIDE_ENABLED]: true,
        [C.SERVER_CONTAINER_URL]: '   ',
      }),
    );
    expect((await blankUrl.getConfig('chan-1')).serverSide).toBe(false);

    const switchOff = new GtmConfigService(
      fakeSettings({
        [C.ENABLED]: true,
        [C.CONTAINER_ID]: 'GTM-ABC1234',
        [C.REQUIRE_CONSENT]: true,
        [C.SERVER_SIDE_ENABLED]: false,
        [C.SERVER_CONTAINER_URL]: 'https://sgtm.example.com',
      }),
    );
    expect((await switchOff.getConfig('chan-1')).serverSide).toBe(false);
  });

  it('degrades every read to its default when nothing is registered', async () => {
    const svc = new GtmConfigService(fakeSettings({}));
    await expect(svc.getConfig('chan-1')).resolves.toEqual({
      enabled: false,
      containerId: null,
      requireConsent: true,
      serverSide: false,
    });
  });
});
