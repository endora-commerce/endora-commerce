import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  PWA_SETTING_CODES,
  PwaDisplayModeSchema,
  type PwaDisplayMode,
  type PwaIconDescriptor,
  type PwaPublicConfig,
} from '@endora-commerce/contracts';
import { PwaIconRendition } from '../entities/pwa-icon-rendition.entity.js';

/**
 * Minimal read port over SettingsService — the resolver only needs `get`.
 * SettingsService already provides read-through caching + write invalidation,
 * so the resolver does not add a second cache (YAGNI; FR-009 propagation is the
 * Settings cache's job).
 */
export interface SettingsReadPort {
  get<T>(code: string, salesChannelId: string | null, schema: z.ZodType<T>): Promise<T>;
}

const StringSchema = z.string();
const BoolSchema = z.boolean();

/** Bundled placeholder icons shipped by the storefront when no source is configured. */
const PLACEHOLDER_ICONS: PwaIconDescriptor[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

export class PwaConfigResolver {
  constructor(
    private readonly settings: SettingsReadPort,
    private readonly emFactory: () => EntityManager,
    /**
     * Whether `quote_requests` is effectively present
     * (`specs/149-pwa-order-status-push/`): without it no quote push is ever
     * produced, so the storefront offers no quote choice. A presence read, not
     * a port call — since `specs/179-rfq-and-customer-notifications/` WP-10
     * this module reads nothing of that owner, and it is `quote_requests` that
     * declares `degrades-without pwa`. Passed rather than read here, so the
     * resolver can be tested with no lifecycle composed; `plugin.ts` supplies
     * `effectiveState.isPresent`.
     */
    private readonly isQuoteRequestsPresent: () => boolean,
  ) {}

  private async getString(
    code: string,
    channelId: string | null,
    fallback: string,
  ): Promise<string> {
    try {
      return await this.settings.get(code, channelId, StringSchema);
    } catch {
      return fallback;
    }
  }

  private async getBool(
    code: string,
    channelId: string | null,
    fallback: boolean,
  ): Promise<boolean> {
    try {
      return await this.settings.get(code, channelId, BoolSchema);
    } catch {
      return fallback;
    }
  }

  private async getDisplayMode(channelId: string | null): Promise<PwaDisplayMode> {
    try {
      return await this.settings.get(PWA_SETTING_CODES.DISPLAY_MODE, channelId, PwaDisplayModeSchema);
    } catch {
      return 'standalone';
    }
  }

  /**
   * Build the icon descriptors for a channel from derived renditions. Falls back
   * to the per-channel renditions, then the global (null-channel) renditions, then
   * the bundled placeholders.
   */
  async resolveIcons(salesChannelId: string | null): Promise<PwaIconDescriptor[]> {
    const em = this.emFactory();
    // `null` = no channel to resolve for, so start at the global renditions —
    // the same row set the per-channel lookup falls back to anyway.
    const channelRows =
      salesChannelId === null ? [] : await em.find(PwaIconRendition, { salesChannelId });
    const rows = channelRows.length > 0
      ? channelRows
      : await em.find(PwaIconRendition, { salesChannelId: null });
    if (rows.length === 0) return PLACEHOLDER_ICONS;
    return rows.map((r) => ({
      src: `/api/v1/storefront/pwa/icons/${r.size}-${r.purpose}.png`,
      sizes: `${r.size}x${r.size}`,
      type: 'image/png',
      purpose: r.purpose,
    }));
  }

  /** Public, storefront-facing config for a channel (no private secrets). */
  async getPublicConfig(salesChannelId: string | null): Promise<PwaPublicConfig> {
    const [
      appName,
      shortName,
      themeColor,
      backgroundColor,
      displayMode,
      cachingEnabled,
      pushEnabled,
      vapidPublicKey,
      icons,
      orderStatusEnabled,
      quoteStatusEnabled,
    ] = await Promise.all([
      this.getString(PWA_SETTING_CODES.APP_NAME, salesChannelId, 'B2B Platform'),
      this.getString(PWA_SETTING_CODES.SHORT_NAME, salesChannelId, 'B2B'),
      this.getString(PWA_SETTING_CODES.THEME_COLOR, salesChannelId, '#1d4ed8'),
      this.getString(PWA_SETTING_CODES.BACKGROUND_COLOR, salesChannelId, '#fafafa'),
      this.getDisplayMode(salesChannelId),
      this.getBool(PWA_SETTING_CODES.CACHING_ENABLED, salesChannelId, false),
      this.getBool(PWA_SETTING_CODES.PUSH_ENABLED, salesChannelId, false),
      this.getString(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, salesChannelId, ''),
      this.resolveIcons(salesChannelId),
      this.getBool(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED, salesChannelId, true),
      this.getBool(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, salesChannelId, true),
    ]);

    // Push is only "on" for the client when both enabled AND a public key exists.
    const pushEffective = pushEnabled && vapidPublicKey.length > 0;

    return {
      appName,
      shortName,
      themeColor,
      backgroundColor,
      displayMode,
      icons,
      cachingEnabled,
      pushEnabled: pushEffective,
      vapidPublicKey: pushEnabled ? vapidPublicKey : '',
      // The effective category flags the storefront decides what to offer from
      // (`specs/149-pwa-order-status-push/` FR-020): the storefront has no
      // module-presence list, so the backend decides once.
      orderStatusPushEnabled: pushEffective && orderStatusEnabled,
      quoteStatusPushEnabled:
        pushEffective && quoteStatusEnabled && this.isQuoteRequestsPresent(),
    };
  }
}
