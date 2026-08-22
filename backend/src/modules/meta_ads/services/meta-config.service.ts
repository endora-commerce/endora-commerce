import { z } from 'zod';
import {
  META_ADS_SETTING_CODES,
  META_DISABLED_CONFIG,
  type MetaStorefrontConfig,
  type MetaStorefrontMapping,
} from '@b2b/contracts';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';

/** Loader for a channel's enabled custom-event mappings in the storefront shape. */
export type MetaCustomEventsLoader = (
  salesChannelId: string,
) => Promise<MetaStorefrontMapping[]>;

/**
 * Resolves the per-sales-channel Meta Ads configuration exposed to the
 * storefront.
 *
 * A blank or absent Pixel ID means the channel is untracked (FR-004): the
 * returned config is fully disabled regardless of the master switch. Every
 * setting read degrades to its default rather than throwing — an incomplete
 * settings catalogue must not be able to fail a storefront render (FR-013).
 */
export class MetaConfigService {
  constructor(
    private readonly settings: SettingsReadPort,
    private readonly loadCustomEvents: MetaCustomEventsLoader = async () => [],
  ) {}

  async getConfig(salesChannelId: string): Promise<MetaStorefrontConfig> {
    const [enabled, pixelIdRaw, requireConsent] = await Promise.all([
      this.readBool(META_ADS_SETTING_CODES.ENABLED, salesChannelId, false),
      this.readString(META_ADS_SETTING_CODES.PIXEL_ID, salesChannelId, ''),
      this.readBool(META_ADS_SETTING_CODES.REQUIRE_CONSENT, salesChannelId, true),
    ]);

    const pixelId = pixelIdRaw.trim() || null;

    // Untracked channel. The consent choice is still reported so the storefront
    // banner behaves consistently across channels.
    if (!enabled || pixelId === null) {
      return { ...META_DISABLED_CONFIG, requireConsent };
    }

    return {
      enabled: true,
      pixelId,
      requireConsent,
      customEvents: await this.loadCustomEvents(salesChannelId),
    };
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
