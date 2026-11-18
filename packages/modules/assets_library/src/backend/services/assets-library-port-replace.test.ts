import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type AssetReplaceInput, type AssetsLibraryPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

import { AssetsLibraryService } from './assets-library.service.js';
import { AssetReferenceRegistry } from './reference-registry.js';
import { AdapterRegistry } from './storage/adapter-registry.js';
import { HmacSigner } from './hmac.js';
import type { Asset } from '../entities/asset.entity.js';
import { replaceAssetFile } from './asset-replace.js';

/**
 * Issue #694 — `AssetsLibraryPort.replace`, the in-place replace of
 * `specs/156-asset-stable-url/` published to modules.
 *
 * The port is bound to the service itself (`index.ts`), so what this file pins
 * is the seam between the two input shapes: a module hands the contract's
 * `AssetUploadStream`, which is any async iterable of bytes, and the replace
 * sequence underneath reads a Node stream. The sequence is replaced by a spy
 * here — `asset-replace.test.ts` owns it — so the assertions are about what
 * crosses: the stream as a Node `Readable` holding the same bytes, the guard
 * version, no route-only hook, the detail built from the replaced row, and a
 * refusal reaching the module as the same `HttpError` the route answers.
 *
 * The end-to-end case (same id, same URL, new content version, the audit row,
 * a real conflict and the owner-off gate) is the PG test
 * `backend/test/integration/assets_library/port-replace.test.ts`.
 */

vi.mock('./asset-replace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./asset-replace.js')>();
  return { ...actual, replaceAssetFile: vi.fn() };
});

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const API_ORIGIN = 'https://api.example.test';
const ASSET_ID = 'aabbccdd-1111-2222-3333-444455556666';
const OLD_CV = 'a1b2c3d4e5f6';
const NEW_CV = '0f0e0d0c0b0a';

