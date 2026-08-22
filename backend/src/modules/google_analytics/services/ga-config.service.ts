import { z } from 'zod';
import {
  GOOGLE_ANALYTICS_SETTING_CODES,
  type GaStorefrontConfig,
  type GaStorefrontCustomEvent,
} from '@b2b/contracts';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';

/**
 * Loader for a channel's enabled custom events, resolved into the storefront
 * shape. Injected so the config service stays decoupled from the custom-events
 * persistence (which lands in feature 049 US3). Defaults to an empty list until
 * wired.
 */
export type CustomEventsLoader = (
  salesChannelId: string,
) => Promise<GaStorefrontCustomEvent[]>;

/**
 * Resolves the per-sales-channel Google Analytics configuration exposed to the
 * storefront. Reads the module's Settings values (three-tier resolution) and
 * folds in the channel's enabled custom events.
 *
 * A blank/absent Measurement ID means the channel is untracked (FR-004): the
 * returned config has `enabled: false` and `measurementId: null` regardless of
 * the master switch, so the storefront loads nothing for that channel.
 */
export class GaConfigService {
  constructor(
    private readonly settings: SettingsReadPort,
    private readonly loadCustomEvents: CustomEventsLoader = async () => [],
  ) {}

  async getConfig(salesChannelId: string): Promise<GaStorefrontConfig> {
    const enabled = await this.readBool(
      GOOGLE_ANALYTICS_SETTING_CODES.ENABLED,
      salesChannelId,
      false,
    );
    const measurementIdRaw = await this.readString(
      GOOGLE_ANALYTICS_SETTING_CODES.MEASUREMENT_ID,
      salesChannelId,
      '',
    );
    const measurementId = measurementIdRaw.trim() || null;
    const requireConsent = await this.readBool(
      GOOGLE_ANALYTICS_SETTING_CODES.REQUIRE_CONSENT,
      salesChannelId,
      true,
    );

    // Untracked channel: master switch off or no measurement id (FR-004).
    if (!enabled || measurementId === null) {
      return {
        enabled: false,
        measurementId: null,
        enhancedEcommerce: false,
        serverSide: false,
        requireConsent,
        customEvents: [],
      };
    }

    const [enhancedEcommerce, serverSide, customEvents] = await Promise.all([
      this.readBool(
        GOOGLE_ANALYTICS_SETTING_CODES.ENHANCED_ECOMMERCE_ENABLED,
        salesChannelId,
        false,
      ),
      this.readBool(GOOGLE_ANALYTICS_SETTING_CODES.SERVER_SIDE_ENABLED, salesChannelId, false),
      this.loadCustomEvents(salesChannelId),
    ]);

    return {
      enabled: true,
      measurementId,
      enhancedEcommerce,
      serverSide,
      requireConsent,
      customEvents,
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
