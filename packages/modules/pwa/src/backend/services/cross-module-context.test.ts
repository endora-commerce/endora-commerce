import { describe, expect, it } from 'vitest';
import type { AssetDetail, OrderRecord } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import type { CachedChannel } from '@endora-commerce/platform/kernel';
import {
  createAssetUrlResolver,
  createChannelCodeResolver,
  createDefaultChannelIdResolver,
  createOrderPushTargetResolver,
} from './cross-module-context.js';

/**
 * The four mappings `PwaBridge` used to carry as closures in both composition
 * roots (`specs/110-instance-repository/` T118c).
 *
 * This half composes nothing: every subject is a function of a published port,
 * so a stub is enough and no container, no Fastify instance and no database is
 * involved. The half that can see the *wiring* is
 * `backend/test/integration/pwa/cross-module-wiring.test.ts`; neither half can
 * do the other's job, which is why there are two.
 *
 * Every case here would have passed against the old root closures too — that is
 * the point. What it fixes in place is the shape, so the next edit to any of the
 * four has something to be wrong against.
 */

function assetDetail(overrides: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: 'asset-1',
    folderId: null,
    filename: 'pwa-icon-512-any.png',
    label: 'PWA icon 512 any',
    mimeType: 'image/png',
    sizeBytes: 1024,
    visibility: 'public',
    storageBackend: 'local',
    url: 'https://shop.example.test/assets/file/asset-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    pendingCleanup: false,
    altText: null,
    references: [],
    ...overrides,
  };
}

function cachedChannel(overrides: Partial<CachedChannel> = {}): CachedChannel {
  return {
    id: 'chan-1',
    code: 'default',
    name: { en: 'Default' },
    active: true,
    isPublic: true,
    systemDefault: true,
    defaultLanguage: 'en',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    languages: ['en'],
    currencies: ['PLN'],
    version: 1,
    ...overrides,
  };
}

function orderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    businessId: 'ORD-2026-0007',
    placedByCustomerAccountId: 'cust-1',
    ...overrides,
  } as OrderRecord;
}

describe('pwa — an asset id becomes a URL over assetsLibraryPort', () => {
  it('answers the detail’s own url, absolute and untouched (D-223)', async () => {
    const asked: string[] = [];
    const resolve = createAssetUrlResolver({
      getAsset: async (assetId) => {
        asked.push(assetId);
        return assetDetail({ url: 'https://cdn.example.test/pwa/512.png' });
      },
    });

    // Not rebased, not prefixed, not joined onto an origin this module reads
    // from the environment: `assets_library` decides the origin and the URL
    // arrives absolute. Both roots used to disagree about that, one of them
    // wrapping this in `absolutizePublicUrl` and the other not.
    expect(await resolve('asset-1')).toBe('https://cdn.example.test/pwa/512.png');
    expect(asked).toEqual(['asset-1']);
  });

  it('answers null for an asset that is gone, so one icon size 404s rather than 500s', async () => {
    const resolve = createAssetUrlResolver({
      getAsset: async () => {
        throw new Error('Asset asset-1 not found.');
      },
    });

    expect(await resolve('asset-1')).toBeNull();
  });

  it('does not absorb the owner’s refusal', async () => {
    // The line that keeps the tolerance above from turning fail-closed into
    // fail-open. Unreachable while `assets_library` is `nonDeactivatable`, and
    // asserted so that it stays true on the day that changes.
    const resolve = createAssetUrlResolver({
      getAsset: async () => {
        throw new ModuleDisabledError('assets_library');
      },
    });

    await expect(resolve('asset-1')).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});

describe('pwa — the channel reads go through the kernel resolver', () => {
  it('resolves the system default channel id', async () => {
    const resolve = createDefaultChannelIdResolver({
      getSystemDefault: async () => cachedChannel({ id: 'chan-default' }),
    });

    expect(await resolve()).toBe('chan-default');
  });

  it('maps a channel id to the code a settings subset write is keyed by', async () => {
    const asked: string[] = [];
    const resolve = createChannelCodeResolver({
      getById: async (id) => {
        asked.push(id);
        return cachedChannel({ id, code: 'wholesale' });
      },
    });

    expect(await resolve('chan-2')).toBe('wholesale');
    expect(asked).toEqual(['chan-2']);
  });

  it('answers null for an unknown channel id, which the reset route turns into 400', async () => {
    const resolve = createChannelCodeResolver({ getById: async () => null });

    expect(await resolve('chan-missing')).toBeNull();
  });

  it('answers an inactive channel’s code, because a settings write is not a resolution', async () => {
    // The narrowing this deliberately does not do. `getById` is the resolver's
    // `em.findOne(SalesChannel, { id })`, which is byte-for-byte the read both
    // composition roots wrote by hand; `resolveActive` is the one that refuses,
    // and swapping to it here would silently stop an operator configuring a
    // channel they had switched off.
    const resolve = createChannelCodeResolver({
      getById: async (id) => cachedChannel({ id, code: 'retired', active: false }),
    });

    expect(await resolve('chan-3')).toBe('retired');
  });
});

describe('pwa — an order-status event becomes a push target over orderReadPort', () => {
  it('names the placing customer, the order and the new status', async () => {
    const asked: string[] = [];
    const resolve = createOrderPushTargetResolver({
      findById: async (id) => {
        asked.push(id);
        return orderRecord();
      },
    });

    expect(
      await resolve({
        orderId: 'order-1',
        salesChannelId: 'chan-1',
        from: 'pending',
        to: 'ready_for_pickup',
      }),
    ).toEqual({
      salesChannelId: 'chan-1',
      customerAccountId: 'cust-1',
      title: 'Order update',
      // The underscores are replaced, which is the whole of the status
      // presentation and the one thing in this sentence that is not a
      // substitution.
      body: 'Order ORD-2026-0007 is now ready for pickup.',
      url: '/account/orders/ORD-2026-0007',
    });
    expect(asked).toEqual(['order-1']);
  });

  it('answers null for an order that is not there', async () => {
    const resolve = createOrderPushTargetResolver({ findById: async () => null });

    expect(
      await resolve({ orderId: 'order-x', salesChannelId: 'chan-1', from: 'a', to: 'b' }),
    ).toBeNull();
  });

  it('answers null for a guest order, which has no account to notify', async () => {
    const resolve = createOrderPushTargetResolver({
      findById: async () => orderRecord({ placedByCustomerAccountId: null }),
    });

    expect(
      await resolve({ orderId: 'order-1', salesChannelId: 'chan-1', from: 'a', to: 'b' }),
    ).toBeNull();
  });

  it('does not absorb the owner’s refusal', async () => {
    // No `catch` at this seam at all, which on an event handler is the
    // assertion rather than the absence: `push-event-subscriber.ts` decides the
    // presence answer by name, one level up, and writes a different sentence
    // for it than for a failure.
    const resolve = createOrderPushTargetResolver({
      findById: async () => {
        throw new ModuleDisabledError('orders');
      },
    });

    await expect(
      resolve({ orderId: 'order-1', salesChannelId: 'chan-1', from: 'a', to: 'b' }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
