// Per-kind target validation for Megamenu items — feature 015 / T012.
//
// The Zod boundary in `packages/contracts/src/megamenu.ts` enforces the
// shape rules (URL schemes, button variants, asset kinds). Cross-module
// existence + scope checks (Category exists, CMS Page / Block exists in
// scope, Asset matches an expected kind) live here so the unit test can
// stub them without booting a server.

import { ERROR_CODES, type MegamenuItem } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';

const externalUrlRe = /^(?:https?:\/\/|tel:|mailto:)/i;

export interface TargetValidatorDeps {
  categoryExists: (categoryId: string, channelIds: string[]) => Promise<boolean>;
  cmsPageExists: (pageId: string, channelIds: string[]) => Promise<boolean>;
  cmsBlockExists: (blockId: string, channelIds: string[]) => Promise<boolean>;
  assetIs: (assetId: string, expected: 'image' | 'video') => Promise<boolean>;
}

/**
 * Validates a single MegamenuItem against the cross-module ports. Throws
 * `HttpError` on the first failure so callers (`MegamenuItemService.setTree`)
 * can re-raise unchanged.
 */
export async function validateTarget(
  item: MegamenuItem,
  channelIds: string[],
  deps: TargetValidatorDeps,
): Promise<void> {
  // Defence in depth — Zod has already filtered URL schemes at the
  // boundary, but the validator double-checks any free URL on a kind
  // where we expect one.
  if (item.kind === 'external-link') {
    if (!externalUrlRe.test(item.target.url)) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `External link URL "${item.target.url}" must use http://, https://, tel:, or mailto:.`,
      );
    }
  }

  // Optional icon on link kinds: must reference an image asset.
  if (
    item.kind === 'category-link' ||
    item.kind === 'cms-page-link' ||
    item.kind === 'external-link'
  ) {
    const iconAssetId = item.target.iconAssetId;
    if (iconAssetId) {
      const isImage = await deps.assetIs(iconAssetId, 'image');
      if (!isImage) {
        throw new HttpError(
          400,
          ERROR_CODES.MEGAMENU_ASSET_KIND_MISMATCH,
          `Icon asset ${iconAssetId} is not an image.`,
        );
      }
    }
  }

  switch (item.kind) {
    case 'category-link': {
      const ok = await deps.categoryExists(item.target.categoryId, channelIds);
      if (!ok) {
        throw new HttpError(
          400,
          ERROR_CODES.MEGAMENU_TARGET_OUT_OF_SCOPE,
          `Category ${item.target.categoryId} is not in scope of the megamenu's bindings.`,
        );
      }
      return;
    }
    case 'cms-page-link': {
      const ok = await deps.cmsPageExists(item.target.pageId, channelIds);
      if (!ok) {
        throw new HttpError(
          400,
          ERROR_CODES.MEGAMENU_TARGET_OUT_OF_SCOPE,
          `CMS Page ${item.target.pageId} is not in scope of the megamenu's bindings.`,
        );
      }
      return;
    }
    case 'cms-block-embed': {
      const ok = await deps.cmsBlockExists(item.target.blockId, channelIds);
      if (!ok) {
        throw new HttpError(
          400,
          ERROR_CODES.MEGAMENU_TARGET_OUT_OF_SCOPE,
          `CMS Block ${item.target.blockId} is not in scope of the megamenu's bindings.`,
        );
      }
      return;
    }
    case 'asset': {
      if ('assetId' in item.target) {
        const ok = await deps.assetIs(item.target.assetId, item.target.kind);
        if (!ok) {
          throw new HttpError(
            400,
            ERROR_CODES.MEGAMENU_ASSET_KIND_MISMATCH,
            `Asset ${item.target.assetId} is not a ${item.target.kind}.`,
          );
        }
      } else {
        // Free-URL asset items require a server-side import into the
        // Assets Library (T068). The Library does not yet expose
        // `importFromUrl`; until it does, refuse free URLs at the
        // validator with a clear error so admins know to upload first.
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Free-URL asset items are not yet supported. Upload the asset to the Assets Library first and reference it by id.',
        );
      }
      return;
    }
    case 'external-link':
    case 'button':
      // No cross-module check beyond the icon already covered above.
      return;
  }
}
