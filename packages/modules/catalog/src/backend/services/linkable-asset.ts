import {
  contentAssetIds,
  ERROR_CODES,
  unlinkableAssetIds,
  type AssetReadPort,
  type AssetRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The two questions this module asks `assets_library` before it links a file by id. */
export type LinkableAssetReader = Pick<AssetReadPort, 'findById' | 'visibleToCaller'>;

/**
 * The library file an administrator may link to a catalog record, or `null` —
 * for a missing file and for one the library hides from the caller alike
 * (`specs/166-asset-reference-visibility/` FR-006, review T055 F-2).
 *
 * A product's gallery, attachments and download and a category's image are
 * unrestricted references: linking a hidden file would show it to every
 * library reader (FR-001 b), and refusing it any other way than a missing one
 * would say that it exists. `visibleToCaller` is asked right after the
 * existence read, about the row's own id.
 */
export async function findLinkableAsset(assets: LinkableAssetReader, assetId: string): Promise<AssetRecord | null> {
  const asset = await assets.findById(assetId);
  if (!asset) return null;
  return (await assets.visibleToCaller([asset.id])).has(asset.id) ? asset : null;
}

/** The answer for a file that cannot be linked — missing or hidden, byte for byte. */
export function assetNotFound(assetId: string): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, `Asset ${assetId} not found.`);
}

/** Refuse a file that cannot be linked; answers the file otherwise. */
export async function requireLinkableAsset(assets: LinkableAssetReader, assetId: string): Promise<AssetRecord> {
  const asset = await findLinkableAsset(assets, assetId);
  if (!asset) throw assetNotFound(assetId);
  return asset;
}

/**
 * The answer for an asset id a Page Builder save cannot store — missing or
 * hidden, byte for byte — `assets_library`'s own for a hidden file, as the CMS
 * and the other modules answer it (issue #1359, Q2). The column paths above
 * still answer with {@link assetNotFound}.
 */
export function contentAssetNotLinkable(assetId: string): HttpError {
  return new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`, { assetId });
}

/**
 * Refuse a Page Builder save that newly adds an asset id the caller may not
 * see, a missing id included, with {@link contentAssetNotLinkable} (issue #544,
 * owner ruling 2026-10-30, option a). A category's page content and a product's
 * content attributes are unrestricted references, like the gallery: an id
 * they store is listed in the library for every reader.
 *
 * `current` is what the record already stores: an id in it is its own
 * reference and is not asked about, so content still embedding a purged file
 * saves as before. Without the read port a save that adds an id fails closed.
 */
export async function requireLinkableContentAssets(
  assets: Pick<AssetReadPort, 'visibleToCaller'> | undefined,
  proposed: unknown,
  current: unknown,
): Promise<void> {
  const [refused] = await unlinkableAssetIds(
    assets ?? { visibleToCaller: async () => new Set() },
    contentAssetIds(proposed),
    contentAssetIds(current),
  );
  if (refused === undefined) return;
  if (!assets) throw new Error('catalog: the asset read port is not wired — content cannot link an asset.');
  throw contentAssetNotLinkable(refused);
}
