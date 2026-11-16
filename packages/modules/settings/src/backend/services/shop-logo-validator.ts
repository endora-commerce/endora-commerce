import {
  assetIdSettingValidator,
  ERROR_CODES,
  type AssetReadPort,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SHOP_LOGO_ASSET_ID } from './shop-info-resolver.js';

/**
 * Issue #544 — `shop.logo_asset_id` is published on every storefront page and
 * in the shop's structured data, so a newly set logo the administrator may not
 * see in the asset library is refused exactly as a missing one (owner ruling
 * 2026-10-30, option a). The logo already stored is accepted as it stands.
 */
export function createShopLogoValidator(assets: Pick<AssetReadPort, 'visibleToCaller'>): SettingWriteValidator {
  return assetIdSettingValidator({
    contributorModuleId: 'settings',
    codes: [SHOP_LOGO_ASSET_ID],
    assets,
    refuse: (assetId) => new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`, { assetId }),
  });
}
