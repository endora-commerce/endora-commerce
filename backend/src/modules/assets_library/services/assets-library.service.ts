// AssetsLibraryService — public facade for the Library module. Phase 2
// ships the skeleton; US1 fills in upload / list / get / patch, US2 fills
// in soft-delete + folder-aware listing, US3 widens to cloud adapters.
//
// Methods that are not yet implemented throw NotImplementedYet so callers
// surface the gap explicitly (rather than returning misleading defaults).

import type { EntityManager } from '@mikro-orm/postgresql';
import { Asset } from '../entities/asset.entity.js';
import type { AdapterRegistry } from './storage/adapter-registry.js';
import type { AssetReferenceRegistry } from './reference-registry.js';

export class NotImplementedYet extends Error {
  override readonly name = 'NotImplementedYet';
  constructor(method: string) {
    super(
      `AssetsLibraryService.${method} is not implemented in this build (later phase / user story).`,
    );
  }
}

export interface AssetsLibraryServiceDeps {
  emFactory: () => EntityManager;
  adapters: AdapterRegistry;
  referenceRegistry: AssetReferenceRegistry;
}

export class AssetsLibraryService {
  constructor(private readonly deps: AssetsLibraryServiceDeps) {}

  /**
   * Resolve a serving URL for an Asset by id. Used by storefront catalog/CMS
   * code through the Library facade — never read `Asset.storage_url` directly.
   */
  async resolveUrl(
    assetId: string,
    opts: { ttlSec?: number } = {},
  ): Promise<{ url: string; expiresAt: Date | null }> {
    const em = this.deps.emFactory();
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw new Error(`Asset ${assetId} not found`);
    const adapter = await this.deps.adapters.getForBackend(
      a.storageBackend as 'local' | 's3' | 'gcs' | 'legacy',
    );
    const out = await adapter.resolveUrl({
      locator: a.storageLocator || a.storageUrl, // legacy fallback
      visibility: a.visibility,
      ...(opts.ttlSec !== undefined ? { ttlSec: opts.ttlSec } : {}),
    });
    return out;
  }

  // — Stubs filled by US1 / US2 / US3 ----------------------------------------
  async upload(): Promise<never> {
    throw new NotImplementedYet('upload');
  }
  async listAssets(): Promise<never> {
    throw new NotImplementedYet('listAssets');
  }
  async getAsset(): Promise<never> {
    throw new NotImplementedYet('getAsset');
  }
  async patchAsset(): Promise<never> {
    throw new NotImplementedYet('patchAsset');
  }
  async softDelete(): Promise<never> {
    throw new NotImplementedYet('softDelete');
  }
  async restore(): Promise<never> {
    throw new NotImplementedYet('restore');
  }
  async setVisibility(): Promise<never> {
    throw new NotImplementedYet('setVisibility');
  }
  async move(): Promise<never> {
    throw new NotImplementedYet('move');
  }
  async moveMany(): Promise<never> {
    throw new NotImplementedYet('moveMany');
  }
}
