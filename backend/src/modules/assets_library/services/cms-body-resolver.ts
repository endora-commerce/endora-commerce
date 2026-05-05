// CMS body asset-ref resolver — feature 013 / US6 / T095.
//
// Walks any JSON value, finds nodes with the shape
//   { type: 'asset_ref', assetId: <uuid>, rendering?: ... }
// and returns a denormalized map keyed by assetId so the storefront
// CMS-page response can inline ready-to-render URLs alongside the body.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetEmbedResolution } from '@b2b/contracts';
import { Asset } from '../entities/asset.entity.js';
import type { AssetsLibraryService } from './assets-library.service.js';

export function findAssetRefIds(body: unknown, acc: Set<string> = new Set()): Set<string> {
  if (body === null || body === undefined) return acc;
  if (Array.isArray(body)) {
    for (const item of body) findAssetRefIds(item, acc);
    return acc;
  }
  if (typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (obj['type'] === 'asset_ref' && typeof obj['assetId'] === 'string') {
      acc.add(obj['assetId']);
    }
    for (const v of Object.values(obj)) findAssetRefIds(v, acc);
  }
  return acc;
}

export async function resolveAssetRefs(
  body: unknown,
  emFactory: () => EntityManager,
  service: AssetsLibraryService,
): Promise<Record<string, AssetEmbedResolution>> {
  const ids = Array.from(findAssetRefIds(body));
  if (ids.length === 0) return {};
  const em = emFactory();
  const assets = await em.find(Asset, { id: { $in: ids }, deletedAt: null });
  const resolutions = await Promise.all(
    assets.map(async (a) => {
      const url = await service.resolveUrl(a.id);
      return [a.id, {
        url: url.url,
        mimeType: a.mimeType,
        filename: a.filename,
        label: a.label ?? null,
        visibility: a.visibility,
      }] as const;
    }),
  );
  return Object.fromEntries(resolutions);
}
