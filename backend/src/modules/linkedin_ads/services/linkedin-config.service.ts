import { z } from 'zod';
import {
  LINKEDIN_ADS_SETTING_CODES,
  LINKEDIN_DISABLED_CONFIG,
  type LinkedInStorefrontConfig,
  type LinkedInStorefrontMapping,
} from '@b2b/contracts';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

/**
 * Loader for a channel's enabled conversion mappings in the storefront shape.
 * Injected so the config service stays decoupled from mapping persistence.
 */
export type ConversionMappingsLoader = (
  salesChannelId: string,
) => Promise<LinkedInStorefrontMapping[]>;

/**
 * Resolves the per-sales-channel LinkedIn Ads configuration exposed to the
 * storefront, from the module's Settings values plus the channel's enabled
 * conversion mappings.
 *
 * A blank or absent Partner ID means the channel is untracked (FR-004): the
 * returned config is fully disabled regardless of the master switch, so the
 * storefront loads nothing. Every setting read degrades to its default rather
 * than throwing — an unregistered or out-of-scope setting must not be able to
 * fail a storefront render (FR-019).
 */
export class LinkedInConfigService {
  constructor(
    private readonly settings: SettingsService,
    private readonly loadMappings: ConversionMappingsLoader = async () => [],
  ) {}

  async getConfig(salesChannelId: string): Promise<LinkedInStorefrontConfig> {
    const [enabled, partnerIdRaw, requireConsent] = await Promise.all([
      this.readBool(LINKEDIN_ADS_SETTING_CODES.ENABLED, salesChannelId, false),
      this.readString(LINKEDIN_ADS_SETTING_CODES.PARTNER_ID, salesChannelId, ''),
      this.readBool(LINKEDIN_ADS_SETTING_CODES.REQUIRE_CONSENT, salesChannelId, true),
    ]);

    const partnerId = partnerIdRaw.trim() || null;

    // Untracked channel: master switch off, or no partner id (FR-004). The
    // operator's consent choice is still reported so the storefront's consent
    // banner behaves consistently across channels.
    if (!enabled || partnerId === null) {
      return { ...LINKEDIN_DISABLED_CONFIG, requireConsent };
    }

    const [serverSide, conversionMappings] = await Promise.all([
      this.readBool(LINKEDIN_ADS_SETTING_CODES.SERVER_SIDE_ENABLED, salesChannelId, false),
      this.loadMappings(salesChannelId),
    ]);

    return { enabled: true, partnerId, requireConsent, serverSide, conversionMappings };
  }

  private async readBool(
    code: string,
    salesChannelId: string,
    fallback: boolean,
  ): Promise<boolean> {
    try {
      return await this.settings.get(code, salesChannelId, z.boolean());
    } catch {
      return fallback;
    }
  }

  private async readString(
    code: string,
    salesChannelId: string,
    fallback: string,
  ): Promise<string> {
    try {
      return await this.settings.get(code, salesChannelId, z.string());
    } catch {
      return fallback;
    }
  }
}
