import type { AssetReadPort, CmsAssetEmbedResolution } from '@endora-commerce/contracts';
import type { CmsAssetResolver } from './storefront-resolver.js';

/**
 * How the asset ids a page, block or template embeds become the details the
 * storefront response carries (`specs/110-instance-repository/` T118c).
 *
 * A function of the port rather than of a `ModuleContext`, so the mapping is
 * testable over a stubbed `AssetReadPort` with no container composed.
 * `backend/index.ts` supplies the real one as
 * `lazyPort<AssetReadPort>(ctx, 'assetReadPort')`, whose proxy resolves per call,
 * so nothing here captures a registration.
 *
 * **A batch, and the read port, not `AssetsLibraryPort.getAsset` per embed**
 * (issue #685). `getAsset` builds the admin detail, whose "used by" list walks
 * every page, block, template, post, product and menu; a home page with ~150
 * images ran that walk ~150 times per cache miss and kept Postgres saturated for
 * every other request. Here it is two keyed reads for the whole tree: the URLs
 * the detail would carry (signed for a private asset, as before), then the four
 * fields an embed renders for the ids that have one — so a stray string under an
 * `assetId` key never reaches the row read. An asset that is gone is absent from
 * the map and the page renders without it; there is no `catch`, so the owner
 * being off still answers as itself.
 */
export function createAssetEmbedResolver(
  assets: Pick<AssetReadPort, 'resolveUrls' | 'findByIds'>,
): CmsAssetResolver {
  return async (assetIds) => {
    const out = new Map<string, CmsAssetEmbedResolution>();
    if (assetIds.length === 0) return out;
    const urls = await assets.resolveUrls(assetIds);
    if (urls.size === 0) return out;
    for (const record of await assets.findByIds([...urls.keys()], { liveOnly: true })) {
      const url = urls.get(record.id);
      if (!url) continue;
      out.set(record.id, {
        url,
        mimeType: record.mimeType,
        filename: record.filename,
        label: record.label,
        visibility: record.visibility,
      });
    }
    return out;
  };
}
