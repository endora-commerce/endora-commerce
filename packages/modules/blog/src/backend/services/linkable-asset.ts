import { contentAssetIds, ERROR_CODES, unlinkableAssetIds, type AssetReadPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The two questions this module asks `assets_library` before it links a file by id. */
export type LinkableAssetReader = Pick<AssetReadPort, 'findById' | 'visibleToCaller'>;

/**
 * Refuse a main image the caller may not link: a missing file and one the
 * library hides from the caller answer alike, byte for byte
 * (`specs/166-asset-reference-visibility/` FR-006, review T055 F-2).
 *
 * A post's or a category's main image is an unrestricted reference: linking a
 * hidden file would show it to every library reader (FR-001 b), and refusing
 * it any other way than a missing one would say that it exists. Before this,
 * a missing id reached the foreign key and answered 500.
 *
 * `assets` is optional only so fixtures without the library keep constructing
 * the services; an image named without it fails closed.
 */
export async function assertLinkableAsset(assets: LinkableAssetReader | undefined, assetId: string): Promise<void> {
  if (!assets) throw new Error('blog: the asset read port is not wired — a main image cannot be linked.');
  const asset = await assets.findById(assetId);
  if (asset && (await assets.visibleToCaller([asset.id])).has(asset.id)) return;
  throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Asset ${assetId} not found.`);
}

/**
 * Refuse a Page Builder save — a post's content, a category's description —
 * that newly adds an asset id the caller may not see, a missing id included,
 * with the main image's answer (issue #544, owner ruling 2026-10-30, option a).
 * Both are unrestricted references: an id they store is listed in the library
 * for every reader.
 *
 * `current` is what the record already stores: an id in it is its own
 * reference and is not asked about, so content still embedding a purged file
 * saves as before. Without the read port a save that adds an id fails closed.
 */
export async function assertLinkableContentAssets(
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
  if (!assets) throw new Error('blog: the asset read port is not wired — content cannot link an asset.');
  throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Asset ${refused} not found.`);
}

/**
 * How a post's or category's `main_image_asset_id`, and an author's avatar,
 * becomes a storefront URL (feature 163). Only a stable public URL is served —
 * a storefront visitor carries no session — and an asset without one renders
 * the card without an image.
 *
 * **The batched read, not `AssetsLibraryPort.getAsset`.** `getAsset` builds the
 * admin detail, whose "used by" list walks every registered reference
 * descriptor — on a site with real CMS content that is seconds per image, run
 * for every card, every related post and every author on each blog request.
 * `resolvePublicUrls` is one keyed read and says "no URL" by leaving the id out,
 * so there is no `catch` here: the owner being off still answers as itself.
 */
export function publicAssetUrlResolver(
  assets: Pick<AssetReadPort, 'resolvePublicUrls'>,
): (assetId: string) => Promise<string | null> {
  return async (assetId) => (await assets.resolvePublicUrls([assetId])).get(assetId) ?? null;
}
