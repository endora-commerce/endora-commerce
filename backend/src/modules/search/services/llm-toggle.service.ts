import { z } from 'zod';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminAuditContext,
  SettingsAdminService,
} from '../../settings/services/settings-admin.service.js';
import type { SettingsService } from '../../settings/services/settings.service.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { SEARCH_SETTING_CODES } from '../manifest.js';

/**
 * LlmToggleService — feature 006 / US2 / T024.
 *
 * Cross-setting validating wrapper around `search.llm.enabled`. The four
 * `search.llm.*` settings (toggle + url + api_key + model) live in the
 * Settings module's `setting_values` table; the three embedder.* fields
 * are written through the generic Settings admin route (per-field audit
 * trail). This wrapper only writes the `enabled` toggle, but refuses to
 * flip it on for any channel whose embedder.* triplet is incomplete
 * (FR-011).
 *
 * Disabling never refuses — turning off LLM-augmented search must always
 * be possible regardless of the embedder fields' state.
 */

const stringSchema = z.string();

export interface LlmToggleParams {
  enabled: boolean;
  /** When omitted, applies to every channel in the setting's scope. */
  salesChannelCodes?: string[];
  expectedVersion: string | null;
  actor: AdminAuditContext;
}

export interface LlmToggleResult {
  enabled: boolean;
  newVersion: string;
  appliedChannelIds: string[];
}

export class LlmToggleService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsService: SettingsService,
    private readonly settingsAdminService: SettingsAdminService,
  ) {}

  async toggle(params: LlmToggleParams): Promise<LlmToggleResult> {
    if (params.enabled) {
      await this.assertEmbedderConfigComplete(params.salesChannelCodes);
    }

    const result = params.salesChannelCodes
      ? await this.settingsAdminService.setValueForSubset(
          SEARCH_SETTING_CODES.LLM_ENABLED,
          params.salesChannelCodes,
          params.enabled,
          params.expectedVersion,
          params.actor,
        )
      : await this.settingsAdminService.setValueForAllChannels(
          SEARCH_SETTING_CODES.LLM_ENABLED,
          params.enabled,
          params.expectedVersion,
          params.actor,
        );

    return {
      enabled: params.enabled,
      newVersion: result.newVersion,
      appliedChannelIds: result.affectedChannelIds,
    };
  }

  /**
   * Reads the three embedder.* settings for every targeted channel and
   * refuses with `LLM_CONFIG_INCOMPLETE` (HTTP 400) when any value is
   * empty. The error's `details[]` lists each missing
   * (channelCode, settingCode) pair so the admin UI can pinpoint what
   * needs filling.
   */
  private async assertEmbedderConfigComplete(
    salesChannelCodes: string[] | undefined,
  ): Promise<void> {
    const em = this.emFactory();
    const channels = salesChannelCodes
      ? await em.find(SalesChannel, { code: { $in: salesChannelCodes } })
      : await em.find(SalesChannel, {});

    if (salesChannelCodes && channels.length !== salesChannelCodes.length) {
      const found = new Set(channels.map((c) => c.code));
      const missing = salesChannelCodes.filter((c) => !found.has(c));
      throw new HttpError(
        400,
        ERROR_CODES.SETTING_OUT_OF_SCOPE_FOR_CHANNEL,
        `Unknown sales channel(s): ${missing.join(', ')}.`,
        missing.map((c) => ({
          path: `salesChannelCodes.${c}`,
          issue: 'unknown sales channel',
        })),
      );
    }

    const missing: Array<{ channelCode: string; settingCode: string }> = [];
    for (const channel of channels) {
      const fields: Array<[string, string]> = [
        [SEARCH_SETTING_CODES.LLM_EMBEDDER_URL, 'embedder_url'],
        [SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY, 'embedder_api_key'],
        [SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL, 'embedder_model'],
      ];
      for (const [code] of fields) {
        const value = await this.settingsService.get(code, channel.id, stringSchema);
        if (!value || value.length === 0) {
          missing.push({ channelCode: channel.code, settingCode: code });
        }
      }
    }
    if (missing.length > 0) {
      throw new HttpError(
        400,
        ERROR_CODES.LLM_CONFIG_INCOMPLETE,
        'LLM-augmented search cannot be enabled until every embedder.* field is set on every targeted channel.',
        missing.map((m) => ({
          path: `${m.channelCode}.${m.settingCode}`,
          issue: 'value is empty',
        })),
      );
    }
  }
}
