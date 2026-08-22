/**
 * BrandingService — feature 047 (R5/US2).
 *
 * Resolves email branding (header logo, accent, default header/footer block
 * codes) globally and per sales channel via the Settings module, and exposes the
 * resolved logo URL as the `branding.logoUrl` variable for rendering.
 */

import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SettingNotRegistered, SettingOutOfScopeForChannel } from '../../../kernel/settings/settings.service.js';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';
import type { SettingsAdminAuditContext, SettingsAdminPort } from '@b2b/contracts';
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
  /**
   * `settingsAdminService`, owned by `settings` and named by its published
   * contract since feature 075's Phase C. Two writes rather than one with an
   * optional argument, because a value set for all channels and a value set
   * for a named subset are different operations (Constitution XII).
   */
  admin: SettingsAdminPort;
  emFactory: () => EntityManager;
}

export interface BrandingPatch {
  logoAssetId?: string | undefined;
  accentColor?: string | undefined;
  headerBlockCode?: string | undefined;
  footerBlockCode?: string | undefined;
}

/**
 * Conditions this service has already reported (D-43's warn-once). Module scope
 * and never reset: branding is read on every rendered email.
 */
const warnedConditions = new Set<string>();

function warnOnce(condition: string, message: string): void {
  if (warnedConditions.has(condition)) return;
  warnedConditions.add(condition);
  console.warn(message);
}

export class BrandingService {
  constructor(
    private readonly settings: SettingsReadPort,
    private readonly resolveAssetUrl?: AssetUrlResolver,
    private readonly writeDeps?: BrandingWriteDeps,
  ) {}

  /**
   * Two conditions degrade, and both to the caller's compiled-in default:
   * the setting is not registered (the module has not reconciled its manifest
   * yet), and the setting is scoped to a subset of channels that this read is
   * not inside. Everything else propagates — the bare `catch` this replaces
   * would have swallowed a `MODULE_DISABLED` envelope with equal enthusiasm,
   * which is fail-open dressed as robustness (composition rule 7, D-43).
   */
  private async readString(
    code: string,
    salesChannelId: string | null,
    fallback: string,
  ): Promise<string> {
    try {
      return await this.settings.get(code, salesChannelId, z.string());
    } catch (error) {
      if (error instanceof SettingNotRegistered) return fallback;
      if (error instanceof SettingOutOfScopeForChannel) {
        warnOnce(
          `out-of-scope:${code}`,
          `[transactional_emails] branding setting "${code}" is scoped to specific sales ` +
            `channels, so it has no value for this read — falling back to the built-in ` +
            `default (logged once per process).`,
        );
        return fallback;
      }
      throw error;
    }
  }

  /**
   * `salesChannelId === null` is the platform-wide read, and it is passed
   * through as `null` (D-41). It used to become the nil UUID: well-formed
   * enough to pass the seam guard, matching no row, so the right tier by
   * accident — and cached under a fake channel key that no invalidation ever
   * targeted, instead of the reserved `__global__` segment.
   */
  async resolve(salesChannelId: string | null): Promise<ResolvedBranding> {
    const C = TRANSACTIONAL_EMAILS_SETTING_CODES;
    const logoAssetId = await this.readString(C.LOGO_ASSET_ID, salesChannelId, '');
    const accentColor = await this.readString(C.ACCENT_COLOR, salesChannelId, '#1f2937');
    const headerBlockCode = await this.readString(
      C.HEADER_BLOCK_CODE,
      salesChannelId,
      'default_email_header',
    );
    const footerBlockCode = await this.readString(
      C.FOOTER_BLOCK_CODE,
      salesChannelId,
      'default_email_footer',
    );

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
    actor: SettingsAdminAuditContext,
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
