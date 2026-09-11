import { describe, expect, it } from 'vitest';
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';

import { AssetReadService, type AssetStorageRegistry } from './asset-read-port.js';
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

/**
 * `assetReadPort.openAssetBytes` — the same shape of rule, one question over
 * (`specs/110-instance-repository/` T118c).
 *
 * It came here from a closure each composition root wrote for `invoices`, and
 * the three storage facts that closure knew came with it: that a `legacy` row
 * has no object to open, that the locator falls back to `storageUrl` for a row
 * written before that column existed, and that an adapter answers a stream the
 * caller wanted whole. Each has a case below, and the fourth is the degrade — a
 * store that will not stream is `null` and not a throw, because a caller
 * holding an asset id cannot tell that state from an asset that is not there.
 */
function byteService(
  row: Asset | null,
  open: (input: { locator: string }) => Promise<AsyncIterable<string | Uint8Array>>,
): { service: AssetReadService; filters: Array<FilterQuery<Asset>>; opened: string[] } {
  const filters: Array<FilterQuery<Asset>> = [];
  const opened: string[] = [];
  const em = {
    findOne: async (_entity: unknown, where: FilterQuery<Asset>) => {
      filters.push(where);
      return row;
    },
  } as unknown as EntityManager;

  const adapters = {
    getForBackend: async () => ({
      resolveUrl: () => ({ url: '', expiresAt: null }),
      open: async (input: { locator: string }) => {
        opened.push(input.locator);
        return open(input);
      },
    }),
  } as unknown as AssetStorageRegistry;

  return { service: new AssetReadService(() => em, () => adapters), filters, opened };
}

async function* chunks(...parts: Array<string | Uint8Array>): AsyncGenerator<string | Uint8Array> {
  for (const part of parts) yield part;
}

const BYTES_ID = 'cccccccc-1111-2222-3333-444444444444';

describe('AssetReadService.openAssetBytes', () => {
  it('drains the store’s stream into one buffer and carries the stored MIME type', async () => {
    const { service, opened } = byteService(
      seededAsset(BYTES_ID, { mimeType: 'image/png' }),
      async () => chunks(new Uint8Array([1, 2]), new Uint8Array([3])),
    );

    const loaded = await service.openAssetBytes(BYTES_ID);

    expect(loaded).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' });
    // The locator, not the URL — the column the bytes are addressed by.
    expect(opened).toEqual([`aa/bb/${BYTES_ID}.jpg`]);
  });

  it('falls back to the storage URL for a row written before the locator column', async () => {
    const { service, opened } = byteService(seededAsset(BYTES_ID, { storageLocator: '' }), async () =>
      chunks(new Uint8Array([7])),
    );

    await service.openAssetBytes(BYTES_ID);

    expect(opened).toEqual([`/assets/file/${BYTES_ID}`]);
  });

  it('narrows the read to a live row', async () => {
    const { service, filters } = byteService(null, async () => chunks());

    expect(await service.openAssetBytes(BYTES_ID)).toBeNull();
    expect(filters[0]).toMatchObject({ id: BYTES_ID, deletedAt: null });
  });

  it('answers null for a legacy row instead of probing it for an open method', async () => {
    // `legacy` resolves the URL of a pre-013 row this platform did not issue and
    // opens nothing. Before the port, both byte consumers wrote
    // `if (!('open' in adapter) || typeof adapter.open !== 'function')` at the
    // call site to find that out, byte-identically and in two different modules.
    const { service, opened } = byteService(
      seededAsset(BYTES_ID, { storageBackend: 'legacy' }),
      async () => chunks(new Uint8Array([9])),
    );

    expect(await service.openAssetBytes(BYTES_ID)).toBeNull();
    expect(opened, 'a legacy row must not reach a store at all').toEqual([]);
  });

  it('answers null when the configured store will not stream', async () => {
    const { service } = byteService(seededAsset(BYTES_ID), async () => {
      throw new Error('bucket unreachable');
    });

    // The degrade, in the return type. A document renders without its
    // decoration; it does not become an error page.
    expect(await service.openAssetBytes(BYTES_ID)).toBeNull();
  });

  it('encodes a string chunk rather than dropping it', async () => {
    const { service } = byteService(seededAsset(BYTES_ID), async () => chunks('hi'));

    expect(await service.openAssetBytes(BYTES_ID)).toEqual({
      bytes: new Uint8Array([0x68, 0x69]),
      mimeType: 'image/jpeg',
    });
  });
});
