/**
 * BrandingService — feature 047 (R5/US2).
 *
 * Resolves email branding (header logo, accent, default header/footer block
 * codes) globally and per sales channel via the Settings module, and exposes the
 * resolved logo URL as the `branding.logoUrl` variable for rendering.
 */

import { z } from 'zod';
import type { SettingsService } from '../../settings/services/settings.service.js';
import { TRANSACTIONAL_EMAILS_SETTING_CODES } from '../manifest.js';

export interface ResolvedBranding {
  salesChannelId: string | null;
  logoAssetId: string;
  logoUrl: string;
  accentColor: string;
  headerBlockCode: string;
  footerBlockCode: string;
  source: 'channel' | 'global' | 'default';
}

/** Resolves an asset id to a servable URL (wired from assets_library). */
export type AssetUrlResolver = (assetId: string) => Promise<string | null>;

const GLOBAL_SENTINEL = '00000000-0000-0000-0000-000000000000';

export class BrandingService {
  constructor(
    private readonly settings: SettingsService,
    private readonly resolveAssetUrl?: AssetUrlResolver,
  ) {}

  private async readString(code: string, salesChannelId: string, fallback: string): Promise<string> {
    try {
      const v = await this.settings.get(code, salesChannelId, z.string());
      return v;
    } catch {
      return fallback;
    }
  }

  async resolve(salesChannelId: string | null): Promise<ResolvedBranding> {
    const scopeId = salesChannelId ?? GLOBAL_SENTINEL;
    const C = TRANSACTIONAL_EMAILS_SETTING_CODES;
    const logoAssetId = await this.readString(C.LOGO_ASSET_ID, scopeId, '');
    const accentColor = await this.readString(C.ACCENT_COLOR, scopeId, '#1f2937');
    const headerBlockCode = await this.readString(C.HEADER_BLOCK_CODE, scopeId, 'default_email_header');
    const footerBlockCode = await this.readString(C.FOOTER_BLOCK_CODE, scopeId, 'default_email_footer');

    let logoUrl = '';
    if (logoAssetId && this.resolveAssetUrl) {
      try {
        logoUrl = (await this.resolveAssetUrl(logoAssetId)) ?? '';
      } catch {
        logoUrl = '';
      }
    }

    return {
      salesChannelId,
      logoAssetId,
      logoUrl,
      accentColor,
      headerBlockCode,
      footerBlockCode,
      source: salesChannelId ? 'channel' : 'global',
    };
  }
}
