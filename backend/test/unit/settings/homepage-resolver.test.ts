import { describe, expect, it } from 'vitest';
import { HomepageResolver } from '../../../src/modules/settings/services/homepage-resolver.js';
import type { SettingsService, SettingsReadResult } from '../../../src/kernel/settings/settings.service.js';

const CHANNEL_ID = '11111111-2222-3333-4444-555555555555';

function fakeSettings(value: SettingsReadResult<unknown> | undefined): SettingsService {
  return {
    async getMany(codes: string[]) {
      const out = new Map<string, SettingsReadResult<unknown>>();
      for (const code of codes) {
        out.set(code, value ?? { ok: false, error: 'not_registered' });
      }
      return out;
    },
  } as unknown as SettingsService;
}

describe('HomepageResolver', () => {
  it('returns the configured CMS page slug', async () => {
    const resolver = new HomepageResolver(fakeSettings({ ok: true, value: 'welcome' }));
    expect(await resolver.resolve(CHANNEL_ID)).toEqual({ cmsPageSlug: 'welcome' });
  });

  it('treats an empty / whitespace value as no home page', async () => {
    const resolver = new HomepageResolver(fakeSettings({ ok: true, value: '   ' }));
    expect(await resolver.resolve(CHANNEL_ID)).toEqual({ cmsPageSlug: null });
  });

  it('returns null when the setting is not registered', async () => {
    const resolver = new HomepageResolver(fakeSettings(undefined));
    expect(await resolver.resolve(CHANNEL_ID)).toEqual({ cmsPageSlug: null });
  });

  // The fourth case here asserted `{ cmsPageSlug: null }` "when the channel
  // cannot be resolved". That arm is gone with the channel lookup (feature 075
  // / D-87): the route hands over the id the middleware resolved, and an
  // unknown or inactive channel is refused before a handler runs. The scoping
  // it stood in for is pinned in `storefront-resolver-channel-scope.test.ts`,
  // which asserts the id reaching the settings read.
});
