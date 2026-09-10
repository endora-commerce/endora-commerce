import { describe, expect, it } from 'vitest';
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';

import { AssetReadService } from './asset-read-port.js';
import { AdapterRegistry } from './storage/adapter-registry.js';
import { HmacSigner } from './hmac.js';
import type { Asset } from '../entities/asset.entity.js';

/**
 * `assetReadPort.resolvePublicUrls` — FR-043's rule, answered where the
 * information is (`specs/110-instance-repository/` T118c).
 *
 * A consumer holding an asset id cannot tell a stable URL from a signed one, so
 * the filter cannot live at a caller and the absence cannot be a `catch`. The
 * chain here is the one production runs — read model → registry → adapter → URL
 * — over a stubbed `EntityManager`, so what is under test is the rule and not
 * the database.
 */

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const API_ORIGIN = 'https://api.example.test';

function seededAsset(id: string, overrides: Partial<Asset> = {}): Asset {
  const now = new Date('2026-09-10T09:00:00.000Z');
  return {
    id,
    kind: 'image',
    folderId: null,
    filename: 'hero.jpg',
    label: 'Hero',
    altText: null,
    mimeType: 'image/jpeg',
    sizeBytes: '2048',
    visibility: 'public',
    storageBackend: 'local',
    storageLocator: `aa/bb/${id}.jpg`,
    storageUrl: `/assets/file/${id}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAfterAt: null,
    pendingCleanup: false,
    mimeTypeOverridden: false,
    ...overrides,
  } as unknown as Asset;
}

function makeService(rows: Asset[]): {
  service: AssetReadService;
  filters: Array<FilterQuery<Asset>>;
} {
  const filters: Array<FilterQuery<Asset>> = [];
  const em = {
    // Deliberately does **not** apply the filter: the rows a case hands in are
    // what the read sees, so a case can drive the resolver with an asset the
    // real query would have excluded. The narrowing itself is asserted on
    // `filters`, which is the query the database would run.
    find: async (_entity: unknown, where: FilterQuery<Asset>) => {
      filters.push(where);
      return rows;
    },
  } as unknown as EntityManager;

  const adapters = new AdapterRegistry({
    settings: {
      activeAdapter: async () => 'local',
      localBaseDir: async () => '/tmp/assets',
      localPublicUrlBase: async () => '',
      privateUrlTtlSec: async () => 300,
      s3Config: async () => ({ bucket: '', region: '', accessKeyId: '', secretAccessKey: '' }),
      gcsConfig: async () => ({ bucket: '' }),
    },
    signer: () => HmacSigner.fromEnv(KEY_HEX),
    publicApiBaseUrl: API_ORIGIN,
  });

  return { service: new AssetReadService(() => em, () => adapters), filters };
}

const PUBLIC_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const PRIVATE_ID = 'bbbbbbbb-1111-2222-3333-444444444444';

describe('AssetReadService.resolvePublicUrls', () => {
  it('answers an absolute URL for a live public asset', async () => {
    const { service } = makeService([seededAsset(PUBLIC_ID)]);

    const urls = await service.resolvePublicUrls([PUBLIC_ID]);

    expect(urls.get(PUBLIC_ID)).toBe(`${API_ORIGIN}/assets/file/${PUBLIC_ID}`);
  });

  it('narrows the read itself to live and public rows', async () => {
    const { service, filters } = makeService([]);

    await service.resolvePublicUrls([PUBLIC_ID]);

    // The two filters the composition root's closure used to carry as
    // `findByIds(ids, { liveOnly: true })` and a `visibility === 'public'`
    // predicate. They are one query now, and they are the owner's.
    expect(filters[0]).toMatchObject({ deletedAt: null, visibility: 'public' });
  });

  it('omits an asset whose URL could only be produced as a signed link', async () => {
    // Driven with a `private` row the real query would not have returned, which
    // is the point: this is the second of the two spellings of one rule, and it
    // is what still refuses an expiring link if a future backend answers a
    // `public` visibility with an expiry.
    const { service } = makeService([seededAsset(PRIVATE_ID, { visibility: 'private' })]);

    const urls = await service.resolvePublicUrls([PRIVATE_ID]);

    // Absent, not present-and-signed. A feed reader fetches days later, so an
    // expiring URL is not a worse link — it is a broken one, in a document
    // nobody is watching.
    expect(urls.has(PRIVATE_ID)).toBe(false);
  });

  it('reads nothing at all for an empty batch', async () => {
    const { service, filters } = makeService([seededAsset(PUBLIC_ID)]);

    expect((await service.resolvePublicUrls([])).size).toBe(0);
    expect(filters).toEqual([]);
  });
});
