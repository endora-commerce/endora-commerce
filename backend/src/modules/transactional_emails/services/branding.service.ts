/**
 * BrandingService — feature 047 (R5/US2).
 *
 * Resolves email branding (header logo, accent, default header/footer block
 * codes) globally and per sales channel via the Settings module, and exposes the
 * resolved logo URL as the `branding.logoUrl` variable for rendering.
 */

import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';
import type {
  AdminAuditContext,
  SettingsAdminService,
} from '../../settings/services/settings-admin.service.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
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

export interface BrandingWriteDeps {
  admin: SettingsAdminService;
  emFactory: () => EntityManager;
}

export interface BrandingPatch {
  logoAssetId?: string | undefined;
  accentColor?: string | undefined;
  headerBlockCode?: string | undefined;
  footerBlockCode?: string | undefined;
}

const GLOBAL_SENTINEL = '00000000-0000-0000-0000-000000000000';

export class BrandingService {
  constructor(
    private readonly settings: SettingsService,
    private readonly resolveAssetUrl?: AssetUrlResolver,
    private readonly writeDeps?: BrandingWriteDeps,
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

  /** Persist branding values at the given scope (global when salesChannelId is null). */
  async update(
    salesChannelId: string | null,
    patch: BrandingPatch,
    actor: AdminAuditContext,
  ): Promise<ResolvedBranding> {
    if (!this.writeDeps) {
      throw new Error('Branding write is not configured.');
    }
    const C = TRANSACTIONAL_EMAILS_SETTING_CODES;
    const entries: Array<[string, unknown]> = [];
    if (patch.logoAssetId !== undefined) entries.push([C.LOGO_ASSET_ID, patch.logoAssetId]);
    if (patch.accentColor !== undefined) entries.push([C.ACCENT_COLOR, patch.accentColor]);
    if (patch.headerBlockCode !== undefined) entries.push([C.HEADER_BLOCK_CODE, patch.headerBlockCode]);
    if (patch.footerBlockCode !== undefined) entries.push([C.FOOTER_BLOCK_CODE, patch.footerBlockCode]);

    let channelCodes: string[] | null = null;
    if (salesChannelId) {
      const channel = await this.writeDeps.emFactory().findOne(SalesChannel, { id: salesChannelId });
      channelCodes = channel ? [channel.code] : [];
    }

    for (const [code, value] of entries) {
      if (channelCodes) {
        await this.writeDeps.admin.setValueForSubset(code, channelCodes, value, null, actor);
      } else {
        await this.writeDeps.admin.setValueForAllChannels(code, value, null, actor);
      }
    }
    return this.resolve(salesChannelId);
  }
}
