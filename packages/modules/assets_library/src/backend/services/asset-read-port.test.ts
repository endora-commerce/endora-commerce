import { describe, expect, it } from 'vitest';
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';

import {
  AssetReadService,
  toAssetRecord,
  type AssetStorageRegistry,
  type AssetVisibilityReader,
} from './asset-read-port.js';
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

/** The evaluator the cases that are not about visibility hand in: it must not be asked. */
const NO_VISIBILITY: AssetVisibilityReader = {
  async hiddenAmong() {
    throw new Error('visibility is not under test here');
  },
};

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
    contentVersion: 'a1b2c3d4e5f6',
    permalink: null,
    ...overrides,
  } as unknown as Asset;
}

function makeService(rows: Asset[], loadRetentionDays?: () => Promise<number>): {
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

  return {
    service: new AssetReadService(
      () => em,
      () => adapters,
      () => NO_VISIBILITY,
      ...(loadRetentionDays ? [loadRetentionDays] : []),
    ),
    filters,
  };
}

const PUBLIC_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const PRIVATE_ID = 'bbbbbbbb-1111-2222-3333-444444444444';

describe('AssetReadService.resolvePublicUrls', () => {
  it('answers an absolute URL for a live public asset', async () => {
    const { service } = makeService([seededAsset(PUBLIC_ID)]);

    const urls = await service.resolvePublicUrls([PUBLIC_ID]);

    // specs/156-asset-stable-url/ T061 (deliberate, R-20): versioned.
    expect(urls.get(PUBLIC_ID)).toBe(`${API_ORIGIN}/assets/file/${PUBLIC_ID}?v=a1b2c3d4e5f6`);
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
 * `assetReadPort.resolveUrls` — the URL `AssetsLibraryPort.getAsset` carries,
 * for a batch, without the detail's "used by" list (issue #685). A storefront
 * page resolving its embeds through `getAsset` ran that list — a walk of every
 * page, block, template, post, product and menu — once per image.
 */
describe('AssetReadService.resolveUrls', () => {
  it('answers a public asset with the versioned URL the detail carries', async () => {
    const { service } = makeService([seededAsset(PUBLIC_ID)]);

    const urls = await service.resolveUrls([PUBLIC_ID]);

    expect(urls.get(PUBLIC_ID)).toBe(`${API_ORIGIN}/assets/file/${PUBLIC_ID}?v=a1b2c3d4e5f6`);
  });

  it('answers a private asset with a signed link, as the detail does', async () => {
    const { service } = makeService([seededAsset(PRIVATE_ID, { visibility: 'private' })]);

    const url = (await service.resolveUrls([PRIVATE_ID])).get(PRIVATE_ID);

    expect(url).toMatch(new RegExp(`^${API_ORIGIN}/assets/file/${PRIVATE_ID}\\?`));
    expect(url).toMatch(/[?&]token=[0-9a-f]{64}/);
  });

  it('reads the whole batch in one query, narrowed to live rows', async () => {
    const { service, filters } = makeService([seededAsset(PUBLIC_ID), seededAsset(PRIVATE_ID, { visibility: 'private' })]);

    const urls = await service.resolveUrls([PUBLIC_ID, PRIVATE_ID]);

    expect(urls.size).toBe(2);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({ id: { $in: [PUBLIC_ID, PRIVATE_ID] }, deletedAt: null });
  });

  // Issue #815: the signed link pins the bucket's type and disposition, as the
  // detail's does.
  it('asks the adapter for the stored type and the policy disposition on a private asset', async () => {
    const asked: Array<Record<string, unknown>> = [];
    const em = { find: async () => [seededAsset(PRIVATE_ID, { visibility: 'private', storageBackend: 's3', filename: 'logo.svg', mimeType: 'image/svg+xml' } as Partial<Asset>)] } as unknown as EntityManager;
    const adapters = {
      getForBackend: async () => ({
        resolveUrl: (input: Record<string, unknown>) => {
          asked.push(input);
          return { url: 'https://bucket.example.test/signed', expiresAt: new Date() };
        },
      }),
    } as unknown as AssetStorageRegistry;
    const service = new AssetReadService(() => em, () => adapters, () => NO_VISIBILITY);

    await service.resolveUrls([PRIVATE_ID]);

    expect(asked[0]).toMatchObject({
      responseHeaders: {
        contentType: 'image/svg+xml',
        contentDisposition: `attachment; filename="logo.svg"; filename*=UTF-8''logo.svg`,
      },
    });
  });

  it('reads nothing at all for an empty batch, or one with no uuid in it', async () => {
    const { service, filters } = makeService([seededAsset(PUBLIC_ID)]);

    expect((await service.resolveUrls([])).size).toBe(0);
    // An editor's tree can hold any string under an `assetId` key; one of them
    // must not turn the batch into a database error for every other embed.
    expect((await service.resolveUrls(['hero.png', ''])).size).toBe(0);
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

  return { service: new AssetReadService(() => em, () => adapters, () => NO_VISIBILITY), filters, opened };
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

/** specs/156-asset-stable-url/ T010 — `storageUrl` stays unchanged until Phase 9. */
describe('toAssetRecord — stable URL members (feature 156)', () => {
  it('carries contentVersion and permalink', () => {
    const record = toAssetRecord(
      seededAsset(PUBLIC_ID, { permalink: 'docs/a.pdf' } as Partial<Asset>),
    );
    expect(record.contentVersion).toBe('a1b2c3d4e5f6');
    expect(record.permalink).toBe('docs/a.pdf');
    expect(record.storageUrl).toBe(`/assets/file/${PUBLIC_ID}?v=a1b2c3d4e5f6`);
  });

  it('answers a null permalink when none is set', () => {
    expect(toAssetRecord(seededAsset(PUBLIC_ID)).permalink).toBeNull();
  });
});

/** specs/156-asset-stable-url/ T042a — the reported purge date follows the setting read now (P1). */
describe('AssetRecord.purgeAfterAt (feature 156)', () => {
  it('is deletedAt + the retention read at call time, once per batch, and null for a live asset', async () => {
    const deletedAt = new Date('2026-10-01T12:00:00.000Z');
    const deleted = seededAsset(PUBLIC_ID, {
      deletedAt,
      purgeAfterAt: new Date('2027-01-01T00:00:00.000Z'),
    } as Partial<Asset>);
    const live = seededAsset(PRIVATE_ID);
    let reads = 0;
    const { service } = makeService([deleted, live], async () => {
      reads += 1;
      return 7;
    });
    const records = await service.findByIds([PUBLIC_ID, PRIVATE_ID]);
    const byId = Object.fromEntries(records.map((r) => [r.id, r]));
    expect(byId[PUBLIC_ID]!.purgeAfterAt).toEqual(new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000));
    expect(byId[PRIVATE_ID]!.purgeAfterAt).toBeNull();
    expect(reads).toBe(1);
  });
});

/** specs/156-asset-stable-url/ T061 — `AssetRecord.storageUrl` serves the current version. */
describe('AssetRecord.storageUrl (feature 156)', () => {
  it.each(['local', 's3', 'gcs'] as const)('is versioned for a %s row', (backend) => {
    const record = toAssetRecord(
      seededAsset(PUBLIC_ID, { storageBackend: backend, storageUrl: `https://cdn.example.test/${PUBLIC_ID}.jpg` } as Partial<Asset>),
    );
    expect(record.storageUrl).toBe(`https://cdn.example.test/${PUBLIC_ID}.jpg?v=a1b2c3d4e5f6`);
  });

  it.each([
    ['a legacy row', { storageBackend: 'legacy', storageUrl: 'https://old.example.test/a.jpg' }],
    ['a data: URL', { storageUrl: 'data:application/pdf;base64,JVBERi0=' }],
  ])('is unchanged for %s', (_label, over) => {
    const record = toAssetRecord(seededAsset(PUBLIC_ID, over as Partial<Asset>));
    expect(record.storageUrl).toBe(over.storageUrl);
  });
});

describe('AssetRecord.storageUrl without a storage key (feature 156)', () => {
  it('is the stored URL unchanged — no adapter of this platform wrote it', () => {
    const record = toAssetRecord(
      seededAsset(PUBLIC_ID, { storageLocator: '', storageUrl: 'https://cdn.example.test/a.jpg' } as Partial<Asset>),
    );
    expect(record.storageUrl).toBe('https://cdn.example.test/a.jpg');
  });
});

// `specs/166-asset-reference-visibility/` contracts/ports.md §3, research R-13
// — which of these assets the ambient caller may see. The evaluation is
// `AssetVisibility`'s; this is the existence half and the one call per batch.
describe('AssetReadService.visibleToCaller (feature 166)', () => {
  const VISIBLE = '11111111-1111-4111-8111-111111111111';
  const HIDDEN = '22222222-2222-4222-8222-222222222222';
  const MISSING = '33333333-3333-4333-8333-333333333333';

  function makeVisibilityService(options: { hidden?: readonly string[] } = {}) {
    const existing = new Set([VISIBLE, HIDDEN]);
    const asked: string[][] = [];
    const reads: unknown[] = [];
    const em = {
      find: async (_entity: unknown, where: { id: { $in: string[] } }) => {
        reads.push(where);
        return where.id.$in.filter((id) => existing.has(id)).map((id) => ({ id }));
      },
    } as unknown as EntityManager;
    const hidden = new Set(options.hidden ?? [HIDDEN]);
    const visibility: AssetVisibilityReader = {
      async hiddenAmong(ids) {
        asked.push([...ids]);
        return new Set(ids.filter((id) => hidden.has(id)));
      },
    };
    const service = new AssetReadService(
      () => em,
      () => ({}) as unknown as AssetStorageRegistry,
      () => visibility,
    );
    return { service, asked, reads };
  }

  it('answers hidden and missing ids alike: absent', async () => {
    const { service } = makeVisibilityService();
    expect([...(await service.visibleToCaller([VISIBLE, HIDDEN, MISSING]))]).toEqual([VISIBLE]);
  });

  it('answers an id that is not a uuid as absent, without reading it', async () => {
    const { service, reads, asked } = makeVisibilityService();
    expect([...(await service.visibleToCaller(['not-a-uuid']))]).toEqual([]);
    expect(reads).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('gives an unrestricted caller every existing id (the evaluator hides nothing for them)', async () => {
    const { service } = makeVisibilityService({ hidden: [] });
    expect([...(await service.visibleToCaller([VISIBLE, HIDDEN, MISSING]))].sort()).toEqual([VISIBLE, HIDDEN].sort());
  });

  it('evaluates once per call, whatever the batch size, and only the ids that exist', async () => {
    const { service, asked, reads } = makeVisibilityService();
    await service.visibleToCaller([VISIBLE, HIDDEN, MISSING, VISIBLE]);
    expect(reads).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect([...asked[0]!].sort()).toEqual([VISIBLE, HIDDEN].sort());
  });

  it('asks nothing when no id exists', async () => {
    const { service, asked } = makeVisibilityService();
    expect([...(await service.visibleToCaller([MISSING]))]).toEqual([]);
    expect(asked).toEqual([]);
  });
});