function seededAsset(overrides: Partial<Asset> = {}): Asset {
  const now = new Date('2026-11-03T09:00:00.000Z');
  return {
    id: ASSET_ID,
    kind: 'pdf',
    folderId: null,
    filename: 'datasheet.pdf',
    label: null,
    altText: null,
    mimeType: 'application/pdf',
    sizeBytes: '2048',
    visibility: 'public',
    storageBackend: 'local',
    storageLocator: `aa/bb/${ASSET_ID}.pdf`,
    storageUrl: `/assets/file/${ASSET_ID}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAfterAt: null,
    pendingCleanup: false,
    contentVersion: OLD_CV,
    permalink: null,
    ...overrides,
  } as unknown as Asset;
}

function serviceOver(
  row: Asset,
  announceAssetsChanged?: (assetIds: readonly string[]) => Promise<void>,
): AssetsLibraryService {
  const em = {
    findOne: async () => row,
    find: async () => [row],
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
  return new AssetsLibraryService({
    emFactory: () => em,
    adapters,
    referenceRegistry: new AssetReferenceRegistry(),
    visibility: {
      exclusionFor: async () => [],
      hiddenAmong: async () => new Set<string>(),
      visibleReferences: async () => [],
    },
    loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
    commandBus: { run: async () => { throw new Error('the replace sequence is stubbed'); } },
    ...(announceAssetsChanged ? { announceAssetsChanged } : {}),
  });
}

function portOver(
  row: Asset,
  announceAssetsChanged?: (assetIds: readonly string[]) => Promise<void>,
): AssetsLibraryPort {
  // Typed as the port on purpose: this assignment is the composition's
  // `providePort<AssetsLibraryPort>(…, () => service)` in one line.
  const port: AssetsLibraryPort = serviceOver(row, announceAssetsChanged);
  return port;
}

/** A byte source that is an async iterable and nothing else — what a module may hand. */
async function* plainBytes(...chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield new TextEncoder().encode(chunk);
}

async function drain(stream: NodeJS.ReadableStream): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(parts).toString('utf8');
}

describe('AssetsLibraryPort.replace (issue #694)', () => {
  it('hands the replace sequence a Node stream of the same bytes and answers the replaced detail', async () => {
    const replaced = seededAsset({ contentVersion: NEW_CV, filename: 'datasheet-v2.pdf' });
    const spy = vi.mocked(replaceAssetFile).mockReset().mockResolvedValue(replaced);

    const detail = await portOver(replaced).replace({
      assetId: ASSET_ID,
      filename: 'datasheet-v2.pdf',
      declaredMime: 'application/pdf',
      stream: plainBytes('%PDF-1.4\n', 'second chunk'),
      declaredSize: 0,
      expectedContentVersion: OLD_CV,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]![1];
    expect(input.stream).toBeInstanceOf(Readable);
    expect(await drain(input.stream)).toBe('%PDF-1.4\nsecond chunk');
    expect(input).toMatchObject({
      assetId: ASSET_ID,
      filename: 'datasheet-v2.pdf',
      declaredMime: 'application/pdf',
      declaredSize: 0,
      expectedContentVersion: OLD_CV,
    });

    expect(detail.id).toBe(ASSET_ID);
    expect(detail.fileUrl).toBe(`${API_ORIGIN}/assets/file/${ASSET_ID}`);
    expect(detail.contentVersion).toBe(NEW_CV);
    expect(detail.url).toBe(`${API_ORIGIN}/assets/file/${ASSET_ID}?v=${NEW_CV}`);
  });

  it('never forwards the route-only afterStaged hook, even when a caller casts one in', async () => {
    // The stubbed sequence runs whatever hook it is handed, as the real one does
    // once the bytes are staged — so a hook that got through would run here.
    const spy = vi
      .mocked(replaceAssetFile)
      .mockReset()
      .mockImplementation(async (_deps, input) => {
        if (input.afterStaged) await input.afterStaged();
        return seededAsset({ contentVersion: NEW_CV });
      });
    const hook = vi.fn(async () => undefined);

    await portOver(seededAsset()).replace({
      assetId: ASSET_ID,
      filename: 'datasheet-v2.pdf',
      declaredMime: 'application/pdf',
      stream: plainBytes('%PDF-1.4\n'),
      declaredSize: 0,
      afterStaged: hook,
      somethingElse: 'not a member of the contract',
    } as unknown as AssetReplaceInput);

    expect(hook).not.toHaveBeenCalled();
    const input = spy.mock.calls[0]![1];
    expect('afterStaged' in input).toBe(false);
    expect(Object.keys(input).sort()).toEqual(
      ['assetId', 'declaredMime', 'declaredSize', 'filename', 'stream'],
    );
  });

  it('keeps the hook on the admin route’s own entry, which is not on the port', async () => {
    const spy = vi.mocked(replaceAssetFile).mockReset().mockResolvedValue(seededAsset());
    const hook = vi.fn(async () => undefined);
    const stream = Readable.from([Buffer.from('%PDF-1.4\n')]);

    await serviceOver(seededAsset()).replaceFromRoute({
      assetId: ASSET_ID,
      filename: 'datasheet.pdf',
      declaredMime: 'application/pdf',
      stream,
      declaredSize: 0,
      afterStaged: hook,
    });

    expect(spy.mock.calls[0]![1].afterStaged).toBe(hook);
    expect(spy.mock.calls[0]![1].stream).toBe(stream);
  });

  it('passes a Node stream through untouched', async () => {
    const spy = vi.mocked(replaceAssetFile).mockReset().mockResolvedValue(seededAsset());
    const stream = Readable.from([Buffer.from('%PDF-1.4\n')]);

    await portOver(seededAsset()).replace({
      assetId: ASSET_ID,
      filename: 'datasheet.pdf',
      declaredMime: 'application/pdf',
      stream,
      declaredSize: 9,
    });

    expect(spy.mock.calls[0]![1].stream).toBe(stream);
    expect('expectedContentVersion' in spy.mock.calls[0]![1]).toBe(false);
  });

  // Issue #363: a replace changes what an embedded asset renders as, so the
  // admin route's replace announces the asset once it has committed and `cms`
  // drops every cached answer embedding it. A module replacing through the
  // port changes the same bytes, so it must announce the same way.
  it('announces the replaced asset, as the admin route’s replace does', async () => {
    vi.mocked(replaceAssetFile).mockReset().mockResolvedValue(seededAsset({ contentVersion: NEW_CV }));
    const announce = vi.fn(async (_ids: readonly string[]) => undefined);

    await portOver(seededAsset(), announce).replace({
      assetId: ASSET_ID,
      filename: 'datasheet-v2.pdf',
      declaredMime: 'application/pdf',
      stream: plainBytes('%PDF-1.4\n'),
      declaredSize: 0,
    });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith([ASSET_ID]);
  });

  it('announces nothing when the replace is refused', async () => {
    vi.mocked(replaceAssetFile)
      .mockReset()
      .mockRejectedValue(new HttpError(409, ERROR_CODES.ASSET_REPLACE_CONFLICT, 'refused'));
    const announce = vi.fn(async (_ids: readonly string[]) => undefined);

    await expect(
      portOver(seededAsset(), announce).replace({
        assetId: ASSET_ID,
        filename: 'datasheet-v2.pdf',
        declaredMime: 'application/pdf',
        stream: plainBytes('%PDF-1.4\n'),
        declaredSize: 0,
        expectedContentVersion: 'stale0000000',
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(announce).not.toHaveBeenCalled();
  });

  it.each([
    [409, ERROR_CODES.ASSET_REPLACE_CONFLICT],
    [415, ERROR_CODES.ASSET_REPLACE_KIND_MISMATCH],
    [409, ERROR_CODES.ASSET_LEGACY_CANNOT_REPLACE],
    [404, ERROR_CODES.ASSET_NOT_FOUND],
    [410, ERROR_CODES.ASSET_GONE],
  ] as const)('reaches the module as the route’s refusal: %i %s', async (status, code) => {
    const refusal = new HttpError(status, code, 'refused');
    vi.mocked(replaceAssetFile).mockReset().mockRejectedValue(refusal);

    await expect(
      portOver(seededAsset()).replace({
        assetId: ASSET_ID,
        filename: 'datasheet-v2.pdf',
        declaredMime: 'application/pdf',
        stream: plainBytes('%PDF-1.4\n'),
        declaredSize: 0,
        expectedContentVersion: 'stale0000000',
      }),
    ).rejects.toBe(refusal);
  });
});
