import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';

import { AssetsLibraryService } from './assets-library.service.js';
import { AssetReferenceRegistry } from './reference-registry.js';
import { AdapterRegistry } from './storage/adapter-registry.js';
import { HmacSigner } from './hmac.js';
import type { Asset } from '../entities/asset.entity.js';

/**
 * Issue #363 — a write that changes what an embedded asset renders as is
 * announced once it has committed, so whoever caches an answer embedding the
 * asset (`cms`'s resolved pages, blocks and hooks) can drop it. The library
 * names no consumer: it calls the one callback its composition hands it, which
 * `registerModule` binds to `ASSET_CHANGED_EVENT` on the bus.
 *
 * The service runs over a stubbed `EntityManager`; what is asserted is *which*
 * writes announce, and that a refused write announces nothing.
 */

const ASSET_ID = 'aabbccdd-1111-2222-3333-444455556666';
const UNRESTRICTED = {
  exclusionFor: async () => [],
  hiddenAmong: async () => new Set<string>(),
  visibleReferences: async () => [],
};

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
    contentVersion: 'a1b2c3d4e5f6',
    permalink: null,
    ...overrides,
  } as unknown as Asset;
}

function build(asset: Asset, referenceRegistry = new AssetReferenceRegistry()) {
  const em = {
    // The asset for the asset's own lookups; no permalink was ever released.
    findOne: async (entity: { name?: string }) => (entity.name === 'Asset' ? asset : null),
    find: async () => [asset],
    flush: async () => {},
    upsert: async () => {},
    execute: async () => [],
    transactional: async (fn: (tx: unknown) => Promise<unknown>) => fn(em),
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
    signer: () => HmacSigner.fromEnv('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'),
    publicApiBaseUrl: 'https://api.example.test',
  });
  const announced: string[][] = [];
  const announceAssetsChanged = vi.fn(async (assetIds: readonly string[]) => {
    announced.push([...assetIds]);
  });
  const service = new AssetsLibraryService({
    emFactory: () => em,
    adapters,
    referenceRegistry,
    visibility: UNRESTRICTED,
    loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
    // The Command Bus runs the command's body over the same stubbed manager.
    commandBus: {
      run: async (command: { run: (ctx: { em: EntityManager }) => Promise<{ result: unknown }> }) =>
        (await command.run({ em })).result,
    } as never,
    announceAssetsChanged,
  });
  return { service, announced };
}

describe('AssetsLibraryService announces an asset write (issue #363)', () => {
  it.each([
    ['the filename', { filename: 'banner.jpg' }],
    ['the label', { label: 'Banner' }],
    ['the alt text', { altText: { 'en-US': 'A banner' } }],
    ['the MIME type', { mimeType: 'image/png' }],
    ['the visibility', { visibility: 'private' as const }],
  ])('announces a change to %s', async (_name, patch) => {
    const { service, announced } = build(seededAsset());
    await service.patchAsset(ASSET_ID, patch);
    expect(announced).toEqual([[ASSET_ID]]);
  });

  it('does not announce a move between folders — nothing an embed renders changed', async () => {
    const { service, announced } = build(seededAsset());
    await service.patchAsset(ASSET_ID, { folderId: null });
    await service.move(ASSET_ID, null);
    expect(announced).toEqual([]);
  });

  it('announces a soft delete and a restore', async () => {
    const asset = seededAsset();
    const { service, announced } = build(asset);
    await service.softDelete(ASSET_ID);
    await service.restore(ASSET_ID);
    expect(announced).toEqual([[ASSET_ID], [ASSET_ID]]);
  });

  it('announces nothing when the soft delete is refused', async () => {
    const registry = new AssetReferenceRegistry();
    registry.register({
      ownerModuleId: 'cms',
      findReferences: async () => [{ kind: 'cms.page', id: 'p-1', label: 'Home', assetId: ASSET_ID }],
    } as never);
    const { service, announced } = build(seededAsset(), registry);
    await expect(service.softDelete(ASSET_ID)).rejects.toThrow();
    expect(announced).toEqual([]);
  });

  it('announces a permalink set and a permalink removed', async () => {
    const asset = seededAsset();
    const { service, announced } = build(asset);
    await service.setPermalink(ASSET_ID, { permalink: 'banner.jpg' });
    await service.removePermalink(ASSET_ID);
    expect(announced).toEqual([[ASSET_ID], [ASSET_ID]]);
  });
});
