import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SearchPhraseRecord } from '../entities/search-phrase-record.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import type { SettingsService } from '../../settings/services/settings.service.js';
import {
  SEARCH_SETTING_CODES,
  DEFAULT_POPUP_MINIMUM_QUERY_LENGTH,
} from '../manifest.js';

/**
 * SearchPhraseRecorder — feature 006 / US3 / T035.
 *
 * Persists committed search phrases to `search_phrase_records` for the
 * future Analytics module to aggregate. Three contractual properties:
 *
 *   1. Fire-and-forget. Callers (the `/api/v1/search/record` route)
 *      do NOT await `record()`; they hand off the promise so the
 *      storefront response is not delayed (FR-015).
 *   2. Threshold no-op. Phrases shorter than the channel's
 *      `search.popup.minimum_query_length` setting are silently
 *      skipped — the storefront's client-side guard is the primary
 *      surface; this is the server-side belt-and-braces.
 *   3. Errors never propagate. Persistence failures (DB hiccup,
 *      RESTRICT FK violation, etc.) are warn-logged and swallowed.
 *      The customer's search response cannot fail because analytics
 *      ingest had a bad day.
 */

const numberSchema = z.number();

export interface RecordPhraseInput {
  /** Verbatim phrase as the customer typed it. Must be non-empty. */
  phrase: string;
  /** Resolved channel ID (resolver middleware sets this; never trusted from the body). */
  salesChannelId: string;
  /** Number of products the search returned; `0` for dead-end phrases. */
  resultCount: number;
}

export class SearchPhraseRecorder {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsService?: SettingsService,
    private readonly onError: (err: unknown) => void = defaultLogger,
  ) {}

  /**
   * Returns a promise that resolves once the row has been queued for
   * INSERT (or the threshold check has tripped). Callers must NOT
   * await this from a request handler — fire and forget. The handler
   * pattern is `void recorder.record(...)`.
   */
  async record(input: RecordPhraseInput): Promise<void> {
    try {
      const trimmed = input.phrase.trim();
      const threshold = await this.resolveThreshold(input.salesChannelId);
      if (trimmed.length < threshold) {
        return;
      }
      const em = this.emFactory();
      const channel = await em.findOne(SalesChannel, { id: input.salesChannelId });
      if (!channel) {
        // The resolver middleware should have refused already; if we get
        // here, log and bail rather than write an FK-violating row.
        this.onError(
          new Error(
            `SearchPhraseRecorder: unknown sales_channel_id "${input.salesChannelId}"`,
          ),
        );
        return;
      }
      const record = em.create(SearchPhraseRecord, {
        phrase: input.phrase,
        phraseNormalized: trimmed.toLowerCase(),
        salesChannel: channel,
        resultCount: input.resultCount,
      });
      await em.persistAndFlush(record);
    } catch (err) {
      this.onError(err);
    }
  }

  private async resolveThreshold(channelId: string): Promise<number> {
    if (!this.settingsService) return DEFAULT_POPUP_MINIMUM_QUERY_LENGTH;
    try {
      return await this.settingsService.get(
        SEARCH_SETTING_CODES.POPUP_MINIMUM_QUERY_LENGTH,
        channelId,
        numberSchema,
      );
    } catch {
      // SettingNotRegistered, OutOfScope, cache-layer hiccup — fall back
      // to the manifest default. The recorder must not fail because
      // settings has a bad day either.
      return DEFAULT_POPUP_MINIMUM_QUERY_LENGTH;
    }
  }
}

function defaultLogger(err: unknown): void {
   
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'search phrase recorder failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
