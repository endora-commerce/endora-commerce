import { describe, expect, it } from 'vitest';
import { ShopInfoResolver } from '../../../../packages/modules/settings/src/backend/services/shop-info-resolver.js';
import type { SettingsService, SettingsReadResult } from '../../../src/kernel/settings/settings.service.js';

/**
 * Unit test for the shop-info mapping. The SettingsService is faked so the
 * field-to-code mapping and the empty-string degradation are exercised without
 * a DB. There is no EntityManager fake since feature 075 / D-87: the resolver
 * takes the channel id its route resolved instead of looking one up.
 */

const CHANNEL_ID = '11111111-2222-3333-4444-555555555555';

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
    const resolver = new ShopInfoResolver(fakeSettings(values));
    const info = await resolver.resolve(CHANNEL_ID);
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
    const resolver = new ShopInfoResolver(fakeSettings(values));
    const info = await resolver.resolve(CHANNEL_ID);
    expect(info.supportEmail).toBe('support@acme.test');
    expect(info.name).toBe('');
    expect(info.phone).toBe('');
  });

  it('degrades every field when the channel has nothing configured', async () => {
    // This case used to be "the channel cannot be resolved", fed by an
    // EntityManager fake returning no row. The lookup is gone (feature 075 /
    // D-87) and the all-empty answer now means what it says: a real channel
    // with no `shop.*` value set.
    const resolver = new ShopInfoResolver(fakeSettings(new Map()));
    const info = await resolver.resolve(CHANNEL_ID);
    expect(info).toEqual({
      name: '',
      address: '',
      contactEmail: '',
      supportEmail: '',
      phone: '',
    });
  });
});
