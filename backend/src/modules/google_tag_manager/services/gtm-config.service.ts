import { z } from 'zod';
import {
  GOOGLE_TAG_MANAGER_SETTING_CODES,
  GTM_DISABLED_CONFIG,
  gtmContainerIdSchema,
  type GtmStorefrontConfig,
} from '@b2b/contracts';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';

/**
 * Resolves the per-sales-channel Google Tag Manager configuration exposed to
 * the storefront.
 *
 * A blank or malformed container ID means the channel is untracked (FR-004 /
 * FR-005): the returned config is fully disabled regardless of the master
 * switch, so a typo can never reach a `<script src>`. `requireConsent` survives
 * every disabled branch, because the storefront's shared consent gate reasons
 * about the channel even when this module contributes nothing.
 *
 * Every setting read degrades to its documented default rather than throwing —
 * an incomplete settings catalogue must not be able to fail a storefront
 * render.
 *
 * The server container address is deliberately absent from the result: the
 * browser only needs to know *that* it should relay, never *where* to.
 */
export class GtmConfigService {
  constructor(private readonly settings: SettingsService) {}

  async getConfig(salesChannelId: string): Promise<GtmStorefrontConfig> {
    const [enabled, containerRaw, requireConsent] = await Promise.all([
      this.readBool(GOOGLE_TAG_MANAGER_SETTING_CODES.ENABLED, salesChannelId, false),
      this.readString(GOOGLE_TAG_MANAGER_SETTING_CODES.CONTAINER_ID, salesChannelId, ''),
      this.readBool(GOOGLE_TAG_MANAGER_SETTING_CODES.REQUIRE_CONSENT, salesChannelId, true),
    ]);

    const containerId = gtmContainerIdSchema.safeParse(containerRaw.trim());
    if (!enabled || !containerId.success) {
      return { ...GTM_DISABLED_CONFIG, requireConsent };
    }

    const [serverSideEnabled, serverContainerUrl] = await Promise.all([
      this.readBool(
        GOOGLE_TAG_MANAGER_SETTING_CODES.SERVER_SIDE_ENABLED,
        salesChannelId,
        false,
      ),
      this.readString(
        GOOGLE_TAG_MANAGER_SETTING_CODES.SERVER_CONTAINER_URL,
        salesChannelId,
        '',
      ),
    ]);

    return {
      enabled: true,
      containerId: containerId.data,
      requireConsent,
      // Server-side tagging with no destination is inert: the channel stays on
      // the browser path rather than losing events (FR-031).
      serverSide: serverSideEnabled && serverContainerUrl.trim() !== '',
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
