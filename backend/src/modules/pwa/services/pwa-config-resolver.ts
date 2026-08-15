import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  PWA_SETTING_CODES,
  PwaDisplayModeSchema,
  type PwaDisplayMode,
  type PwaIconDescriptor,
  type PwaPublicConfig,
} from '@b2b/contracts';
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
    ]);

    return {
      appName,
      shortName,
      themeColor,
      backgroundColor,
      displayMode,
      icons,
      cachingEnabled,
      // Push is only "on" for the client when both enabled AND a public key exists.
      pushEnabled: pushEnabled && vapidPublicKey.length > 0,
      vapidPublicKey: pushEnabled ? vapidPublicKey : '',
    };
  }
}
