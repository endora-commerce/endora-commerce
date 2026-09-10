import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';

import { AssetsLibraryService } from './assets-library.service.js';
import { AssetReferenceRegistry } from './reference-registry.js';
import { AdapterRegistry } from './storage/adapter-registry.js';
import { HmacSigner } from './hmac.js';
import type { Asset } from '../entities/asset.entity.js';

/**
 * Every URL this module hands out is absolute — D-223, at the seam that decides
 * what `AssetDetail.url` and `AssetSummary.url` carry.
 *
 * The service is exercised over a real {@link AdapterRegistry} and a stubbed
 * `EntityManager`, so the chain under test is the one production runs:
 * service → registry → adapter → URL. The settings view answers a **blank**
 * `assets.local.public_url_base`, which is what every deployment that never set
 * it has, and is exactly the configuration that used to produce
 * `/assets/file/<id>` — a URL that only works in a browser on the API host, and
 * the reason four composition-root sites and two frontend helpers existed.
 */

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const API_ORIGIN = 'https://api.example.test';
const ASSET_ID = 'aabbccdd-1111-2222-3333-444455556666';

function seededAsset(overrides: Partial<Asset> = {}): Asset {
  const now = new Date('2026-09-10T09:00:00.000Z');
  return {
    id: ASSET_ID,
    kind: 'image',
    folderId: null,
    filename: 'hero.jpg',
    label: 'Hero',
    altText: null,
    mimeType: 'image/jpeg',
    sizeBytes: '2048',
    visibility: 'public',
    storageBackend: 'local',
    storageLocator: `aa/bb/${ASSET_ID}.jpg`,
    storageUrl: `/assets/file/${ASSET_ID}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAfterAt: null,
    pendingCleanup: false,
    ...overrides,
  } as unknown as Asset;
}

function makeService(
  asset: Asset,
  localPublicUrlBase = '',
): AssetsLibraryService {
  const em = {
    findOne: async () => asset,
    find: async () => [asset],
  } as unknown as EntityManager;
  const adapters = new AdapterRegistry({
    settings: {
      activeAdapter: async () => 'local',
      localBaseDir: async () => '/tmp/assets',
      localPublicUrlBase: async () => localPublicUrlBase,
      privateUrlTtlSec: async () => 300,
      s3Config: async () => ({ bucket: '', region: '', accessKeyId: '', secretAccessKey: '' }),
      gcsConfig: async () => ({ bucket: '' }),
    },
    signer: () => HmacSigner.fromEnv(KEY_HEX),
    publicApiBaseUrl: API_ORIGIN,
  });
  return new AssetsLibraryService({
    emFactory: () => em,
    adapters,
    referenceRegistry: new AssetReferenceRegistry(),
    loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
  });
}

describe('AssetsLibraryService — every URL it produces is absolute (D-223)', () => {
  it('AssetDetail.url is absolute when no public URL base is configured', async () => {
    const detail = await makeService(seededAsset()).getAsset(ASSET_ID);
    expect(detail.url).toBe(`${API_ORIGIN}/assets/file/${ASSET_ID}`);
  });

  it('AssetSummary.url is absolute — the list surface takes the same path', async () => {
    const page = await makeService(seededAsset()).listAssets({});
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.url).toBe(`${API_ORIGIN}/assets/file/${ASSET_ID}`);
  });

  it('resolveUrl signs a private asset on the same absolute origin', async () => {
    const service = makeService(seededAsset({ visibility: 'private' } as Partial<Asset>));
    const resolved = await service.resolveUrl(ASSET_ID);
    expect(resolved.url.startsWith(`${API_ORIGIN}/assets/file/${ASSET_ID}?`)).toBe(true);
    expect(resolved.expiresAt).toBeInstanceOf(Date);
  });

  /**
   * A `storage_backend='legacy'` row: its `storage_url` is a pre-013 value this
   * platform did not issue. A relative one used to leave the module relative and
   * be rescued — or not — by whichever consumer asked.
   */
  it('rebases a legacy row whose stored URL is host-relative', async () => {
    const service = makeService(
      seededAsset({
        storageBackend: 'legacy',
        storageLocator: '',
        storageUrl: '/uploads/2019/hero.jpg',
      } as Partial<Asset>),
    );
    expect((await service.getAsset(ASSET_ID)).url).toBe(`${API_ORIGIN}/uploads/2019/hero.jpg`);
  });

  /** D-223: an operator who configured a base explicitly keeps winning. */
  it('serves an explicitly configured base rather than the API origin', async () => {
    const service = makeService(seededAsset(), 'https://cdn.example.test');
    expect((await service.getAsset(ASSET_ID)).url).toBe(
      `https://cdn.example.test/assets/file/${ASSET_ID}`,
    );
  });
});
