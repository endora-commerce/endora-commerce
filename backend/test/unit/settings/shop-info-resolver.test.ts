import { describe, expect, it } from 'vitest';
import { ShopInfoResolver } from '../../../src/modules/settings/services/shop-info-resolver.js';
import type { SettingsService, SettingsReadResult } from '../../../src/modules/settings/services/settings.service.js';

/**
 * Unit test for the shop-info mapping. Uses fakes for the EntityManager
 * connection (channel resolution) and the SettingsService (value resolution)
 * so the field-to-code mapping and the empty-string degradation are exercised
 * without a DB.
 */

function fakeEmFactory(channelId: string | null) {
  const conn = {
    execute: async () => (channelId ? [{ id: channelId }] : []),
  };
  return () => ({ getConnection: () => conn }) as never;
}

function fakeSettings(
  values: Map<string, SettingsReadResult<unknown>>,
): SettingsService {
  return {
    async getMany(codes: string[]) {
      const out = new Map<string, SettingsReadResult<unknown>>();
      for (const code of codes) {
        out.set(code, values.get(code) ?? { ok: false, error: 'not_registered' });
      }
      return out;
    },
  } as unknown as SettingsService;
}

describe('ShopInfoResolver', () => {
  it('maps shop.* settings onto the ShopInfo fields', async () => {
    const values = new Map<string, SettingsReadResult<unknown>>([
      ['shop.name', { ok: true, value: 'Acme' }],
      ['shop.address', { ok: true, value: '1 Main St' }],
      ['shop.contact_email', { ok: true, value: 'hello@acme.test' }],
      ['shop.support_email', { ok: true, value: 'support@acme.test' }],
      ['shop.phone', { ok: true, value: '+48 111 222 333' }],
    ]);
    const resolver = new ShopInfoResolver(fakeEmFactory('ch-1'), fakeSettings(values));
    const info = await resolver.resolve('main');
    expect(info).toEqual({
      name: 'Acme',
      address: '1 Main St',
      contactEmail: 'hello@acme.test',
      supportEmail: 'support@acme.test',
      phone: '+48 111 222 333',
    });
  });

  it('degrades unset / not-registered settings to empty strings', async () => {
    const values = new Map<string, SettingsReadResult<unknown>>([
      ['shop.support_email', { ok: true, value: 'support@acme.test' }],
      // everything else missing / not registered
    ]);
    const resolver = new ShopInfoResolver(fakeEmFactory('ch-1'), fakeSettings(values));
    const info = await resolver.resolve('main');
    expect(info.supportEmail).toBe('support@acme.test');
    expect(info.name).toBe('');
    expect(info.phone).toBe('');
  });

  it('returns all-empty when the channel cannot be resolved', async () => {
    const resolver = new ShopInfoResolver(fakeEmFactory(null), fakeSettings(new Map()));
    const info = await resolver.resolve(undefined);
    expect(info).toEqual({
      name: '',
      address: '',
      contactEmail: '',
      supportEmail: '',
      phone: '',
    });
  });
});
