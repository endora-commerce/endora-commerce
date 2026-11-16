import { ERROR_CODES, unlinkableAssetIds, type AssetReadPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The one question this module asks `assets_library` before it stores an asset id. */
export type CmsAssetVisibility = Pick<AssetReadPort, 'visibleToCaller'>;

const NOTHING_VISIBLE: CmsAssetVisibility = { visibleToCaller: async () => new Set() };

/**
 * Issue #544 (owner ruling 2026-10-30, option a) — refuse a save that newly
 * adds an asset id the caller may not see in the asset library, a missing id
 * included, with the answer `assets_library` gives for a hidden file.
 *
 * A page, block or template body and a page's sharing image are unrestricted
 * references (`specs/166-asset-reference-visibility/` FR-001 b): storing a
 * hidden file's id would list it for every library reader. An id in `current`
 * — what the record already stores — is its own reference and is accepted, so
 * a body still embedding a purged file saves as before.
 *
 * `assets` is optional only so fixtures without the library keep constructing
 * the services; a save that adds an id without it fails closed.
 */
export async function assertAssetsLinkable(
  assets: CmsAssetVisibility | undefined,
  proposed: Iterable<string>,
  current: Iterable<string>,
): Promise<void> {
  const [refused] = await unlinkableAssetIds(assets ?? NOTHING_VISIBLE, proposed, current);
  if (refused === undefined) return;
  if (!assets) throw new Error('cms: the asset read port is not wired — an asset id cannot be stored.');
  throw assetNotLinkable(refused);
}

/** The answer for an asset id that cannot be stored — `assets_library`'s own for a hidden file. */
export function assetNotLinkable(assetId: string): HttpError {
  return new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`, { assetId });
}
