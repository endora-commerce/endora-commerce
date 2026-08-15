import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannelResolverService } from '../../../src/kernel/sales-channels/sales-channel-resolver.service.js';
import { NoSystemDefaultChannel } from '../../../src/kernel/sales-channels/no-system-default-channel.error.js';
import type { SalesChannelsCache } from '../../../src/kernel/sales-channels/sales-channels-cache.js';

/**
 * D-48 — `getSystemDefault()` is non-nullable.
 *
 * The nullable signature described a state D-47 measured as unreachable: the
 * boot reconciler inserts or promotes a default on every serving path, a
 * partial unique index forbids a second, and the CRUD service refuses every
 * delete, deactivate and `active:false` that would take the flag away. What the
 * `| null` bought was an obligation on every caller to invent a value for a
 * branch that cannot be taken — and four of them did, spelling it `'default'`,
 * the nil UUID, a `randomUUID()` persisted into an order, and a silent switch
 * to the platform-wide settings tier.
 *
 * Reading before composition has run the reconciler is the one way to observe
 * it, and it now says so.
 */
describe('SalesChannelResolverService.getSystemDefault (D-48)', () => {
  function resolverOver(row: unknown): SalesChannelResolverService {
    const em = { findOne: async () => row } as unknown as EntityManager;
    const cache = {
      get: async () => ({ hit: false as const, value: null }),
      set: async () => undefined,
      setNotFound: async () => undefined,
    } as unknown as SalesChannelsCache;
    return new SalesChannelResolverService(() => em, cache);
  }

  it('throws NoSystemDefaultChannel instead of returning null', async () => {
    await expect(resolverOver(null).getSystemDefault()).rejects.toBeInstanceOf(
      NoSystemDefaultChannel,
    );
  });

  it('answers 500 INTERNAL, the same envelope the middleware used to build itself', async () => {
    const error = await resolverOver(null)
      .getSystemDefault()
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 500, code: 'INTERNAL' });
    expect((error as Error).message).toContain('reconciler');
  });

  it('returns the flagged channel when there is one', async () => {
    const row = {
      id: '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34',
      code: 'anything-at-all',
      name: { 'en-US': 'Anything' },
      active: true,
      isPublic: true,
      systemDefault: true,
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      themeCode: null,
      logoAssetId: null,
    };

    // The channel's *code* carries no identity — only the flag does.
    const channel = await resolverOver(row).getSystemDefault();
    expect(channel.id).toBe(row.id);
    expect(channel.systemDefault).toBe(true);
  });
});
