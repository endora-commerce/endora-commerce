// Per-kind target validation for Megamenu items — feature 015 / T012.
//
// The Zod boundary in `packages/contracts/src/megamenu.ts` enforces the
// shape rules (URL schemes, button variants, asset kinds). Cross-module
// existence + scope checks (Category exists, CMS Page / Block exists in
// scope, Asset matches an expected kind) live here so the unit test can
// stub them without booting a server.

import { ERROR_CODES, type MegamenuItem } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { MegamenuCrossModulePorts } from './cross-module-ports.js';

const externalUrlRe = /^(?:https?:\/\/|tel:|mailto:)/i;

/**
 * Validates a single MegamenuItem against the cross-module ports. Throws
 * `HttpError` on the first failure so callers (`MegamenuItemService.setTree`)
 * can re-raise unchanged.
 *
 * The four checks used to arrive as `TargetValidatorDeps`, an interface this
 * module exported for a composition root to build closures against
 * (`specs/110-instance-repository/` T118c). They are their owners' published read
 * ports now, resolved by `backend/index.ts` and declared in this module's
 * manifest.
 *
 * **`_channelIds` is threaded and read by nothing, which is what the roots' SQL
 * did.** `setTree` computes the union of the menu's bound channels and passes it
 * here; neither root's closure ever looked at it, so `MEGAMENU_TARGET_OUT_OF_SCOPE`
 * has only ever meant *the target does not exist*. That is a documented v1
 * narrowing — `megamenu-item-service.ts` says so at the call site, and the scope
 * refusal is US3's — and the parameter is kept so US3 lands inside this function
 * rather than re-plumbing its caller. Naming it `_` is the only change: the
 * ignoring used to happen two files away in a root nobody reads.
 */
export async function validateTarget(
  item: MegamenuItem,
  _channelIds: string[],
  ports: MegamenuCrossModulePorts,
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
      const icon = await ports.assets.findById(iconAssetId);
      if (icon?.kind !== 'image') {
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
      // No `liveOnly` and no `isActive` test: the roots' `select 1 from
      // categories where id = ?` accepted a deactivated or soft-deleted
      // category, and an admin pointing a menu item at one is not making an
      // error the storefront cannot answer — `resolveCategoryUrl` drops the
      // item at render time.
      const ok = (await ports.categories.findById(item.target.categoryId)) !== null;
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
      const ok = (await ports.pages.findById(item.target.pageId)) !== null;
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
      // `findById` and not `findLocalizedById`: existence, `active` included,
      // is the question — an operator may be pointing a menu item at a block
      // they have deactivated while they edit it, and the roots' SQL accepted
      // one. The storefront refuses it later, where a shopper is the one asking.
      const ok = (await ports.blocks.findById(item.target.blockId)) !== null;
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
        const asset = await ports.assets.findById(item.target.assetId);
        if (asset?.kind !== item.target.kind) {
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
