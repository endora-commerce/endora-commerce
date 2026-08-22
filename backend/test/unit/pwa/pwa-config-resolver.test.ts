import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { PWA_SETTING_CODES } from '@endora-commerce/contracts';
import { PwaConfigResolver } from '../../../src/modules/pwa/services/pwa-config-resolver.js';

/** Fake SettingsReadPort backed by a plain map; missing codes throw (like the real service). */
function fakeSettings(values: Record<string, unknown>) {
  return {
    async get<T>(code: string, _channelId: string, schema: z.ZodType<T>): Promise<T> {
      if (!(code in values)) throw new Error(`SettingNotRegistered: ${code}`);
      return schema.parse(values[code]);
    },
  };
}

/** Fake EM whose `find` always returns [] (no icon renditions → placeholders). */
const fakeEmFactory = () => ({ async find() { return []; } }) as never;

describe('PwaConfigResolver.getPublicConfig (feature 046)', () => {
  it('falls back to defaults when settings are unregistered', async () => {
    const resolver = new PwaConfigResolver(fakeSettings({}), fakeEmFactory);
    const config = await resolver.getPublicConfig('channel-1');
    expect(config.appName).toBe('B2B Platform');
    expect(config.displayMode).toBe('standalone');
    expect(config.cachingEnabled).toBe(false);
    expect(config.pushEnabled).toBe(false);
    expect(config.icons.length).toBeGreaterThanOrEqual(2);
    expect(config.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('reflects configured identity + caching toggle', async () => {
    const resolver = new PwaConfigResolver(
      fakeSettings({
        [PWA_SETTING_CODES.APP_NAME]: 'Acme Store',
        [PWA_SETTING_CODES.SHORT_NAME]: 'Acme',
        [PWA_SETTING_CODES.CACHING_ENABLED]: true,
      }),
      fakeEmFactory,
    );
    const config = await resolver.getPublicConfig('channel-1');
    expect(config.appName).toBe('Acme Store');
    expect(config.shortName).toBe('Acme');
    expect(config.cachingEnabled).toBe(true);
  });

  it('never exposes the private VAPID key and gates pushEnabled on a public key', async () => {
    // push enabled but no public key → pushEnabled false, key empty.
    const noKey = new PwaConfigResolver(
      fakeSettings({ [PWA_SETTING_CODES.PUSH_ENABLED]: true }),
      fakeEmFactory,
    );
    const a = await noKey.getPublicConfig('c1');
    expect(a.pushEnabled).toBe(false);
    expect(a.vapidPublicKey).toBe('');

    // push enabled + public key → pushEnabled true, only the PUBLIC key surfaces.
    const withKey = new PwaConfigResolver(
      fakeSettings({
        [PWA_SETTING_CODES.PUSH_ENABLED]: true,
        [PWA_SETTING_CODES.VAPID_PUBLIC_KEY]: 'BPUBLIC',
        [PWA_SETTING_CODES.VAPID_PRIVATE_KEY]: 'PRIVATE-SHOULD-NOT-LEAK',
      }),
      fakeEmFactory,
    );
    const b = await withKey.getPublicConfig('c1');
    expect(b.pushEnabled).toBe(true);
    expect(b.vapidPublicKey).toBe('BPUBLIC');
    expect(JSON.stringify(b)).not.toContain('PRIVATE-SHOULD-NOT-LEAK');
  });
});
