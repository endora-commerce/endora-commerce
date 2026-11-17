import { assetIdSettingValidator, type AssetReadPort, type SettingWriteValidator } from '@endora-commerce/contracts';
import { TRANSACTIONAL_EMAILS_SETTING_CODES } from '../../manifest.js';
import { assetNotLinkable } from './linkable-assets.js';

/**
 * Issue #1354 — `transactional_emails.logo_asset_id` is rendered into the
 * header of every e-mail sent, so a newly set logo the administrator may not
 * see in the asset library is refused exactly as a missing one (owner ruling
 * 2026-10-30, option a). The logo already stored — platform-wide or on any
 * channel — is accepted as it stands. It covers the branding screen and the
 * generic settings write alike: both reach `settings`' write path.
 */
export function createLogoAssetValidator(assets: Pick<AssetReadPort, 'visibleToCaller'>): SettingWriteValidator {
  return assetIdSettingValidator({
    contributorModuleId: 'transactional_emails',
    codes: [TRANSACTIONAL_EMAILS_SETTING_CODES.LOGO_ASSET_ID],
    assets,
    refuse: assetNotLinkable,
  });
}
