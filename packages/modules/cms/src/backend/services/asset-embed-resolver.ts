import type { AssetsLibraryPort } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { CmsAssetResolver } from './storefront-resolver.js';

/**
 * How an asset id a page, block or template embeds becomes the detail the
 * storefront response carries (`specs/110-instance-repository/` T118c).
 *
 * A function of the port rather than of a `ModuleContext`, so the mapping and its
 * one tolerance are testable over a stubbed `AssetsLibraryPort` with no container
 * composed. `backend/index.ts` supplies the real one as
 * `lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort')`, whose proxy resolves
 * per call, so nothing here captures a registration.
 *
 * `getAsset` is the whole demand: the four fields a storefront embed renders plus
 * the visibility a consumer branches on.
 */
export function createAssetEmbedResolver(
  assets: Pick<AssetsLibraryPort, 'getAsset'>,
): CmsAssetResolver {
  return async (assetId) => {
    try {
      const detail = await assets.getAsset(assetId);
      return {
        url: detail.url,
        mimeType: detail.mimeType,
        filename: detail.filename,
        label: detail.label,
        visibility: detail.visibility,
      };
    } catch (err) {
      // The narrow tolerance the composition root's closure already carried, kept
      // deliberately: `getAsset` throws 404 for a row that is gone, and a page
      // embedding a deleted asset renders without it rather than failing the whole
      // response. `rethrowIfModuleDisabled` is what stops that tolerance from also
      // absorbing an owner's refusal (composition checklist item 7) — unreachable
      // while `assets_library` declares `nonDeactivatable`, and the line that keeps
      // this fail-closed on the day that changes.
      rethrowIfModuleDisabled(err);
      return null;
    }
  };
}
