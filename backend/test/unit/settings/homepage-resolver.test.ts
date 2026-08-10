import { describe, expect, it } from 'vitest';
import { HomepageResolver } from '../../../src/modules/settings/services/homepage-resolver.js';
import type { SettingsService, SettingsReadResult } from '../../../src/kernel/settings/settings.service.js';

function fakeEmFactory(channelId: string | null) {
  const conn = { execute: async () => (channelId ? [{ id: channelId }] : []) };
  return () => ({ getConnection: () => conn }) as never;
}

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
    const resolver = new HomepageResolver(
      fakeEmFactory('ch-1'),
      fakeSettings({ ok: true, value: 'welcome' }),
    );
    expect(await resolver.resolve('main')).toEqual({ cmsPageSlug: 'welcome' });
  });

  it('treats an empty / whitespace value as no home page', async () => {
    const resolver = new HomepageResolver(
      fakeEmFactory('ch-1'),
      fakeSettings({ ok: true, value: '   ' }),
    );
    expect(await resolver.resolve('main')).toEqual({ cmsPageSlug: null });
  });

  it('returns null when the setting is not registered', async () => {
    const resolver = new HomepageResolver(fakeEmFactory('ch-1'), fakeSettings(undefined));
    expect(await resolver.resolve('main')).toEqual({ cmsPageSlug: null });
  });

  it('returns null when the channel cannot be resolved', async () => {
    const resolver = new HomepageResolver(
      fakeEmFactory(null),
      fakeSettings({ ok: true, value: 'welcome' }),
    );
    expect(await resolver.resolve(undefined)).toEqual({ cmsPageSlug: null });
  });
});
