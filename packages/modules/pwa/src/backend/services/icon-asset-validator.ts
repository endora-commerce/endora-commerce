import {
  assetIdSettingValidator,
  ERROR_CODES,
  PWA_SETTING_CODES,
  type AssetReadPort,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Issue #544 — `pwa.icon_asset_id` is rendered into the public web-app
 * manifest, so a newly set icon the administrator may not see in the asset
 * library is refused exactly as a missing one (owner ruling 2026-10-30,
 * option a). The icon upload route sets an asset it has just created, which
 * its uploader sees; the icon already stored is accepted as it stands.
 */
export function createIconAssetValidator(assets: Pick<AssetReadPort, 'visibleToCaller'>): SettingWriteValidator {
  return assetIdSettingValidator({
    contributorModuleId: 'pwa',
    codes: [PWA_SETTING_CODES.ICON_ASSET_ID],
    assets,
    refuse: (assetId) => new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`, { assetId }),
  });
}
