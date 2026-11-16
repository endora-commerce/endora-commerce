import { assetIdSettingValidator, type SettingWriteValidator } from '@endora-commerce/contracts';
import { CMS_SETTING_CODES } from '../../manifest.js';
import { assetNotLinkable, type CmsAssetVisibility } from './linkable-assets.js';

/**
 * Issue #544 — `cms.default_share_image_asset_id` is published in the social
 * meta of every page without its own sharing image, so a newly set image the
 * administrator may not see in the asset library is refused exactly as a page's
 * own sharing image is (owner ruling 2026-10-30, option a).
 */
export function createDefaultShareImageValidator(assets: CmsAssetVisibility): SettingWriteValidator {
  return assetIdSettingValidator({
    contributorModuleId: 'cms',
    codes: [CMS_SETTING_CODES.DEFAULT_SHARE_IMAGE_ASSET_ID],
    assets,
    refuse: assetNotLinkable,
  });
}
